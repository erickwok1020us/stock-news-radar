"use client";
// 策略擂台：多套公式各自一份成績表（含派別標籤 + 「每單 100 港幣」金額換算）。
// 頂部頁籤可切「全部 / 單一策略」；記分板、卡片、進行中單、結算明細都會跟著篩選。
import { useState } from "react";
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
const md = (iso: string) => {
  const [m, d] = iso.slice(5, 10).split("-");
  return `${+m}/${+d}`;
};
const BASIS: Record<string, string> = Object.fromEntries(STRATEGIES.map((s) => [s.name, s.basis]));
const STYLE: Record<string, string> = Object.fromEntries(STRATEGIES.map((s) => [s.name, s.style]));
const STYLE_COLOR: Record<string, string> = {
  順勢: "#ff9f43",
  逆勢: "#34e2e8",
  事件: "#a78bfa",
  綜合: "#8a90a2",
};

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 88 }}>
      <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, color: color ?? "inherit", lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 10.5 }}>{sub}</div>}
    </div>
  );
}

function StrategyCard({ s, best, openHKD }: { s: StrategyStat; best: boolean; openHKD: number }) {
  const decided = s.wins + s.losses;
  const stake = s.closed * 100;
  const roi = stake > 0 ? (s.totalHKD / stake) * 100 : 0;
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
        <span style={{ fontSize: 10.5, color: STYLE_COLOR[STYLE[s.name]] ?? "var(--muted)", border: `1px solid ${STYLE_COLOR[STYLE[s.name]] ?? "var(--border)"}`, padding: "0 6px", borderRadius: 999 }}>{STYLE[s.name]}</span>
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

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
        下注 {stake.toLocaleString()} · 已結算{" "}
        <span style={{ color: col(s.totalHKD), fontWeight: 500 }}>{hkd(s.totalHKD)}</span>
        {s.closed > 0 && (
          <span style={{ color: col(s.totalHKD) }}>（{roi >= 0 ? "+" : ""}{roi.toFixed(1)}%）</span>
        )}
        {" · "}浮動 <span style={{ color: col(openHKD) }}>{hkd(openHKD)}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
        {s.days} 天 · 共 {s.trades} 單 · 平均 {s.perDay} 單/日
      </div>
    </div>
  );
}

export function TrackView({ track }: { track: TrackSummary | null }) {
  const [sel, setSel] = useState("全部");

  if (!track || (track.closed === 0 && track.open === 0)) {
    return <div className="empty">尚無訊號 — 等第一次 ingest 跑完後開始累積。</div>;
  }

  const one = sel === "全部" ? null : track.byStrategy.find((x) => x.name === sel) ?? null;

  const floatByStrat: Record<string, number> = {};
  for (const o of track.openList ?? []) {
    floatByStrat[o.strategy] = (floatByStrat[o.strategy] ?? 0) + (o.pnlHKD ?? 0);
  }

  const visOpen = (track.openList ?? []).filter((o) => sel === "全部" || o.strategy === sel);
  const visRecent = track.recent.filter((s) => sel === "全部" || s.strategy === sel);
  const openL = visOpen.filter((o) => o.direction === "long").length;
  const openS = visOpen.length - openL;
  const floatSel = visOpen.reduce((a, o) => a + (o.pnlHKD ?? 0), 0);

  const sbClosed = one ? one.closed : track.closed;
  const sbHKD = one ? one.totalHKD : track.totalHKD;
  const sbWins = one ? one.wins : track.wins;
  const sbLosses = one ? one.losses : track.losses;
  const sbWinRate = one ? one.winRate : track.winRate;
  const sbDays = one ? one.days : track.days;
  const sbTrades = one ? one.trades : track.trades;
  const sbPerDay = one ? one.perDay : track.perDay;
  const sbStake = sbClosed * 100;
  const sbRoi = sbStake > 0 ? (sbHKD / sbStake) * 100 : 0;
  const sbDecided = sbWins + sbLosses;

  const ranked = [...track.byStrategy].sort((a, b) => {
    const da = a.wins + a.losses;
    const db = b.wins + b.losses;
    if (da === 0 && db === 0)
      return (floatByStrat[b.name] ?? 0) - (floatByStrat[a.name] ?? 0) || b.closed - a.closed;
    if (da === 0) return 1;
    if (db === 0) return -1;
    return b.totalHKD - a.totalHKD || b.winRate - a.winRate;
  });
  const bestName = ranked.find((s) => s.wins + s.losses > 0)?.name;
  const visCards = ranked.filter((s) => sel === "全部" || s.name === sel);

  const tabs = ["全部", ...STRATEGIES.map((s) => s.name)];

  // 今日可跟單：挑一套（選取的 or 推薦最佳），列出「今天剛出、現價還貼近進場價」的訊號
  const qualified = [...track.byStrategy]
    .filter((s) => s.wins + s.losses >= 15 && s.winRate >= 0.55 && s.totalHKD > 0)
    .sort((a, b) => b.totalHKD - a.totalHKD);
  const followStat = one ?? qualified[0] ?? null;
  const followName = followStat?.name ?? null;
  const followRoi = followStat && followStat.closed > 0 ? (followStat.totalHKD / (followStat.closed * 100)) * 100 : 0;
  const actionable = followName
    ? (track.openList ?? [])
        .filter((o) => o.strategy === followName && (o.ageDays ?? 9) === 0 && Math.abs(o.unrealizedR ?? 9) < 0.5)
        .sort((a, b) => Math.abs(a.unrealizedR ?? 9) - Math.abs(b.unrealizedR ?? 9))
    : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>策略擂台</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>已結算 {track.closed} · 觀察中 {track.open}</span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tabs.map((name) => {
          const active = sel === name;
          const c = name === "全部" ? "#34e2e8" : STYLE_COLOR[STYLE[name]] ?? "var(--muted)";
          return (
            <button
              key={name}
              onClick={() => setSel(name)}
              style={{
                fontSize: 12,
                padding: "3px 11px",
                borderRadius: 999,
                cursor: "pointer",
                whiteSpace: "nowrap",
                border: `1px solid ${active ? c : "var(--border)"}`,
                background: active ? c : "transparent",
                color: active ? "#0a0b14" : "var(--muted)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* 🎯 今日可跟單：把「哪套準」直接變成「今天照它買什麼」 */}
      {followStat ? (
        <div style={{ border: "1px solid rgba(52,226,232,0.4)", borderRadius: 10, padding: "10px 14px", margin: "0 0 12px", background: "rgba(52,226,232,0.06)" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: actionable.length ? 6 : 4 }}>
            🎯 今日可跟單 — 跟「{followName}」
            {one ? "" : <span style={{ color: "#34e2e8" }}>（建議：目前最佳）</span>}
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>　勝率 {pct(followStat.winRate)} · 報酬率 {followRoi >= 0 ? "+" : ""}{followRoi.toFixed(1)}% · {followStat.trades} 單</span>
          </div>
          {actionable.length ? (
            <ul className="news">
              {actionable.map((o) => (
                <li key={o.id}>
                  <div className="line">
                    <span className="tag" style={{ background: "#1f2435", color: o.direction === "long" ? "var(--bull)" : "var(--bear)" }}>{DIRLABEL[o.direction]}</span>
                    <span className="head">${o.ticker}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>進場 ~{o.entry} · 止損 {o.stop} · 止盈 {o.target}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>這套今天暫無「剛出、現價還貼近進場」的新訊號 — 等下一個，或點其他頁籤看別套。</div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            只列今天剛觸發、現價還貼近進場價的訊號。你在券商照這價位進場、設好止損止盈即可（工具不自動下單）。
          </div>
        </div>
      ) : (
        sel === "全部" && (
          <div className="muted-note" style={{ marginBottom: 12 }}>
            🎯 還沒有一套累積到夠格「建議跟隨」（門檻：≥15 筆、勝率 ≥55%、且賺錢）。先讓它多跑幾天，或點上面頁籤自己挑一套跟。
          </div>
        )
      )}

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, margin: "0 0 12px" }}>
        <Stat label={one ? `${sel}·下注` : "總下注（已結算）"} value={`${sbStake.toLocaleString()} HKD`} sub={`${sbClosed} 筆 × 100`} />
        <Stat label="總盈虧" value={hkd(sbHKD)} color={col(sbHKD)} />
        <Stat label="報酬率" value={`${sbRoi >= 0 ? "+" : ""}${sbRoi.toFixed(1)}%`} color={col(sbRoi)} />
        <Stat label="勝率" value={sbDecided ? pct(sbWinRate) : "—"} sub={`${sbWins}勝 / ${sbLosses}敗`} color={sbDecided ? (sbWinRate >= 0.5 ? "var(--bull)" : "var(--bear)") : undefined} />
        <Stat label="進行中浮動" value={hkd(floatSel)} color={col(floatSel)} sub={`${visOpen.length} 筆 · ${(visOpen.length * 100).toLocaleString()} HKD`} />
        <Stat label="運行天數" value={`${sbDays} 天`} sub={`共 ${sbTrades} 單 · 平均 ${sbPerDay} 單/日`} />
      </div>

      {sel === "全部" && (
        <div className="muted-note" style={{ marginBottom: 12 }}>
          {track.byStrategy.length} 套公式各自下模擬單、自動結算，<b>每張單投入 100 港幣</b>（<span style={{ color: STYLE_COLOR["順勢"] }}>順勢</span>追漲殺跌 vs <span style={{ color: STYLE_COLOR["逆勢"] }}>逆勢</span>抄底摸頂，故意對打看哪派賺）。
          {track.wins + track.losses === 0 ? "結算數要幾天才長出來，先看浮動。" : ""}
        </div>
      )}

      <div className="grid">
        {visCards.map((s) => (
          <StrategyCard key={s.name} s={s} best={s.name === bestName} openHKD={floatByStrat[s.name] ?? 0} />
        ))}
      </div>

      {visOpen.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 6px" }}>
            進行中的模擬單（{visOpen.length} 筆 · <span style={{ color: "var(--bull)" }}>做多 {openL}</span> / <span style={{ color: "var(--bear)" }}>做空 {openS}</span>）— 押什麼、開幾天、浮動損益（每單 100 港幣）
          </div>
          {STRATEGIES.filter((s) => sel === "全部" || s.name === sel).map((strat) => {
            const orders = [...visOpen]
              .filter((o) => o.strategy === strat.name)
              .sort((a, b) => (b.pnlHKD ?? -99) - (a.pnlHKD ?? -99));
            if (!orders.length) return null;
            const ol = orders.filter((o) => o.direction === "long").length;
            const os = orders.length - ol;
            return (
              <div key={strat.name} style={{ marginBottom: 8 }}>
                <div style={{ color: "var(--muted)", fontSize: 11.5, margin: "8px 0 3px" }}>
                  {strat.name}（<span style={{ color: "var(--bull)" }}>做多 {ol}</span> · <span style={{ color: "var(--bear)" }}>做空 {os}</span>）
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
                        <span style={{ fontSize: 11, color: (o.ageDays ?? 0) >= 2 ? "#ffb454" : "var(--muted)", whiteSpace: "nowrap" }}>
                          開 {md(o.createdAt)} · {o.ageDays ?? 0}天
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

      {visRecent.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 8px" }}>最近結算</div>
          <ul className="news">
            {visRecent.map((s) => {
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
