// 成效追蹤：把每次的短線訊號記成帳本，之後用後續價格自動結算（達標/停損/到期），
// 再算出勝率、平均 R、做多 vs 做空表現。純函式、透明。
import type {
  TickerSnapshot,
  TrackedSignal,
  TrackStat,
  TrackSummary,
} from "./types";

const HORIZON_MS = 7 * 86_400_000; // 7 天沒碰到止盈/止損就到期結算
const MAX_CLOSED = 200; // 帳本只保留最近 200 筆已結算

function realizedR(s: TrackedSignal, closePrice: number): number {
  if (s.riskPerShare <= 0) return 0;
  const dir = s.direction === "long" ? 1 : -1;
  return Number(((dir * (closePrice - s.entry)) / s.riskPerShare).toFixed(2));
}

/**
 * 每次 ingest 呼叫：先結算開倉中的訊號，再為「有方向的新設定」記一筆（每檔最多一個 open）。
 */
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
      // 先檢查停損（保守），再檢查止盈
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

  // 2) 記錄新訊號（方向為 long/short、有價位、且該檔目前沒有開倉中的）
  const openTickers = new Set(
    ledger.filter((s) => s.status === "open").map((s) => s.ticker),
  );
  for (const t of tickers) {
    const dir = t.timing?.direction;
    if (
      (dir === "long" || dir === "short") &&
      t.day &&
      t.quote &&
      !openTickers.has(t.ticker)
    ) {
      const entry = (t.day.entryZone[0] + t.day.entryZone[1]) / 2;
      ledger.push({
        id: `${t.ticker}-${nowMs}`,
        ticker: t.ticker,
        direction: dir,
        createdAt: nowISO,
        createdPrice: t.quote.current,
        entry: Number(entry.toFixed(2)),
        stop: t.day.stop,
        target: t.day.target,
        riskPerShare: t.day.riskPerShare,
        status: "open",
      });
      openTickers.add(t.ticker);
    }
  }

  // 3) 修剪：保留全部 open + 最近 MAX_CLOSED 筆 closed
  const open = ledger.filter((s) => s.status === "open");
  const closed = ledger
    .filter((s) => s.status !== "open")
    .sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? ""))
    .slice(0, MAX_CLOSED);

  return { ledger: [...open, ...closed], summary: summarize(closed, open.length) };
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

function summarize(closed: TrackedSignal[], openCount: number): TrackSummary {
  return {
    ...stat(closed),
    open: openCount,
    byDirection: {
      long: stat(closed.filter((s) => s.direction === "long")),
      short: stat(closed.filter((s) => s.direction === "short")),
    },
    recent: closed.slice(0, 12),
  };
}
