// 多策略成效追蹤：5 套策略各自「自動下模擬單 → 後續價格自動結算 → 各自一份成績」。
// 純函式、透明。每次 ingest 呼叫一次。長期累積後可比出哪套公式最好。
import { STRATEGIES } from "./strategies";
import type {
  StrategyStat,
  TickerSnapshot,
  TrackedSignal,
  TrackStat,
  TrackSummary,
} from "./types";

const HORIZON_MS = 3 * 86_400_000; // 3 天沒結果就到期結算（縮短→資金週轉快、成績累積快）
const MAX_CLOSED = 400; // 帳本保留最近 400 筆已結算

function realizedR(s: TrackedSignal, closePrice: number): number {
  if (s.riskPerShare <= 0) return 0;
  const dir = s.direction === "long" ? 1 : -1;
  return Number(((dir * (closePrice - s.entry)) / s.riskPerShare).toFixed(2));
}

const BET_HKD = 100; // 假設每張模擬單投入 100 港幣（要改金額改這裡）
// 把一張單換算成港幣損益：100 港幣 × 進出場百分比（做空方向相反）
function pnlHKD(s: TrackedSignal, exitPrice: number): number {
  if (s.entry <= 0) return 0;
  const pct = ((s.direction === "long" ? 1 : -1) * (exitPrice - s.entry)) / s.entry;
  return Number((BET_HKD * pct).toFixed(2));
}

export function updateTrack(
  ledger: TrackedSignal[],
  tickers: TickerSnapshot[],
  nowMs: number,
  nowISO: string,
): { ledger: TrackedSignal[]; summary: TrackSummary } {
  const byTicker = new Map(tickers.map((t) => [t.ticker, t]));

  // 0) 清掉早期沒有 strategy 欄位的舊紀錄（會顯示成 undefined），自我修復、不再對不上計數
  const known = new Set(STRATEGIES.map((s) => s.name));
  ledger = ledger.filter((s) => known.has(s.strategy));

  // 1) 結算開倉中的訊號
  for (const s of ledger) {
    if (s.status !== "open") continue;
    const q = byTicker.get(s.ticker)?.quote ?? null;
    const aged = nowMs - Date.parse(s.createdAt) > HORIZON_MS;
    if (q && q.current > 0) {
      // 同一天開的單只用「現價」判斷，避免拿到開倉前的當日高低點而誤結算；
      // 隔天起才用當日高低（此時高低點都在開倉之後）。
      const sameDay = s.createdAt.slice(0, 10) === nowISO.slice(0, 10);
      const hi = sameDay ? q.current : q.high || q.current;
      const lo = sameDay ? q.current : q.low || q.current;
      if (s.direction === "long") {
        if (lo <= s.stop) {
          s.status = "hit_stop";
          s.closePrice = s.stop;
          s.rMultiple = -1;
        } else if (hi >= s.target) {
          s.status = "hit_target";
          s.closePrice = s.target;
          s.rMultiple = realizedR(s, s.target); // 按實際止盈距離算（逆勢的止盈較近，非固定 +2R）
        }
      } else {
        if (hi >= s.stop) {
          s.status = "hit_stop";
          s.closePrice = s.stop;
          s.rMultiple = -1;
        } else if (lo <= s.target) {
          s.status = "hit_target";
          s.closePrice = s.target;
          s.rMultiple = realizedR(s, s.target); // 按實際止盈距離算（逆勢的止盈較近，非固定 +2R）
        }
      }
      if (s.status === "open" && aged) {
        s.status = "expired";
        s.closePrice = q.current;
        s.rMultiple = realizedR(s, q.current);
      }
    } else if (aged) {
      s.status = "expired";
      s.closePrice = s.entry;
      s.rMultiple = 0;
    }
    if (s.status !== "open" && !s.closedAt) s.closedAt = nowISO;
  }

  // 2) 記錄新訊號：每套策略 × 每檔，符合規則且該(策略,標的)目前沒有開倉中 → 開一筆
  const openSet = new Set(
    ledger.filter((s) => s.status === "open").map((s) => `${s.strategy}::${s.ticker}`),
  );
  for (const strat of STRATEGIES) {
    for (const t of tickers) {
      const key = `${strat.name}::${t.ticker}`;
      if (openSet.has(key)) continue;
      const sig = strat.evaluate(t);
      if (!sig) continue;
      ledger.push({
        id: `${strat.name}-${t.ticker}-${nowMs}`,
        strategy: strat.name,
        ticker: t.ticker,
        direction: sig.direction,
        createdAt: nowISO,
        createdPrice: t.quote?.current ?? sig.entry,
        entry: sig.entry,
        stop: sig.stop,
        target: sig.target,
        riskPerShare: sig.riskPerShare,
        status: "open",
      });
      openSet.add(key);
    }
  }

  // 3) 修剪：保留全部 open + 最近 MAX_CLOSED 筆 closed
  const open = ledger.filter((s) => s.status === "open");
  const closed = ledger
    .filter((s) => s.status !== "open")
    .sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? ""))
    .slice(0, MAX_CLOSED);

  return {
    ledger: [...open, ...closed],
    summary: summarize(closed, open, (tk) => byTicker.get(tk)?.quote?.current ?? null, nowMs),
  };
}

function stat(arr: TrackedSignal[]): TrackStat {
  const wins = arr.filter((s) => s.status === "hit_target").length;
  const losses = arr.filter((s) => s.status === "hit_stop").length;
  const decided = wins + losses;
  const totalR = arr.reduce((a, s) => a + (s.rMultiple ?? 0), 0);
  const totalHKD = arr.reduce(
    (a, s) => a + (s.closePrice != null ? pnlHKD(s, s.closePrice) : 0),
    0,
  );
  return {
    closed: arr.length,
    wins,
    losses,
    winRate: decided ? wins / decided : 0,
    avgR: arr.length ? totalR / arr.length : 0,
    totalR: Number(totalR.toFixed(2)),
    totalHKD: Number(totalHKD.toFixed(2)),
  };
}

// 活動度：從第一筆到現在幾天、共幾單、平均每日幾單
function activity(
  trades: TrackedSignal[],
  nowMs: number,
): { days: number; trades: number; perDay: number } {
  if (!trades.length) return { days: 0, trades: 0, perDay: 0 };
  let first = Infinity;
  for (const t of trades) {
    const ms = Date.parse(t.createdAt);
    if (Number.isFinite(ms) && ms < first) first = ms;
  }
  const days = Number.isFinite(first)
    ? Math.max(1, Math.round((nowMs - first) / 86_400_000))
    : 1;
  return { days, trades: trades.length, perDay: Number((trades.length / days).toFixed(1)) };
}

function summarize(
  closed: TrackedSignal[],
  open: TrackedSignal[],
  priceOf: (ticker: string) => number | null,
  nowMs: number,
): TrackSummary {
  const all = [...closed, ...open];
  const byStrategy: StrategyStat[] = STRATEGIES.map((s) => ({
    name: s.name,
    ...stat(closed.filter((c) => c.strategy === s.name)),
    ...activity(all.filter((x) => x.strategy === s.name), nowMs),
  }));
  // 進行中的模擬單：附上目前浮動 R（依現價），讓前端顯示「個別情況」
  const openList: TrackedSignal[] = open.map((o) => {
    const cur = priceOf(o.ticker);
    const ur =
      cur && cur > 0 && o.riskPerShare > 0
        ? Number((((o.direction === "long" ? 1 : -1) * (cur - o.entry)) / o.riskPerShare).toFixed(2))
        : undefined;
    const hkd = cur && cur > 0 ? pnlHKD(o, cur) : undefined;
    return { ...o, unrealizedR: ur, pnlHKD: hkd };
  });
  const recent = closed.slice(0, 15).map((c) => ({
    ...c,
    pnlHKD: c.closePrice != null ? pnlHKD(c, c.closePrice) : undefined,
  }));
  return {
    ...stat(closed),
    ...activity(all, nowMs),
    open: open.length,
    byStrategy,
    recent,
    openList,
  };
}
