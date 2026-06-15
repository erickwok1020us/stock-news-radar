// 行動優先首頁的合成邏輯：把所有股票+持倉，整理成一條「今天該做什麼」的排序清單。
// 純函式，可單獨測試。把「資料」濃縮成「動作」。
import type { Snapshot } from "./types";

export interface FocusItem {
  tone: "exit" | "trim" | "protect" | "review" | "long" | "short" | "notice";
  priority: number;
  ticker: string;
  label: string;
  title: string;
  detail: string;
  chip?: string;
}

export interface Focus {
  actions: FocusItem[];
  watching: string[];
}

const POS_TONE: Record<
  string,
  { tone: FocusItem["tone"]; label: string; priority: number }
> = {
  exit: { tone: "exit", label: "出場", priority: 100 },
  take_partial: { tone: "trim", label: "減碼", priority: 82 },
  review: { tone: "review", label: "檢視", priority: 80 },
  move_stop_be: { tone: "protect", label: "保本", priority: 62 },
  trail_stop: { tone: "protect", label: "移動止損", priority: 60 },
};

function winChip(track: Snapshot["track"], dir: "long" | "short"): string {
  const d = track?.byDirection?.[dir];
  const name = dir === "long" ? "做多" : "做空";
  if (!d || d.wins + d.losses === 0) return `${name}勝率 累積中`;
  return `你${name}勝率 ${Math.round(d.winRate * 100)}% · ${d.wins + d.losses}筆`;
}

export function buildFocus(snap: Snapshot): Focus {
  const actions: FocusItem[] = [];
  const acted = new Set<string>();

  // 1) 持倉行動（只列需要注意的）
  for (const r of snap.positions) {
    if (!r.urgent) continue;
    const m = POS_TONE[r.action];
    if (!m) continue;
    actions.push({
      tone: m.tone,
      label: m.label,
      priority: m.priority,
      ticker: r.position.ticker,
      title: r.reason,
      detail: `現價 ${r.price} · 損益 ${r.pnlPct >= 0 ? "+" : ""}${(r.pnlPct * 100).toFixed(1)}%${
        r.suggestedStop ? ` · 建議止損/檢討價 ${r.suggestedStop}` : ""
      }`,
    });
    acted.add(r.position.ticker);
  }

  // 2) 進場設定（watchlist 有明確方向的），依時機分+熱度排序
  const entries = snap.tickers
    .filter(
      (t) =>
        !acted.has(t.ticker) && // 已有持倉動作的標的不再列進場
        t.day &&
        t.timing &&
        (t.timing.direction === "long" || t.timing.direction === "short"),
    )
    .sort((a, b) => b.timing!.score - a.timing!.score || b.heat - a.heat);
  for (const t of entries) {
    const dir = t.timing!.direction as "long" | "short";
    const d = t.day!;
    actions.push({
      tone: dir,
      label: dir === "long" ? "做多" : "做空",
      priority: 40 + t.timing!.score * 8 + t.heat / 50,
      ticker: t.ticker,
      title:
        dir === "long"
          ? `順勢做多 · 突破 ${d.breakout}`
          : `順勢做空 · 跌破 ${d.breakout}`,
      detail: `進場 ${d.entryZone[0]}–${d.entryZone[1]} · 止損 ${d.stop} · 止盈 ${d.target}`,
      chip: winChip(snap.track, dir),
    });
    acted.add(t.ticker);
  }

  // 3) 留意：大幅異動但還沒被列入的
  for (const t of snap.tickers) {
    if (acted.has(t.ticker)) continue;
    const chg = t.quote?.changePct ?? 0;
    if (Math.abs(chg) >= 5) {
      actions.push({
        tone: "notice",
        label: "留意",
        priority: 30 + Math.min(Math.abs(chg), 20),
        ticker: t.ticker,
        title: `${chg >= 0 ? "大漲" : "大跌"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`,
        detail: t.timing ? `時機：${t.timing.label}` : "",
      });
      acted.add(t.ticker);
    }
  }

  actions.sort((a, b) => b.priority - a.priority);
  const watching = snap.tickers.filter((t) => !acted.has(t.ticker)).map((t) => t.ticker);
  return { actions, watching };
}
