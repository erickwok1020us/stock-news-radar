// 成效追蹤頁：訊號回測摘要（勝率/累積R/做多vs做空）+ 最近結算清單
import type { TrackStat, TrackSummary } from "@/lib/types";

const DIRLABEL = { long: "做多", short: "做空" } as const;
const STATUS = {
  hit_target: { text: "達標", color: "var(--bull)" },
  hit_stop: { text: "停損", color: "var(--bear)" },
  expired: { text: "到期", color: "var(--muted)" },
  open: { text: "持有中", color: "var(--neutral)" },
} as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const rr = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

function StatRow({ label, s }: { label: string; s: TrackStat }) {
  return (
    <div className="lv">
      <span className="k">{label}</span>
      <span className="v">
        {s.wins + s.losses === 0 ? (
          `觀察中（尚無結算）`
        ) : (
          <>
            勝率 {pct(s.winRate)} · 平均{" "}
            <span style={{ color: s.avgR >= 0 ? "var(--bull)" : "var(--bear)" }}>{rr(s.avgR)}</span>{" "}
            · {s.wins}勝/{s.losses}敗
          </>
        )}
      </span>
    </div>
  );
}

export function TrackView({ track }: { track: TrackSummary | null }) {
  if (!track || (track.closed === 0 && track.open === 0)) {
    return <div className="empty">尚無訊號 — 等第一次 ingest 跑完後開始累積。</div>;
  }
  const decided = track.wins + track.losses;

  return (
    <div>
      <div className="summary">
        <div>
          <div className="k">勝率</div>
          <div className="big" style={{ color: track.winRate >= 0.5 ? "var(--bull)" : "var(--bear)" }}>
            {decided ? pct(track.winRate) : "—"}
          </div>
        </div>
        <div className="sep" />
        <div>
          <div className="k">累積 R</div>
          <div className="mid" style={{ color: track.totalR >= 0 ? "var(--bull)" : "var(--bear)" }}>{rr(track.totalR)}</div>
        </div>
        <div><div className="k">已結算</div><div className="mid">{track.closed} 筆</div></div>
        <div><div className="k">觀察中</div><div className="mid">{track.open} 筆</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="lvbox">
          <StatRow label="做多" s={track.byDirection.long} />
          <StatRow label="做空" s={track.byDirection.short} />
        </div>
      </div>

      {decided === 0 && (
        <div className="muted-note" style={{ marginBottom: 12 }}>
          訊號要碰到止盈/止損或到期（7 天）才算數，剛開始是空的——過幾天才會有勝率數據。目前 {track.open} 筆觀察中。
        </div>
      )}

      {track.recent.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 8px" }}>最近結算</div>
          <ul className="news">
            {track.recent.map((s) => {
              const st = STATUS[s.status];
              return (
                <li key={s.id}>
                  <div className="line">
                    <span className="time">
                      {new Date(s.closedAt ?? s.createdAt).toLocaleDateString("zh-Hant")}
                    </span>
                    <span className="tag" style={{ background: "#1f2435", color: s.direction === "long" ? "var(--bull)" : "var(--bear)" }}>
                      {DIRLABEL[s.direction]}
                    </span>
                    <span className="head">${s.ticker} {s.entry} → {s.closePrice}</span>
                    <span style={{ marginLeft: "auto", color: st.color, fontSize: 12, whiteSpace: "nowrap" }}>
                      {st.text} {s.rMultiple != null ? rr(s.rMultiple) : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
