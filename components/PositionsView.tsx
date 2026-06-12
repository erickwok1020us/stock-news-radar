// 持倉管理頁：未實現損益總覽 + 每筆持倉的調整建議（止損/止盈/動作）
import type { Account, PosAction, PositionReview } from "@/lib/types";

const ACTION: Record<PosAction, { label: string; bg: string }> = {
  exit: { label: "出場", bg: "var(--bear)" },
  take_partial: { label: "部分減碼", bg: "var(--rumor)" },
  move_stop_be: { label: "移動止損 · 保本", bg: "var(--bull)" },
  trail_stop: { label: "移動止損 · 順勢", bg: "var(--bull)" },
  review: { label: "檢視", bg: "var(--rumor)" },
  hold: { label: "續抱", bg: "var(--neutral)" },
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function glowFor(r: PositionReview): { border: string; shadow: string } {
  if (r.action === "exit") return { border: "rgba(255,62,77,0.5)", shadow: "0 0 18px rgba(255,62,77,0.16)" };
  if (r.action === "review" || r.action === "take_partial")
    return { border: "rgba(255,210,77,0.4)", shadow: "0 0 16px rgba(255,210,77,0.12)" };
  if (r.action === "move_stop_be" || r.action === "trail_stop")
    return { border: "rgba(44,240,122,0.45)", shadow: "0 0 18px rgba(44,240,122,0.16)" };
  return { border: "rgba(154,163,178,0.22)", shadow: "0 0 14px rgba(154,163,178,0.07)" };
}

export function PositionsView({
  positions,
  account,
}: {
  positions: PositionReview[];
  account: Account;
}) {
  if (positions.length === 0) {
    return (
      <div className="empty">
        尚無持倉 — 在 <code>config/positions.json</code> 填入你的真實持倉就會出現。
      </div>
    );
  }

  let cost = 0;
  let value = 0;
  for (const r of positions) {
    cost += r.position.entry * r.position.shares;
    value += r.price * r.position.shares;
  }
  const pnl = value - cost;
  const pnlPct = cost > 0 ? pnl / cost : 0;
  const pnlColor = pnl >= 0 ? "var(--bull)" : "var(--bear)";

  return (
    <div>
      <div className="summary">
        <div>
          <div className="k">未實現損益</div>
          <div className="big" style={{ color: pnlColor }}>
            {pnl >= 0 ? "+" : "−"}{money(Math.abs(pnl))} <span style={{ fontSize: 14 }}>({(pnlPct * 100).toFixed(1)}%)</span>
          </div>
        </div>
        <div className="sep" />
        <div><div className="k">持倉市值</div><div className="mid">{money(value)}</div></div>
        <div><div className="k">成本</div><div className="mid">{money(cost)}</div></div>
        <div><div className="k">持倉數</div><div className="mid">{positions.length} 筆</div></div>
      </div>

      <div className="grid">
        {positions.map((r) => {
          const p = r.position;
          const skin = glowFor(r);
          const posPnlColor = r.pnlPct >= 0 ? "var(--bull)" : "var(--bear)";
          const stopLabel = p.mode === "day" ? "目前止損" : "目前檢討價";
          const curStop = p.stop && p.stop > 0 ? `${p.stop}` : "未設";
          const a = ACTION[r.action];
          return (
            <div key={p.id} className="card" style={{ borderColor: skin.border, boxShadow: skin.shadow }}>
              <div className="card-head">
                <span className="ticker">
                  ${p.ticker}{" "}
                  <span className="chip">{p.mode === "day" ? "短線" : "長期"}</span>
                </span>
                {r.urgent && (
                  <span style={{ fontSize: 11, color: "var(--rumor)" }}>● 已推播</span>
                )}
              </div>

              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
                {p.shares} 股 @ {p.entry}　·　現價 {r.price}
                <span style={{ color: posPnlColor }}>
                  {r.pnlPct >= 0 ? "+" : ""}{(r.pnlPct * 100).toFixed(1)}% ({r.pnlAmount >= 0 ? "+" : "−"}{money(Math.abs(r.pnlAmount))})
                </span>
              </div>

              <div className="stoprow">
                <div className="stopcell">
                  <div className="k">{stopLabel}</div>
                  <div className="v">{curStop}</div>
                </div>
                <div className="arrow">→</div>
                <div className="stopcell hl">
                  <div className="k" style={{ color: "#34e2e8" }}>建議</div>
                  <div className="v" style={{ color: "#34e2e8" }}>{r.suggestedStop ?? "維持"}</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#0a0b14", background: a.bg, padding: "2px 9px", borderRadius: 6 }}>
                  {a.label}
                </span>
                {r.rMultiple != null && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{r.rMultiple >= 0 ? "+" : ""}{r.rMultiple.toFixed(1)}R</span>
                )}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{r.reason}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
