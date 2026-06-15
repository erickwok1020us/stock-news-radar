// 焦點（行動優先首頁）：跨股票+持倉的「今天該做什麼」排序清單，下面收合觀望標的。
import { buildFocus } from "@/lib/focus";
import type { FocusItem } from "@/lib/focus";
import type { Snapshot } from "@/lib/types";

const TONE: Record<FocusItem["tone"], { color: string; border: string; glow: string }> = {
  exit: { color: "var(--bear)", border: "rgba(255,62,77,0.45)", glow: "0 0 12px rgba(255,62,77,0.12)" },
  short: { color: "var(--bear)", border: "rgba(255,62,77,0.45)", glow: "0 0 12px rgba(255,62,77,0.12)" },
  long: { color: "var(--bull)", border: "rgba(44,240,122,0.45)", glow: "0 0 12px rgba(44,240,122,0.12)" },
  protect: { color: "var(--bull)", border: "rgba(44,240,122,0.45)", glow: "0 0 12px rgba(44,240,122,0.12)" },
  trim: { color: "var(--rumor)", border: "rgba(255,210,77,0.4)", glow: "0 0 12px rgba(255,210,77,0.1)" },
  review: { color: "var(--rumor)", border: "rgba(255,210,77,0.4)", glow: "0 0 12px rgba(255,210,77,0.1)" },
  notice: { color: "var(--rumor)", border: "rgba(255,210,77,0.4)", glow: "0 0 12px rgba(255,210,77,0.1)" },
};

export function FocusView({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <div className="empty">載入中…</div>;
  const { actions, watching } = buildFocus(snap);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>需要動作</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{actions.length} 件</span>
      </div>

      {actions.length === 0 ? (
        <div className="empty" style={{ padding: "32px 0" }}>目前沒有需要動作的 — 觀望即可。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((a, i) => {
            const c = TONE[a.tone];
            return (
              <div key={i} className="card" style={{ padding: "11px 13px", borderColor: c.border, boxShadow: c.glow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#0a0b14", background: c.color, padding: "2px 9px", borderRadius: 6 }}>
                    {a.label}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>${a.ticker}</span>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{a.title}</span>
                  {a.chip && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#34e2e8", border: "0.5px solid rgba(52,226,232,0.4)", borderRadius: 6, padding: "1px 7px", whiteSpace: "nowrap" }}>
                      {a.chip}
                    </span>
                  )}
                </div>
                {a.detail && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>{a.detail}</div>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14, padding: "10px 13px", background: "#0d101a", border: "0.5px solid var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>
        觀望中 {watching.length} 檔{watching.length ? `：${watching.join("、")}` : ""} — 無立即動作
      </div>
      <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 11.5, textAlign: "center", opacity: 0.7 }}>
        ↓ 想深入：切上方 短線 · 長期 · 持倉 · 成效
      </div>
    </div>
  );
}
