// 短線視圖卡片：方向(做多/做空/觀望) + 進場時機(技術指標) + 方向感知價位框架 + 催化劑
import type { Account, AnalyzedNews, TickerSnapshot } from "@/lib/types";
import { positionSize } from "@/lib/levels";

const SENT_COLOR = {
  bullish: "var(--bull)",
  bearish: "var(--bear)",
  neutral: "var(--neutral)",
} as const;

// 方向 → 顏色/標籤
const DIR = {
  long: { label: "做多", color: "var(--bull)" },
  short: { label: "做空", color: "var(--bear)" },
  none: { label: "觀望", color: "var(--neutral)" },
} as const;

// 卡片邊框依方向發光
const SKIN = {
  long: { border: "rgba(44,240,122,0.45)", shadow: "0 0 18px rgba(44,240,122,0.16)" },
  short: { border: "rgba(255,62,77,0.5)", shadow: "0 0 18px rgba(255,62,77,0.16)" },
  none: { border: "rgba(154,163,178,0.22)", shadow: "0 0 14px rgba(154,163,178,0.07)" },
} as const;

function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function NewsRow({ n }: { n: AnalyzedNews }) {
  const tag =
    n.credibility === "rumor"
      ? { text: "傳聞", bg: "rgba(255,210,77,0.15)", fg: "var(--rumor)" }
      : n.credibility === "confirmed"
        ? { text: "已證實", bg: "rgba(52,226,232,0.12)", fg: "#34e2e8" }
        : { text: "未確認", bg: "rgba(154,163,178,0.12)", fg: "var(--muted)" };
  return (
    <li>
      <div className="line">
        <span className="time">{fmtTime(n.datetime)}</span>
        <span style={{ color: SENT_COLOR[n.sentiment], fontWeight: 700 }}>
          {n.sentiment === "bullish" ? "▲" : n.sentiment === "bearish" ? "▼" : "—"}
        </span>
        <span className="tag" style={{ background: tag.bg, color: tag.fg }}>{tag.text}</span>
        <a className="head" href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
      </div>
      {n.reason && <div className="reason">{n.reason}</div>}
    </li>
  );
}

function LV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="lv">
      <span className="k">{k}</span>
      <span className="v" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

export function TickerCard({ t, account }: { t: TickerSnapshot; account: Account }) {
  const up = (t.quote?.changePct ?? 0) >= 0;
  const dir = t.timing?.direction ?? "none";
  const skin = SKIN[dir];
  const d = t.day;
  const isShort = d?.direction === "short";
  const shares = d ? positionSize(account.size, account.riskPct, d.riskPerShare) : 0;
  const riskAmt = Math.round(account.size * account.riskPct);
  const catalysts = [...t.news].sort(
    (a, b) => (b.credibility === "confirmed" ? 1 : 0) - (a.credibility === "confirmed" ? 1 : 0),
  ).slice(0, 4);

  return (
    <div className="card" style={{ borderColor: skin.border, boxShadow: skin.shadow }}>
      <div className="card-head">
        <span className="ticker">
          ${t.ticker} <span className="chip" style={{ background: "#1f2435", color: "#ffd24d" }}>熱 {t.heat}</span>
        </span>
        {t.quote && (
          <span className="price">
            <div>{t.quote.current.toFixed(2)}</div>
            <div className="pct" style={{ color: up ? "var(--bull)" : "var(--bear)" }}>
              {up ? "+" : ""}{t.quote.changePct.toFixed(2)}%
            </div>
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#0a0b14", background: DIR[dir].color, padding: "2px 10px", borderRadius: 6 }}>
          {DIR[dir].label}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text)" }}>{t.timing?.label}</span>
      </div>

      {t.timing && t.timing.factors.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
          {t.timing.factors.map((f, i) => <span key={i} className="fchip">{f}</span>)}
        </div>
      )}

      {d ? (
        <div className="lvbox">
          <LV k={isShort ? "進場區(空)" : "進場區"} v={`${d.entryZone[0]} – ${d.entryZone[1]}`} />
          <LV k="止損" v={`${d.stop}`} color="var(--bear)" />
          <LV k={isShort ? "止盈(回補)" : "止盈 (2:1)"} v={`${d.target}`} color="var(--bull)" />
          <LV k={isShort ? "跌破續空" : "突破買"} v={`${d.breakout}`} />
          <LV k="建議部位" v={`≈ ${shares} 股 · 風險 $${riskAmt}`} />
        </div>
      ) : (
        <div className="muted-note">技術資料不足，暫無價位框架</div>
      )}

      {isShort && (
        <div style={{ fontSize: 11.5, color: "var(--bear)", marginTop: 8, lineHeight: 1.5 }}>
          ⚠ 放空：虧損無上限、需融資/可借券、務必守住止損
        </div>
      )}

      {catalysts.length > 0 && (
        <ul className="news">{catalysts.map((n) => <NewsRow key={n.id} n={n} />)}</ul>
      )}
    </div>
  );
}
