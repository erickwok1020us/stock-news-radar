// 策略擂台：5 套公式各自一份成績表（含「每單 100 港幣」金額換算），依勝率/金額排名、標出領先者；
// 中段是各策略進行中的模擬單，最下面是最近結算明細。
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
const hkd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} HKD`;
const col = (n: number) => (n >= 0 ? "var(--bull)" : "var(--bear)");
const BASIS: Record<string, string> = Object.fromEntries(STRATEGIES.map((s) => [s.name, s.basis]));

function StrategyCard({ s, best, openHKD }: { s: StrategyStat; best: boolean; openHKD: number }) {
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
              平均 <span style={{ color: col(s.avgR) }}>{rr(s.avgR)}</span> · 累積{" "}
              <span style={{ color: col(s.totalR) }}>{rr(s.totalR)}</span>
            </div>
            <div>{s.wins}勝 / {s.losses}敗（{s.closed} 筆）</div>
          </div>
        </div>
      )}

      {/* 假設每單 100 港幣 → 真金白銀結果 */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--muted)" }}>
        每單 100 港幣：已結算 <span style={{ color: col(s.totalHKD), fontWeight: 500 }}>{hkd(s.totalHKD)}</span>
        {" · "}浮動 <span style={{ color: col(openHKD) }}>{hkd(openHKD)}</span>
      </div>
    </div>
  );
}

export function TrackView({ track }: { track: TrackSummary | null }) {
  if (!track || (track.closed === 0 && track.open === 0)) {
    return <div className="empty">尚無訊號 — 等第一次 ingest 跑完後開始累積。</div>;
  }

  // 各策略目前進行中模擬單的浮動港幣（從 openList 加總）
  const floatByStrat: Record<string, number> = {};
  for (const o of track.openList ?? []) {
    floatByStrat[o.strategy] = (floatByStrat[o.strategy] ?? 0) + (o.pnlHKD ?? 0);
  }
  const totalFloatHKD = Object.values(floatByStrat).reduce((a, b) => a + b, 0);

  const ranked = [...track.byStrategy].sort((a, b) => {
    const da = a.wins + a.losses;
    const db = b.wins + b.losses;
    // 都還沒分出勝負 → 先排浮動金額多的（早期領先指標）
    if (da === 0 && db === 0)
      return (floatByStrat[b.name] ?? 0) - (floatByStrat[a.name] ?? 0) || b.closed - a.closed;
    if (da === 0) return 1;
    if (db === 0) return -1;
    return b.totalHKD - a.totalHKD || b.winRate - a.winRate;
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
        5 套公式各自自動下模擬單、自動結算。假設<b>每張單投入 100 港幣</b> → 合計：已結算{" "}
        <span style={{ color: col(track.totalHKD), fontWeight: 500 }}>{hkd(track.totalHKD)}</span>
        、進行中浮動 <span style={{ color: col(totalFloatHKD) }}>{hkd(totalFloatHKD)}</span>。
        {decidedTotal === 0 ? "結算數要幾天才長出來，先看浮動。" : ""}
      </div>

      <div className="grid">
        {ranked.map((s) => (
          <StrategyCard key={s.name} s={s} best={s.name === bestName} openHKD={floatByStrat[s.name] ?? 0} />
        ))}
      </div>

      {track.openList && track.openList.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 6px" }}>
            進行中的模擬單（{track.openList.length} 筆）— 每套策略現在各自押什麼、目前浮動損益（每單 100 港幣）
          </div>
          {STRATEGIES.map((strat) => {
            const orders = [...track.openList]
              .filter((o) => o.strategy === strat.name)
              .sort((a, b) => (b.pnlHKD ?? -99) - (a.pnlHKD ?? -99));
            if (!orders.length) return null;
            return (
              <div key={strat.name} style={{ marginBottom: 8 }}>
                <div style={{ color: "var(--muted)", fontSize: 11.5, margin: "8px 0 3px" }}>
                  {strat.name}（{orders.length}）
                </div>
                <ul className="news">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <div className="line">
                        <span className="tag" style={{ background: "#1f2435", color: o.direction === "long" ? "var(--bull)" : "var(--bear)" }}>
                          {DIRLABEL[o.direction]}
                        </span>
                        <span className="head">${o.ticker}</span>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          進{o.entry} · 損{o.stop} · 標{o.target}
                        </span>
                        {o.pnlHKD != null && (
                          <span style={{ marginLeft: "auto", fontSize: 12, whiteSpace: "nowrap", color: col(o.pnlHKD) }}>
                            浮動 {hkd(o.pnlHKD)}
                            {o.unrealizedR != null ? ` · ${rr(o.unrealizedR)}` : ""}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}

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
                      {s.pnlHKD != null ? `（${hkd(s.pnlHKD)}）` : ""}
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
