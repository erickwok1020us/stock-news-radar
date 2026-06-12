// 主流程：抓新聞+報價+基本面+技術統計 → 去重 → Claude 判讀 → 算價位框架
// → 檢視每筆持倉 → 寫 snapshot.json → Telegram 推播（新聞警報 + 持倉動作）。
// GitHub Actions 每 5 分鐘跑一次（也可本機 `npm run ingest`）。
import "dotenv/config";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  loadPortfolio,
  loadWatchlist,
  optionalEnv,
  requireEnv,
} from "../lib/config";
import { getCompanyNews, getFundamentals, getQuote } from "../lib/finnhub";
import { getMarketStats } from "../lib/marketdata";
import { getStockTwitsSentiment } from "../lib/stocktwits";
import { analyzeNews } from "../lib/analyze";
import { dayTradeLevels, longTermLevels } from "../lib/levels";
import { computeHeat, computeTiming } from "../lib/timing";
import { reviewPosition } from "../lib/positions";
import { sendTelegram } from "../lib/telegram";
import type {
  AnalyzedNews,
  Fundamentals,
  MarketStats,
  PositionReview,
  Quote,
  RawNews,
  Sentiment,
  Snapshot,
  TickerSnapshot,
} from "../lib/types";

const DATA_DIR = resolve(process.cwd(), "data");
const SNAPSHOT_PATH = resolve(DATA_DIR, "snapshot.json");
const STORE_PATH = resolve(DATA_DIR, "store.json");
// 本機開發時前端讀 public/snapshot.json，所以也寫一份過去（CI 只 commit data/，不會推這份）
const PUBLIC_SNAPSHOT_PATH = resolve(process.cwd(), "public", "snapshot.json");
const STORE_TTL_SECONDS = 48 * 3600;
const NEWS_PER_TICKER = 12;
const USE_STOCKTWITS = true;

type StoreEntry = AnalyzedNews & { _seenAt: number };
type Store = Record<string, StoreEntry>;

function loadStore(): Store {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  const nowSec = Math.floor(Date.now() / 1000);
  const pruned: Store = {};
  for (const [id, e] of Object.entries(store)) {
    if (nowSec - e._seenAt < STORE_TTL_SECONDS) pruned[id] = e;
  }
  writeFileSync(STORE_PATH, JSON.stringify(pruned));
}

function ymd(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function computeSignal(news: AnalyzedNews[]): TickerSnapshot["signal"] {
  let score = 0;
  let bull = 0;
  let bear = 0;
  for (const n of news) {
    // 傳聞權重打對折，避免被未證實消息帶風向
    const w = n.confidence * (n.credibility === "rumor" ? 0.5 : 1);
    if (n.sentiment === "bullish") {
      score += w;
      bull++;
    } else if (n.sentiment === "bearish") {
      score -= w;
      bear++;
    }
  }
  const norm =
    news.length > 0 ? Math.max(-1, Math.min(1, score / news.length)) : 0;
  const sentiment: Sentiment =
    norm > 0.15 ? "bullish" : norm < -0.15 ? "bearish" : "neutral";
  return {
    sentiment,
    score: Number(norm.toFixed(2)),
    bullCount: bull,
    bearCount: bear,
  };
}

async function chunkedAnalyze(items: RawNews[]): Promise<AnalyzedNews[]> {
  const CHUNK = 40;
  const out: AnalyzedNews[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(...(await analyzeNews(items.slice(i, i + CHUNK))));
  }
  return out;
}

function newsAlertText(n: AnalyzedNews, price: string): string {
  const dir =
    n.sentiment === "bullish" ? "🟢 偏多" : n.sentiment === "bearish" ? "🔴 偏空" : "⚪ 中性";
  const tag =
    n.credibility === "rumor" ? "⚠️ 傳聞" : n.credibility === "confirmed" ? "✅ 已證實" : "❓未確認";
  return (
    `<b>$${n.ticker}</b> ${dir} ${tag} (${Math.round(n.confidence * 100)}%)${price}\n` +
    `${n.reason}\n<a href="${n.url}">${n.headline}</a>`
  );
}

function posAlertText(r: PositionReview): string {
  const label: Record<string, string> = {
    exit: "🔴 出場（止損觸及）",
    take_partial: "🟡 部分減碼",
    move_stop_be: "🟢 移動止損 · 保本",
    trail_stop: "🟢 移動止損 · 順勢",
    review: "⚠️ 檢視持倉",
    hold: "續抱",
  };
  const pnl = `${r.pnlPct >= 0 ? "+" : ""}${(r.pnlPct * 100).toFixed(1)}%`;
  const stop = r.suggestedStop ? `\n建議止損/檢討價：${r.suggestedStop}` : "";
  return (
    `<b>持倉 $${r.position.ticker}</b>（${r.position.mode === "day" ? "短線" : "長期"}）${label[r.action] ?? r.action}\n` +
    `現價 ${r.price} · 損益 ${pnl}${stop}\n${r.reason}`
  );
}

async function main(): Promise<void> {
  const { tickers: watchlist, alertThreshold } = loadWatchlist();
  const { account, positions } = loadPortfolio();
  const finnhubKey = requireEnv("FINNHUB_API_KEY");
  requireEnv("GEMINI_API_KEY"); // analyze.ts 會用這把（免費 Gemini）
  const tgToken = optionalEnv("TELEGRAM_BOT_TOKEN");
  const tgChat = optionalEnv("TELEGRAM_CHAT_ID");

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // 追蹤清單 ∪ 持倉標的（持倉可能有不在 watchlist 的股票）
  const watchSet = new Set(watchlist);
  const allTickers = Array.from(
    new Set([...watchlist, ...positions.map((p) => p.ticker.toUpperCase())]),
  );
  console.log(
    `📡 watchlist ${watchlist.length} 檔 + 持倉 ${positions.length} 筆 → 共抓 ${allTickers.length} 檔`,
  );

  const store = loadStore();
  const nowSec = Math.floor(Date.now() / 1000);
  const from = ymd(2);
  const to = ymd(0);

  const quotes = new Map<string, Quote | null>();
  const statsMap = new Map<string, MarketStats | null>();
  const socialMap = new Map<string, { bullish: number; bearish: number } | null>();
  const fundMap = new Map<string, Fundamentals | null>();
  const fresh: RawNews[] = [];

  // 逐檔抓（序列、不要一次轟所有 API，對免費額度友善）
  for (const ticker of allTickers) {
    const isWatch = watchSet.has(ticker);
    const [quote, news, stats, soc, fund] = await Promise.all([
      getQuote(ticker, finnhubKey),
      getCompanyNews(ticker, from, to, finnhubKey),
      getMarketStats(ticker),
      isWatch && USE_STOCKTWITS
        ? getStockTwitsSentiment(ticker)
        : Promise.resolve(null),
      isWatch ? getFundamentals(ticker, finnhubKey) : Promise.resolve(null),
    ]);
    quotes.set(ticker, quote);
    statsMap.set(ticker, stats);
    socialMap.set(ticker, soc);
    fundMap.set(ticker, fund);
    for (const n of news) if (!store[n.id]) fresh.push(n);
  }
  console.log(`📰 新消息 ${fresh.length} 則（去重後）`);

  // Claude 判讀新消息 → 存庫
  const analyzedFresh = await chunkedAnalyze(fresh);
  for (const a of analyzedFresh) store[a.id] = { ...a, _seenAt: nowSec };

  const freshByTicker = new Map<string, AnalyzedNews[]>();
  for (const a of analyzedFresh) {
    const arr = freshByTicker.get(a.ticker) ?? [];
    arr.push(a);
    freshByTicker.set(a.ticker, arr);
  }

  // 每檔（watchlist）快照：報價 + 訊號 + 基本面 + 技術 + 價位框架
  const tickerSnapshots: TickerSnapshot[] = watchlist.map((ticker) => {
    const news = Object.values(store)
      .filter((e) => e.ticker === ticker)
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, NEWS_PER_TICKER)
      .map(({ _seenAt, ...n }) => n);
    const quote = quotes.get(ticker) ?? null;
    const stats = statsMap.get(ticker) ?? null;
    const signal = computeSignal(news);
    const timing = computeTiming(quote, stats, signal);
    const dir = timing.direction === "short" ? "short" : "long";
    return {
      ticker,
      quote,
      signal,
      social: socialMap.get(ticker) ?? null,
      stats,
      day: quote ? dayTradeLevels(quote, stats, dir) : null,
      long: quote ? longTermLevels(quote, stats) : null,
      timing,
      heat: computeHeat(quote, stats, signal),
      fundamentals: fundMap.get(ticker) ?? null,
      news,
    };
  });

  // 每筆持倉檢視 + 調整建議
  const positionReviews: PositionReview[] = positions.map((pos) => {
    const t = pos.ticker.toUpperCase();
    const q = quotes.get(t);
    const price = q?.current && q.current > 0 ? q.current : pos.entry;
    const stats = statsMap.get(t) ?? null;
    const f = freshByTicker.get(t) ?? [];
    const bearishCatalyst = f.some(
      (a) => a.sentiment === "bearish" && a.credibility === "confirmed" && a.confidence >= 0.6,
    );
    const thesisChanged = f.some((a) => a.longTermImpact === "thesis");
    return reviewPosition(pos, price, stats, { bearishCatalyst, thesisChanged });
  });

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    account,
    tickers: tickerSnapshots,
    positions: positionReviews,
  };
  const json = JSON.stringify(snapshot, null, 2);
  writeFileSync(SNAPSHOT_PATH, json);
  try {
    writeFileSync(PUBLIC_SNAPSHOT_PATH, json); // 本機開發用；public/ 不存在就略過
  } catch {
    /* ignore */
  }
  saveStore(store);
  console.log(`💾 已寫入 ${SNAPSHOT_PATH}`);

  // 推播：① 新出現、信心夠高、方向非中性的新聞
  const newsAlerts = analyzedFresh.filter(
    (n) => n.sentiment !== "neutral" && n.confidence >= alertThreshold,
  );
  // ② 持倉需要動作的（緊急）
  const posAlerts = positionReviews.filter((r) => r.urgent);

  if (tgToken && tgChat) {
    if (newsAlerts.length) {
      console.log(`📣 新聞警報 ${newsAlerts.length} 則`);
      for (const n of newsAlerts) {
        const q = quotes.get(n.ticker);
        const price = q
          ? `　$${q.current} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%)`
          : "";
        await sendTelegram(newsAlertText(n, price), tgToken, tgChat);
      }
    }
    if (posAlerts.length) {
      console.log(`📣 持倉動作 ${posAlerts.length} 筆`);
      for (const r of posAlerts) await sendTelegram(posAlertText(r), tgToken, tgChat);
    }
  }

  console.log("✅ 完成");
}

main().catch((err) => {
  console.error("❌ ingest 失敗:", err);
  process.exit(1);
});
