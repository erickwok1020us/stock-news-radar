// 即時警報 worker（常開）：接 Finnhub WebSocket 即時成交價，價格一碰到關卡就秒推 Telegram。
// 分工：GitHub Actions(5分鐘) 算新聞/價位/時機並寫 snapshot；本 worker 只負責「即時盯價 + 警報」。
// 跑法：npm run worker（需要常開的主機：小 VPS / Railway / Fly 等）
import "dotenv/config";
import { optionalEnv, requireEnv } from "../lib/config";
import { sendTelegram } from "../lib/telegram";
import type { Snapshot } from "../lib/types";

const SNAPSHOT_URL =
  process.env.SNAPSHOT_URL ||
  process.env.NEXT_PUBLIC_DATA_URL ||
  "https://raw.githubusercontent.com/erickwok1020us/stock-news-radar/main/data/snapshot.json";

const FINNHUB_KEY = requireEnv("FINNHUB_API_KEY");
const tgToken = optionalEnv("TELEGRAM_BOT_TOKEN");
const tgChat = optionalEnv("TELEGRAM_CHAT_ID");
const MOVE_THRESHOLDS = [5, 8]; // 大漲/大跌警報門檻 %

let snap: Snapshot | null = null;
let subscribed = new Set<string>();
const fired = new Set<string>();
let firedDay = "";

const today = () => new Date().toISOString().slice(0, 10);

/** 同一條件每天只推一次，避免洗版 */
function alertOnce(key: string, text: string): void {
  if (today() !== firedDay) {
    fired.clear();
    firedDay = today();
  }
  if (fired.has(key)) return;
  fired.add(key);
  console.log(`[ALERT] ${text.replace(/<\/?b>/g, "")}`);
  void sendTelegram(`⚡ ${text}`, tgToken, tgChat);
}

async function refreshSnapshot(): Promise<void> {
  try {
    const res = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`);
    if (res.ok) snap = (await res.json()) as Snapshot;
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

function onTrade(symbol: string, price: number): void {
  if (!snap) return;

  // 1) 真實持倉（真錢，最高優先）
  for (const r of snap.positions) {
    const p = r.position;
    if (p.ticker !== symbol) continue;
    const stop = p.stop && p.stop > 0 ? p.stop : null;
    const target = p.target && p.target > 0 ? p.target : null;
    if (stop && price <= stop)
      alertOnce(`${p.id}:stop`, `<b>$${symbol}</b> 跌破止損 ${stop}（現價 ${price}）——持倉該出場`);
    if (target && price >= target)
      alertOnce(`${p.id}:target`, `<b>$${symbol}</b> 到止盈 ${target}（現價 ${price}）——可考慮減碼`);
    if (stop && price >= p.entry + (p.entry - stop))
      alertOnce(`${p.id}:be`, `<b>$${symbol}</b> 獲利達 +1R（現價 ${price}）——止損可移到保本 ${p.entry}`);
  }

  // 2) watchlist：大幅異動 + 當日關鍵價突破/跌破
  const t = snap.tickers.find((x) => x.ticker === symbol);
  if (!t) return;
  const pc = t.quote?.prevClose;
  if (pc && pc > 0) {
    const chg = ((price - pc) / pc) * 100;
    const ths = [...MOVE_THRESHOLDS].sort((a, b) => b - a); // 高→低，只推最高跨過的那條
    for (const th of ths) {
      if (chg >= th) {
        alertOnce(`${symbol}:up${th}`, `<b>$${symbol}</b> 大漲 +${chg.toFixed(1)}%（現價 ${price}）`);
        break;
      }
    }
    for (const th of ths) {
      if (chg <= -th) {
        alertOnce(`${symbol}:dn${th}`, `<b>$${symbol}</b> 大跌 ${chg.toFixed(1)}%（現價 ${price}）`);
        break;
      }
    }
  }
  const d = t.day;
  if (d?.direction === "long" && price >= d.breakout)
    alertOnce(`${symbol}:brk`, `<b>$${symbol}</b> 突破 ${d.breakout}（現價 ${price}）— 順勢做多參考`);
  if (d?.direction === "short" && price <= d.breakout)
    alertOnce(`${symbol}:brk`, `<b>$${symbol}</b> 跌破 ${d.breakout}（現價 ${price}）— 順勢做空參考`);
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
      if (msg.type === "trade" && Array.isArray(msg.data)) {
        for (const d of msg.data) onTrade(d.s, d.p);
      }
    } catch {
      /* ignore non-JSON / ping */
    }
  });

  const iv = setInterval(async () => {
    await refreshSnapshot();
    if (ws.readyState === ws.OPEN) {
      for (const s of watchedSymbols()) {
        if (!subscribed.has(s)) {
          ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
          subscribed.add(s);
        }
      }
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
  console.log("🚀 即時警報 worker 啟動");
  await refreshSnapshot();
  if (!snap) console.warn("⚠ 暫時讀不到 snapshot，會持續重試");
  connect();
}

void main();
