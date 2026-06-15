// 即時通報中樞（常開）：
//  ① 唯一的「即時價格/持倉」警報來源（cron 只負責新聞）
//  ② 互動式 bot：/focus /positions /mute /unmute /help + 訊息附「看儀表板」按鈕
//  ③ 分級 + 盤中時段 + 盤前/盤後每日摘要 + 靜音
import "dotenv/config";
import { optionalEnv, requireEnv } from "../lib/config";
import { buildFocus } from "../lib/focus";
import type { Snapshot } from "../lib/types";

const SNAPSHOT_URL =
  process.env.SNAPSHOT_URL ||
  process.env.NEXT_PUBLIC_DATA_URL ||
  "https://raw.githubusercontent.com/erickwok1020us/stock-news-radar/main/data/snapshot.json";
const DASH_URL =
  process.env.DASHBOARD_URL ||
  "https://stock-news-radar-c7e7wi4v0-alexs-projects-84e44ccd.vercel.app";
const FINNHUB_KEY = requireEnv("FINNHUB_API_KEY");
const TG_TOKEN = optionalEnv("TELEGRAM_BOT_TOKEN");
const TG_CHAT = optionalEnv("TELEGRAM_CHAT_ID");
const MOVE_THRESHOLDS = [5, 8]; // 今日(vs昨收)大漲/大跌門檻 %
const VELO_PCT = 3; // 「急拉/急殺」：短窗內 ±3% 才警報（調高避免太敏感）
const VELO_WINDOW_MS = 5 * 60 * 1000; // 看最近 5 分鐘
const VELO_COOLDOWN_MS = 15 * 60 * 1000; // 同向 15 分鐘內不重複
const FLUSH_MS = 3 * 60 * 1000; // 非緊急警報每 3 分鐘合併成一則送出（防洗版）

let snap: Snapshot | null = null;
let subscribed = new Set<string>();
const fired = new Set<string>();
const sentDigests = new Set<string>();
const muted = new Set<string>();
let firedDay = "";
const ticks = new Map<string, { t: number; p: number }[]>(); // 每檔近期 tick（算速度）
const lastVelo = new Map<string, number>(); // symbol:dir → 上次急拉/急殺時間
const fyiBuffer: string[] = []; // 非緊急警報暫存，每 FLUSH_MS 合併送出

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 時間（美東）─────────────────────────────────────────────
function ny(): { dow: number; minutes: number; date: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dow: dowMap[p.weekday] ?? 0,
    minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}
function marketOpen(): boolean {
  const { dow, minutes } = ny();
  return dow >= 1 && dow <= 5 && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

// ── Telegram ───────────────────────────────────────────────
async function tgCall(method: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function tgSend(text: string, withButton = true): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log(text.replace(/<\/?b>/g, ""));
    return;
  }
  await tgCall("sendMessage", {
    chat_id: TG_CHAT,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(withButton ? { reply_markup: { inline_keyboard: [[{ text: "📊 看儀表板", url: DASH_URL }]] } } : {}),
  }).catch(() => {});
}

// ── 警報（分級 + 靜音 + 盤中時段 + 當天去重）──────────────────
function rollover(): void {
  const d = ny().date;
  if (d !== firedDay) {
    fired.clear();
    firedDay = d;
  }
}
function alertOnce(symbol: string, key: string, text: string, critical: boolean): void {
  rollover();
  if (muted.has(symbol)) return;
  if (!critical && !marketOpen()) return; // 非緊急只在盤中推
  if (fired.has(key)) return;
  fired.add(key);
  console.log(`[ALERT] ${text.replace(/<\/?b>/g, "")}`);
  if (critical)
    void tgSend(`⚡ ${text}`); // 緊急（持倉止損/止盈）即時推
  else fyiBuffer.push(`• ${text}`); // 其餘併入 3 分鐘摘要，防洗版
}

// 把累積的非緊急警報合併成一則送出
function flushFyi(): void {
  if (!fyiBuffer.length) return;
  const lines = fyiBuffer.splice(0);
  void tgSend(`📊 <b>盤中異動摘要（近 ${FLUSH_MS / 60000} 分）</b>\n${lines.join("\n")}`);
}

// ── 摘要文字（給 /focus、/positions、每日摘要共用）────────────
function fmtFocus(s: Snapshot): string {
  const f = buildFocus(s);
  if (!f.actions.length) return "目前沒有需要動作的，觀望即可。";
  const dot = (t: string) =>
    t === "exit" || t === "short" ? "🔴" : t === "long" || t === "protect" ? "🟢" : "🟡";
  const lines = f.actions
    .slice(0, 10)
    .map((a) => `${dot(a.tone)} <b>$${a.ticker}</b> ${a.label} — ${a.title}${a.chip ? `（${a.chip}）` : ""}`);
  let t = `<b>📋 今日焦點（${f.actions.length} 件）</b>\n${lines.join("\n")}`;
  if (f.watching.length) t += `\n觀望：${f.watching.join("、")}`;
  return t;
}
function fmtPositions(s: Snapshot): string {
  if (!s.positions.length) return "目前沒有持倉（在 POSITIONS_JSON / config/positions.json 設定）。";
  const lines = s.positions.map((r) => {
    const p = r.position;
    const pnl = `${r.pnlPct >= 0 ? "+" : ""}${(r.pnlPct * 100).toFixed(1)}%`;
    return `<b>$${p.ticker}</b>（${p.mode === "day" ? "短線" : "長期"}）${p.shares}股 @${p.entry} · 現價 ${r.price} · ${pnl}\n  → ${r.reason}`;
  });
  return `<b>📊 你的持倉</b>\n${lines.join("\n")}`;
}

// 急拉/急殺：最近 5 分鐘內 ±VELO_PCT%（自帶冷卻，不走每日去重）
function checkVelocity(symbol: string, price: number): void {
  const now = Date.now();
  let buf = ticks.get(symbol);
  if (!buf) {
    buf = [];
    ticks.set(symbol, buf);
  }
  buf.push({ t: now, p: price });
  const cutoff = now - VELO_WINDOW_MS;
  while (buf.length && buf[0].t < cutoff) buf.shift();
  if (buf.length < 2 || buf[0].p <= 0) return;
  const chg = ((price - buf[0].p) / buf[0].p) * 100;
  if (Math.abs(chg) < VELO_PCT) return;
  const k = `${symbol}:${chg > 0 ? "up" : "dn"}`;
  if (now - (lastVelo.get(k) ?? 0) < VELO_COOLDOWN_MS) return;
  lastVelo.set(k, now);
  const mins = Math.max(1, Math.round((now - buf[0].t) / 60000));
  fyiBuffer.push(
    `• <b>$${symbol}</b> ${chg > 0 ? "急拉" : "急殺"} ${chg > 0 ? "+" : ""}${chg.toFixed(1)}%（約 ${mins} 分鐘內 · ${price}）`,
  );
}

// ── 即時成交處理 ────────────────────────────────────────────
function onTrade(symbol: string, price: number): void {
  if (!snap || muted.has(symbol)) return;
  checkVelocity(symbol, price); // 先看有沒有「突然」急拉/急殺

  // 持倉：價格事件（真錢 → 緊急，永遠推）
  for (const r of snap.positions) {
    const p = r.position;
    if (p.ticker !== symbol) continue;
    const stop = p.stop && p.stop > 0 ? p.stop : null;
    const target = p.target && p.target > 0 ? p.target : null;
    if (stop && price <= stop)
      alertOnce(symbol, `${p.id}:stop`, `<b>$${symbol}</b> 跌破止損 ${stop}（現價 ${price}）——持倉該出場`, true);
    if (target && price >= target)
      alertOnce(symbol, `${p.id}:target`, `<b>$${symbol}</b> 到止盈 ${target}（現價 ${price}）——可考慮減碼`, true);
    if (stop && price >= p.entry + (p.entry - stop))
      alertOnce(symbol, `${p.id}:be`, `<b>$${symbol}</b> 獲利達 +1R（現價 ${price}）——止損可移到保本 ${p.entry}`, true);
  }

  // watchlist：大幅異動 + 當日關鍵價突破（FYI → 盤中才推）
  const t = snap.tickers.find((x) => x.ticker === symbol);
  if (!t) return;
  const pc = t.quote?.prevClose;
  if (pc && pc > 0) {
    const chg = ((price - pc) / pc) * 100;
    const ths = [...MOVE_THRESHOLDS].sort((a, b) => b - a);
    for (const th of ths)
      if (chg >= th) {
        alertOnce(symbol, `${symbol}:up${th}`, `<b>$${symbol}</b> 今日大漲 +${chg.toFixed(1)}%（昨收 ${pc} → ${price}）`, false);
        break;
      }
    for (const th of ths)
      if (chg <= -th) {
        alertOnce(symbol, `${symbol}:dn${th}`, `<b>$${symbol}</b> 今日大跌 ${chg.toFixed(1)}%（昨收 ${pc} → ${price}）`, false);
        break;
      }
  }
  const d = t.day;
  if (d?.direction === "long" && price >= d.breakout)
    alertOnce(symbol, `${symbol}:brk`, `<b>$${symbol}</b> 突破 ${d.breakout}（現價 ${price}）— 順勢做多參考`, false);
  if (d?.direction === "short" && price <= d.breakout)
    alertOnce(symbol, `${symbol}:brk`, `<b>$${symbol}</b> 跌破 ${d.breakout}（現價 ${price}）— 順勢做空參考`, false);
}

// 分析型持倉警報（論點改變/估值偏高）：來自 snapshot，緊急，永遠推
function pushAnalysisPositionAlerts(): void {
  if (!snap) return;
  for (const r of snap.positions) {
    if (r.urgent && (r.action === "review" || r.action === "take_partial")) {
      alertOnce(r.position.ticker, `${r.position.id}:${r.action}`, `<b>$${r.position.ticker}</b> ${r.reason}`, true);
    }
  }
}

// ── 互動指令 ───────────────────────────────────────────────
async function handleCommand(text: string): Promise<void> {
  const [cmd, arg] = text.trim().split(/\s+/);
  const sym = (arg || "").toUpperCase();
  switch (cmd.toLowerCase()) {
    case "/focus":
      await tgSend(snap ? fmtFocus(snap) : "資料載入中…");
      break;
    case "/positions":
      await tgSend(snap ? fmtPositions(snap) : "資料載入中…");
      break;
    case "/mute":
      if (sym) {
        muted.add(sym);
        await tgSend(`🔇 已靜音 $${sym}（重啟後失效；/unmute ${sym} 取消）`, false);
      } else await tgSend("用法：/mute NVDA", false);
      break;
    case "/unmute":
      if (sym === "ALL") {
        muted.clear();
        await tgSend("🔊 已取消所有靜音", false);
      } else if (sym) {
        muted.delete(sym);
        await tgSend(`🔊 已取消靜音 $${sym}`, false);
      } else await tgSend("用法：/unmute NVDA 或 /unmute ALL", false);
      break;
    case "/muted":
      await tgSend(muted.size ? `🔇 靜音中：${[...muted].join("、")}` : "目前沒有靜音的標的", false);
      break;
    case "/start":
    case "/help":
      await tgSend(
        "<b>美股雷達 bot 指令</b>\n" +
          "/focus — 當下行動清單\n" +
          "/positions — 持倉損益 + 建議\n" +
          "/mute NVDA — 靜音某檔\n" +
          "/unmute NVDA（或 ALL）— 取消靜音\n" +
          "/muted — 看靜音清單\n\n" +
          "另外會自動推：持倉止損/止盈、大幅異動、突破，以及盤前/盤後摘要。",
        false,
      );
      break;
  }
}

async function pollCommands(): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) return;
  let offset = 0;
  for (;;) {
    try {
      const data = await tgCall("getUpdates", { offset, timeout: 30 });
      for (const u of data.result ?? []) {
        offset = u.update_id + 1;
        const text: string = u.message?.text || "";
        if (String(u.message?.chat?.id) === String(TG_CHAT) && text.startsWith("/")) {
          await handleCommand(text);
        }
      }
    } catch {
      await sleep(3000);
    }
  }
}

// ── 每日摘要（盤前 9:15 / 盤後 16:15 ET）──────────────────────
function maybeDigest(): void {
  if (!snap) return;
  const { dow, minutes, date } = ny();
  if (dow < 1 || dow > 5) return;
  if (minutes >= 555 && minutes < 565 && !sentDigests.has(`${date}:pre`)) {
    sentDigests.add(`${date}:pre`);
    void tgSend(`🌅 <b>盤前 · 今日設定</b>\n\n${fmtFocus(snap)}`);
  }
  if (minutes >= 975 && minutes < 985 && !sentDigests.has(`${date}:post`)) {
    sentDigests.add(`${date}:post`);
    void tgSend(`🌆 <b>盤後 · 今日回顧</b>\n\n${fmtFocus(snap)}\n\n今日即時警報 ${fired.size} 則`);
  }
}

// ── 資料 + WebSocket ───────────────────────────────────────
async function refreshSnapshot(): Promise<void> {
  try {
    const res = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`);
    if (res.ok) {
      snap = (await res.json()) as Snapshot;
      pushAnalysisPositionAlerts();
    }
  } catch (e) {
    console.warn("snapshot 刷新失敗:", (e as Error).message);
  }
}
function watchedSymbols(): string[] {
  if (!snap) return [];
  const s = new Set<string>();
  for (const t of snap.tickers) s.add(t.ticker);
  for (const p of snap.positions) s.add(p.position.ticker);
  return [...s];
}
function connect(): void {
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
  ws.addEventListener("open", () => {
    console.log("🔌 Finnhub WebSocket 連上");
    subscribed = new Set();
    for (const s of watchedSymbols()) {
      ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
      subscribed.add(s);
    }
    console.log("📡 訂閱:", [...subscribed].join(", ") || "(尚無標的)");
  });
  ws.addEventListener("message", (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "trade" && Array.isArray(msg.data)) for (const d of msg.data) onTrade(d.s, d.p);
    } catch {
      /* ignore */
    }
  });
  const iv = setInterval(async () => {
    await refreshSnapshot();
    if (ws.readyState === ws.OPEN)
      for (const s of watchedSymbols())
        if (!subscribed.has(s)) {
          ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
          subscribed.add(s);
        }
  }, 3 * 60 * 1000);
  ws.addEventListener("close", () => {
    clearInterval(iv);
    console.warn("WebSocket 斷線，5 秒後重連…");
    setTimeout(connect, 5000);
  });
  ws.addEventListener("error", () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

async function main(): Promise<void> {
  console.log("🚀 即時通報中樞啟動");
  await refreshSnapshot();
  connect();
  void pollCommands();
  setInterval(maybeDigest, 60 * 1000);
  setInterval(flushFyi, FLUSH_MS);
}

void main();
