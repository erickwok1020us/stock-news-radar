// 長期視圖卡片：估值/成長/體質 + 52週位置 + 分析師共識 + 長期價位框架 + 改變論點的新聞
import type { TickerSnapshot } from "@/lib/types";

function fmtCap(m: number | null): string {
  if (m == null) return "—";
  if (m >= 1e6) return `$${(m / 1e6).toFixed(2)}T`;
  if (m >= 1e3) return `$${(m / 1e3).toFixed(1)}B`;
  return `$${Math.round(m)}M`;
}

const f1 = (n: number | null, suf = "") => (n == null ? "—" : `${n.toFixed(1)}${suf}`);

function LV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="lv">
      <span className="k">{k}</span>
      <span className="v" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

function growthColor(n: number | null): string | undefined {
  if (n == null) return undefined;
  return n >= 0 ? "var(--bull)" : "var(--bear)";
}

export function LongCard({ t }: { t: TickerSnapshot }) {
  const f = t.fundamentals;
  const s = t.stats;
  const l = t.long;
  const price = t.quote?.current ?? null;

  // 52 週位置
  let pos52: number | null = null;
  if (s && price != null && s.high52 > s.low52) {
    pos52 = Math.max(0, Math.min(1, (price - s.low52) / (s.high52 - s.low52)));
  }

  const thesisNews = t.news.filter((n) => n.longTermImpact === "thesis").slice(0, 3);
  const stretched = l?.stretched;

  return (
    <div
      className="card"
      style={{
        borderColor: stretched ? "rgba(255,210,77,0.4)" : "rgba(154,163,178,0.22)",
        boxShadow: stretched ? "0 0 16px rgba(255,210,77,0.12)" : "0 0 14px rgba(154,163,178,0.07)",
      }}
    >
      <div className="card-head">
        <span className="ticker">${t.ticker}</span>
        <span style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>
          {fmtCap(f?.marketCap ?? null)}
          {f?.industry ? ` · ${f.industry}` : ""}
        </span>
      </div>

      <div className="lvbox">
        <LV k="估值" v={`P/E ${f1(f?.peTTM ?? null)} · P/S ${f1(f?.psTTM ?? null)}`} />
        <LV
          k="成長 (YoY)"
          v={`營收 ${f1(f?.revenueGrowthTTMYoy ?? null, "%")} · EPS ${f1(f?.epsGrowthTTMYoy ?? null, "%")}`}
          color={growthColor(f?.revenueGrowthTTMYoy ?? null)}
        />
        <LV k="體質" v={`毛利 ${f1(f?.grossMarginTTM ?? null, "%")} · Beta ${f1(f?.beta ?? null)}`} />
      </div>

      {pos52 != null && s && (
        <div style={{ margin: "10px 0 2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>
            <span>52週 {s.low52.toFixed(0)}</span>
            <span>{Math.round(pos52 * 100)}%</span>
            <span>{s.high52.toFixed(0)}</span>
          </div>
          <div style={{ height: 5, background: "var(--border)", borderRadius: 3, position: "relative" }}>
            <span style={{ position: "absolute", left: `${pos52 * 100}%`, top: -2, width: 9, height: 9, borderRadius: "50%", background: "var(--neutral)", transform: "translateX(-50%)" }} />
          </div>
        </div>
      )}

      {f?.analyst && (
        <div className="lv" style={{ marginTop: 8 }}>
          <span className="k">分析師</span>
          <span className="v">
            <span style={{ color: "var(--bull)" }}>買 {f.analyst.strongBuy + f.analyst.buy}</span>
            {" · 持有 "}{f.analyst.hold}{" · "}
            <span style={{ color: "var(--bear)" }}>賣 {f.analyst.sell + f.analyst.strongSell}</span>
          </span>
        </div>
      )}

      {l ? (
        <div className="lvbox" style={{ marginTop: 10 }}>
          <LV k="分批買進區" v={`${l.accumulateZone[0]} – ${l.accumulateZone[1]}`} color="var(--bull)" />
          <LV k="減碼參考" v={`${l.trimZone}`} />
          <LV k="檢討價" v={`${l.reviewTrigger}`} color="var(--bear)" />
        </div>
      ) : (
        <div className="muted-note">歷史資料不足，暫無長期框架</div>
      )}

      {thesisNews.length > 0 ? (
        <ul className="news" style={{ marginTop: 10 }}>
          {thesisNews.map((n) => (
            <li key={n.id}>
              <div className="line">
                <span className="tag" style={{ background: "rgba(52,226,232,0.12)", color: "#34e2e8" }}>論點</span>
                <a className="head" href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
              </div>
              {n.reason && <div className="reason">{n.reason}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted-note" style={{ marginTop: 8 }}>近期無改變長期論點的消息</div>
      )}
    </div>
  );
}
