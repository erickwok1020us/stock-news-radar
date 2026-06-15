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

const HORIZON_MS = 7 * 86_400_000; // 7 天沒結果就到期結算
const MAX_CLOSED = 400; // 帳本保留最近 400 筆已結算

function realizedR(s: TrackedSignal, closePrice: number): number {
  if (s.riskPerShare <= 0) return 0;
  const dir = s.direction === "long" ? 1 : -1;
  return Number(((dir * (closePrice - s.entry)) / s.riskPerShare).toFixed(2));
}

export function updateTrack(
  ledger: TrackedSignal[],
  tickers: TickerSnapshot[],
  nowMs: number,
  nowISO: string,
): { ledger: TrackedSignal[]; summary: TrackSummary } {
  const byTicker = new Map(tickers.map((t) => [t.ticker, t]));

  // 1) 結算開倉中的訊號
  for (const s of ledger) {
    if (s.status !== "open") continue;
    const q = byTicker.get(s.ticker)?.quote ?? null;
    const aged = nowMs - Date.parse(s.createdAt) > HORIZON_MS;
    if (q) {
      const hi = q.high || q.current;
      const lo = q.low || q.current;
      if (s.direction === "long") {
        if (lo <= s.stop) {
          s.status = "hit_stop";
          s.closePrice = s.stop;
          s.rMultiple = -1;
        } else if (hi >= s.target) {
          s.status = "hit_target";
          s.closePrice = s.target;
          s.rMultiple = 2;
        }
      } else {
        if (hi >= s.stop) {
          s.status = "hit_stop";
          s.closePrice = s.stop;
          s.rMultiple = -1;
        } else if (lo <= s.target) {
          s.status = "hit_target";
          s.closePrice = s.target;
          s.rMultiple = 2;
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

  return { ledger: [...open, ...closed], summary: summarize(closed, open) };
}

function stat(arr: TrackedSignal[]): TrackStat {
  const wins = arr.filter((s) => s.status === "hit_target").length;
  const losses = arr.filter((s) => s.status === "hit_stop").length;
  const decided = wins + losses;
  const totalR = arr.reduce((a, s) => a + (s.rMultiple ?? 0), 0);
  return {
    closed: arr.length,
    wins,
    losses,
    winRate: decided ? wins / decided : 0,
    avgR: arr.length ? totalR / arr.length : 0,
    totalR: Number(totalR.toFixed(2)),
  };
}

function summarize(closed: TrackedSignal[], open: TrackedSignal[]): TrackSummary {
  const byStrategy: StrategyStat[] = STRATEGIES.map((s) => ({
    name: s.name,
    ...stat(closed.filter((c) => c.strategy === s.name)),
  }));
  return {
    ...stat(closed),
    open: open.length,
    byStrategy,
    recent: closed.slice(0, 15),
  };
}
