// 模擬倉（Paper Trading）：你自己下模擬單、貼「公式標籤」，系統用快照價自動結算，
// 給出成績表（勝率/平均R/累積損益/資金曲線 + 按公式分組比較）。資料存瀏覽器 localStorage。
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Snapshot, TickerSnapshot } from "@/lib/types";

interface PaperTrade {
  id: string;
  ticker: string;
  direction: "long" | "short";
  entry: number;
  shares: number;
  stop?: number;
  target?: number;
  tag?: string;
  openedAt: number;
  status: "open" | "closed";
  closePrice?: number;
  closedAt?: number;
  exitReason?: "stop" | "target" | "manual";
}

const KEY = "paperTrades.v1";
const money = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function rMultiple(t: PaperTrade, close: number): number | null {
  if (!t.stop || t.stop <= 0) return null;
  const risk = Math.abs(t.entry - t.stop);
  if (risk === 0) return null;
  const dir = t.direction === "long" ? 1 : -1;
  return (dir * (close - t.entry)) / risk;
}
function pnlOf(t: PaperTrade, close: number): number {
  const dir = t.direction === "long" ? 1 : -1;
  return dir * (close - t.entry) * t.shares;
}

const inputStyle: React.CSSProperties = {
  background: "#0d101a",
  border: "0.5px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
};

export function PaperView({ snap }: { snap: Snapshot | null }) {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [ticker, setTicker] = useState("");
  const [dir, setDir] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");
  const [shares, setShares] = useState("10");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [tag, setTag] = useState("");

  // 載入 / 儲存
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setTrades(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(trades));
  }, [trades, loaded]);

  const tickers = snap?.tickers ?? [];
  const priceOf = (sym: string): TickerSnapshot | undefined =>
    tickers.find((t) => t.ticker === sym);

  // 選股票/方向時，自動帶入該檔的價位框架（工具的建議）
  useEffect(() => {
    const t = priceOf(ticker);
    if (!t?.quote) return;
    setEntry(String(t.quote.current));
    const d = t.day;
    if (d && d.direction === dir) {
      setStop(String(d.stop));
      setTarget(String(d.target));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, dir]);

  // 預設選第一檔
  useEffect(() => {
    if (!ticker && tickers.length) setTicker(tickers[0].ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.length]);

  // 自動結算：開倉單碰到止損/止盈就平倉（用快照的當日高低）
  useEffect(() => {
    if (!snap) return;
    let changed = false;
    const next = trades.map((t) => {
      if (t.status !== "open") return t;
      const q = priceOf(t.ticker)?.quote;
      if (!q) return t;
      const hi = q.high || q.current;
      const lo = q.low || q.current;
      const long = t.direction === "long";
      const close = (price: number, reason: PaperTrade["exitReason"]): PaperTrade => {
        changed = true;
        return { ...t, status: "closed", closePrice: price, closedAt: Date.now(), exitReason: reason };
      };
      if (t.stop) {
        if (long && lo <= t.stop) return close(t.stop, "stop");
        if (!long && hi >= t.stop) return close(t.stop, "stop");
      }
      if (t.target) {
        if (long && hi >= t.target) return close(t.target, "target");
        if (!long && lo <= t.target) return close(t.target, "target");
      }
      return t;
    });
    if (changed) setTrades(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  function addTrade() {
    const e = num(entry);
    const sh = num(shares);
    if (!ticker || !e || !sh) return;
    setTrades((prev) => [
      {
        id: `${ticker}-${Date.now()}`,
        ticker,
        direction: dir,
        entry: e,
        shares: sh,
        stop: num(stop),
        target: num(target),
        tag: tag.trim() || undefined,
        openedAt: Date.now(),
        status: "open",
      },
      ...prev,
    ]);
    setTag("");
  }
  function closeNow(id: string) {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.status !== "open") return t;
        const cur = priceOf(t.ticker)?.quote?.current;
        if (!cur) return t;
        return { ...t, status: "closed", closePrice: cur, closedAt: Date.now(), exitReason: "manual" };
      }),
    );
  }
  function remove(id: string) {
    setTrades((prev) => prev.filter((t) => t.id !== id));
  }

  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");

  // 成績表
  const score = useMemo(() => {
    const wins = closed.filter((t) => (t.closePrice ?? 0) !== 0 && pnlOf(t, t.closePrice!) > 0).length;
    const losses = closed.filter((t) => pnlOf(t, t.closePrice!) < 0).length;
    const totalPnl = closed.reduce((a, t) => a + pnlOf(t, t.closePrice!), 0);
    const rs = closed.map((t) => rMultiple(t, t.closePrice!)).filter((x): x is number => x != null);
    const totalR = rs.reduce((a, b) => a + b, 0);
    const decided = wins + losses;
    return {
      closed: closed.length,
      wins,
      losses,
      winRate: decided ? wins / decided : 0,
      totalPnl,
      avgR: rs.length ? totalR / rs.length : 0,
      totalR,
    };
  }, [closed]);

  // 按「公式標籤」分組
  const byTag = useMemo(() => {
    const m = new Map<string, { n: number; wins: number; losses: number; pnl: number }>();
    for (const t of closed) {
      const k = t.tag || "（無標籤）";
      const g = m.get(k) ?? { n: 0, wins: 0, losses: 0, pnl: 0 };
      const p = pnlOf(t, t.closePrice!);
      g.n++;
      if (p > 0) g.wins++;
      else if (p < 0) g.losses++;
      g.pnl += p;
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  }, [closed]);

  // 資金曲線（累積損益）
  const curve = useMemo(() => {
    const ordered = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    let c = 0;
    return ordered.map((t) => (c += pnlOf(t, t.closePrice!)));
  }, [closed]);

  return (
    <div>
      {/* 下注表單 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>模擬下注</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)} style={inputStyle}>
            {tickers.map((t) => <option key={t.ticker} value={t.ticker}>{t.ticker}</option>)}
          </select>
          <select value={dir} onChange={(e) => setDir(e.target.value as "long" | "short")} style={inputStyle}>
            <option value="long">做多</option>
            <option value="short">做空</option>
          </select>
          <input style={inputStyle} placeholder="進場價" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" />
          <input style={inputStyle} placeholder="股數" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="numeric" />
          <input style={inputStyle} placeholder="止損" value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" />
          <input style={inputStyle} placeholder="止盈" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" />
          <input style={{ ...inputStyle, gridColumn: "span 2" }} placeholder="公式/策略標籤（例：RSI反彈、我的公式A）" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        <button
          onClick={addTrade}
          style={{ marginTop: 10, background: "var(--bull)", color: "#0a0b14", border: 0, borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
        >
          ＋ 下模擬單
        </button>
        <div className="muted-note">選股票會自動帶入該檔現價與建議止損止盈，可自行改。</div>
      </div>

      {/* 成績表 */}
      <div className="summary">
        <div>
          <div className="k">模擬損益</div>
          <div className="big" style={{ color: score.totalPnl >= 0 ? "var(--bull)" : "var(--bear)" }}>{money(score.totalPnl)}</div>
        </div>
        <div className="sep" />
        <div><div className="k">勝率</div><div className="mid">{score.wins + score.losses ? `${Math.round(score.winRate * 100)}%` : "—"}</div></div>
        <div><div className="k">平均 R</div><div className="mid" style={{ color: score.avgR >= 0 ? "var(--bull)" : "var(--bear)" }}>{score.closed ? `${score.avgR >= 0 ? "+" : ""}${score.avgR.toFixed(2)}R` : "—"}</div></div>
        <div><div className="k">已結算</div><div className="mid">{score.closed}（{score.wins}勝/{score.losses}敗）</div></div>
        <div><div className="k">持倉中</div><div className="mid">{open.length}</div></div>
      </div>

      {/* 資金曲線 */}
      {curve.length > 1 && <EquityCurve curve={curve} />}

      {/* 按公式標籤比較 */}
      {byTag.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>各公式/標籤表現</div>
          {byTag.map(([k, g]) => {
            const wr = g.wins + g.losses ? Math.round((g.wins / (g.wins + g.losses)) * 100) : 0;
            return (
              <div className="lv" key={k}>
                <span className="k">{k}（{g.n}筆）</span>
                <span className="v">勝率 {wr}% · <span style={{ color: g.pnl >= 0 ? "var(--bull)" : "var(--bear)" }}>{money(g.pnl)}</span></span>
              </div>
            );
          })}
        </div>
      )}

      {/* 持倉中 */}
      {open.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 8px" }}>持倉中（模擬）</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {open.map((t) => {
              const cur = priceOf(t.ticker)?.quote?.current;
              const upnl = cur != null ? pnlOf(t, cur) : null;
              return (
                <div className="card" key={t.id} style={{ padding: "10px 13px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#0a0b14", background: t.direction === "long" ? "var(--bull)" : "var(--bear)", padding: "2px 8px", borderRadius: 6 }}>{t.direction === "long" ? "做多" : "做空"}</span>
                    <span style={{ fontWeight: 500 }}>${t.ticker}</span>
                    <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{t.shares}股 @{t.entry}{t.tag ? ` · ${t.tag}` : ""}</span>
                    {upnl != null && <span style={{ marginLeft: "auto", color: upnl >= 0 ? "var(--bull)" : "var(--bear)", fontSize: 13 }}>{money(upnl)}（現 {cur}）</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <span style={{ color: "var(--muted)", fontSize: 11.5 }}>止損 {t.stop ?? "—"} · 止盈 {t.target ?? "—"}</span>
                    <button onClick={() => closeNow(t.id)} style={{ marginLeft: "auto", background: "transparent", border: "0.5px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "2px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>平倉</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 已結算 */}
      {closed.length > 0 && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 8px" }}>已結算</div>
          <ul className="news">
            {[...closed].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).map((t) => {
              const p = pnlOf(t, t.closePrice!);
              const r = rMultiple(t, t.closePrice!);
              const reason = t.exitReason === "stop" ? "止損" : t.exitReason === "target" ? "止盈" : "手動";
              return (
                <li key={t.id}>
                  <div className="line">
                    <span className="tag" style={{ background: "#1f2435", color: t.direction === "long" ? "var(--bull)" : "var(--bear)" }}>{t.direction === "long" ? "多" : "空"}</span>
                    <span className="head">${t.ticker} {t.entry}→{t.closePrice} {t.tag ? `· ${t.tag}` : ""}</span>
                    <span style={{ marginLeft: "auto", color: p >= 0 ? "var(--bull)" : "var(--bear)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {reason} {money(p)}{r != null ? ` · ${r >= 0 ? "+" : ""}${r.toFixed(1)}R` : ""}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button onClick={() => remove(t.id)} style={{ background: "transparent", border: 0, color: "var(--muted)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>刪除</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {trades.length === 0 && <div className="empty">還沒有模擬單 — 上面下一筆試試。</div>}
      <div className="muted-note" style={{ marginTop: 14, textAlign: "center" }}>資料存在這台瀏覽器（換裝置不同步）；結算用快照價，屬近似。</div>
    </div>
  );
}

function EquityCurve({ curve }: { curve: number[] }) {
  const w = 600;
  const h = 80;
  const min = Math.min(0, ...curve);
  const max = Math.max(0, ...curve);
  const range = max - min || 1;
  const pts = curve
    .map((v, i) => `${(i / Math.max(1, curve.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const last = curve[curve.length - 1];
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>資金曲線（累積模擬損益）</div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 80 }}>
        <polyline
          points={pts}
          fill="none"
          stroke={last >= 0 ? "#2cf07a" : "#ff3e4d"}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
