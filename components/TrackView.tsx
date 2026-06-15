// 策略擂台：5 套公式各自一份成績表，依勝率排名、標出領先者；下面是最近結算明細。
import { STRATEGIES } from "@/lib/strategies";
import type { StrategyStat, TrackSummary } from "@/lib/types";

const DIRLABEL = { long: "做多", short: "做空" } as const;
const STATUS = {
  hit_target: { text: "達標", color: "var(--bull)" },
  hit_stop: { text: "停損", color: "var(--bear)" },
  expired: { text: "到期", color: "var(--muted)" },
  open: { text: "持有中", color: "var(--neutral)" },
} as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const rr = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const BASIS: Record<string, string> = Object.fromEntries(STRATEGIES.map((s) => [s.name, s.basis]));

function StrategyCard({ s, best }: { s: StrategyStat; best: boolean }) {
  const decided = s.wins + s.losses;
  return (
    <div
      className="card"
      style={{
        borderColor: best ? "rgba(52,226,232,0.5)" : "var(--border)",
        boxShadow: best ? "0 0 16px rgba(52,226,232,0.14)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{s.name}</span>
        {best && (
          <span style={{ fontSize: 11, color: "#0a0b14", background: "#34e2e8", padding: "1px 7px", borderRadius: 999 }}>領先</span>
        )}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 10, lineHeight: 1.4 }}>{BASIS[s.name] ?? ""}</div>

      {decided === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>累積中（已結算 {s.closed} 筆，尚無勝負）</div>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>勝率</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: s.winRate >= 0.5 ? "var(--bull)" : "var(--bear)" }}>{pct(s.winRate)}</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 12.5, color: "var(--muted)" }}>
            <div>
              平均 <span style={{ color: s.avgR >= 0 ? "var(--bull)" : "var(--bear)" }}>{rr(s.avgR)}</span> · 累積{" "}
              <span style={{ color: s.totalR >= 0 ? "var(--bull)" : "var(--bear)" }}>{rr(s.totalR)}</span>
            </div>
            <div>{s.wins}勝 / {s.losses}敗（{s.closed} 筆）</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrackView({ track }: { track: TrackSummary | null }) {
  if (!track || (track.closed === 0 && track.open === 0)) {
    return <div className="empty">尚無訊號 — 等第一次 ingest 跑完後開始累積。</div>;
  }

  const ranked = [...track.byStrategy].sort((a, b) => {
    const da = a.wins + a.losses;
    const db = b.wins + b.losses;
    if (da === 0 && db === 0) return b.closed - a.closed;
    if (da === 0) return 1;
    if (db === 0) return -1;
    return b.winRate - a.winRate || b.totalR - a.totalR;
  });
  const bestName = ranked.find((s) => s.wins + s.losses > 0)?.name;
  const decidedTotal = track.wins + track.losses;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>策略擂台</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>已結算 {track.closed} · 觀察中 {track.open}</span>
      </div>
      <div className="muted-note" style={{ marginBottom: 12 }}>
        5 套公式各自自動下模擬單、自動結算。{decidedTotal === 0 ? "剛開始是空的，需要幾天累積出勝負才看得出高下。" : "長期累積，比出最穩的那套。"}
      </div>

      <div className="grid">
        {ranked.map((s) => (
          <StrategyCard key={s.name} s={s} best={s.name === bestName} />
        ))}
      </div>

      {track.recent.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 8px" }}>最近結算</div>
          <ul className="news">
            {track.recent.map((s) => {
              const st = STATUS[s.status];
              return (
                <li key={s.id}>
                  <div className="line">
                    <span className="tag" style={{ background: "#1f2435", color: "var(--muted)" }}>{s.strategy}</span>
                    <span className="tag" style={{ background: "#1f2435", color: s.direction === "long" ? "var(--bull)" : "var(--bear)" }}>{DIRLABEL[s.direction]}</span>
                    <span className="head">${s.ticker} {s.entry}→{s.closePrice}</span>
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
