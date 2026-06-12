// 短線視圖卡片：報價 + 多空訊號 + 價位框架（進場/止損/止盈/部位）+ 催化劑新聞
import type { Account, AnalyzedNews, TickerSnapshot } from "@/lib/types";
import { positionSize } from "@/lib/levels";

const SENT_COLOR = {
  bullish: "var(--bull)",
  bearish: "var(--bear)",
  neutral: "var(--neutral)",
} as const;

const SENT_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" } as const;

// 卡片邊框依訊號發光
const SKIN = {
  bullish: { border: "rgba(44,240,122,0.45)", shadow: "0 0 18px rgba(44,240,122,0.16)" },
  bearish: { border: "rgba(255,62,77,0.5)", shadow: "0 0 18px rgba(255,62,77,0.16)" },
  neutral: { border: "rgba(154,163,178,0.22)", shadow: "0 0 14px rgba(154,163,178,0.07)" },
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
  const skin = SKIN[t.signal.sentiment];
  const d = t.day;
  const shares = d ? positionSize(account.size, account.riskPct, d.riskPerShare) : 0;
  const riskAmt = Math.round(account.size * account.riskPct);
  // 催化劑：已證實的優先，其次最近的
  const catalysts = [...t.news].sort(
    (a, b) => (b.credibility === "confirmed" ? 1 : 0) - (a.credibility === "confirmed" ? 1 : 0),
  ).slice(0, 4);

  return (
    <div className="card" style={{ borderColor: skin.border, boxShadow: skin.shadow }}>
      <div className="card-head">
        <span className="ticker">${t.ticker}</span>
        {t.quote && (
          <span className="price">
            <div>{t.quote.current.toFixed(2)}</div>
            <div className="pct" style={{ color: up ? "var(--bull)" : "var(--bear)" }}>
              {up ? "+" : ""}{t.quote.changePct.toFixed(2)}%
            </div>
          </span>
        )}
      </div>

      <div className="badges">
        <span className="badge" style={{ color: SENT_COLOR[t.signal.sentiment], borderColor: "currentColor" }}>
          {SENT_LABEL[t.signal.sentiment]} {t.signal.score > 0 ? "+" : ""}{t.signal.score}
        </span>
        <span className="badge">多 {t.signal.bullCount} · 空 {t.signal.bearCount}</span>
        {t.social && <span className="badge">散戶 {t.social.bullish}/{t.social.bearish}</span>}
      </div>

      {d ? (
        <div className="lvbox">
          <LV k="進場區" v={`${d.entryZone[0]} – ${d.entryZone[1]}`} />
          <LV k="止損" v={`${d.stop}`} color="var(--bear)" />
          <LV k="止盈 (2:1)" v={`${d.target}`} color="var(--bull)" />
          <LV k="突破買" v={`${d.breakout}`} />
          <LV k="建議部位" v={`≈ ${shares} 股 · 風險 $${riskAmt}`} />
        </div>
      ) : (
        <div className="muted-note">技術資料不足，暫無價位框架</div>
      )}

      {catalysts.length > 0 && (
        <ul className="news">{catalysts.map((n) => <NewsRow key={n.id} n={n} />)}</ul>
      )}
    </div>
  );
}
