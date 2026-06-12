// 規則化價位框架 —— 全部用透明公式從真實數據算，LLM 不參與算價。
// 這些是「紀律參考」，不是預測，更不是穩賺。最終下單與風險由使用者承擔。
import type { DayLevels, LongLevels, MarketStats, Quote } from "./types";

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * 短線：以「回踩支撐」為主設定。
 * - 支撐 = 今日低 / 近期擺動低 中，低於現價且最接近者
 * - 止損 = 支撐下方 0.5×ATR（跌破代表看錯）
 * - 止盈 = 風報比 2:1
 * - 另給突破阻力的進場參考
 */
export function dayTradeLevels(q: Quote, m: MarketStats | null): DayLevels | null {
  const price = q.current;
  if (!price) return null;

  // 沒歷史時用今日區間 / 2% 墊檔，避免算不出來
  const atr = m?.atr14 ?? ((q.high - q.low) || price * 0.02);

  const supports = [q.low, m?.swingLow].filter(
    (x): x is number => typeof x === "number" && x > 0 && x < price,
  );
  const support = supports.length ? Math.max(...supports) : price - atr;

  const resistances = [q.high, m?.swingHigh, m?.high52].filter(
    (x): x is number => typeof x === "number" && x > price,
  );
  const resistance = resistances.length
    ? Math.min(...resistances)
    : price + 2 * atr;

  const entryMid = support + 0.15 * atr;
  const stop = support - 0.5 * atr;
  const risk = entryMid - stop;
  const target = entryMid + 2 * risk;

  return {
    entryZone: [r2(support), r2(support + 0.3 * atr)],
    breakout: r2(resistance),
    stop: r2(stop),
    target: r2(target),
    rr: 2,
    riskPerShare: r2(risk),
    basis: `回踩支撐 ${r2(support)} 進場 · 止損=支撐下 0.5×ATR(${r2(atr)}) · 止盈=風報比 2:1 · 突破 ${r2(resistance)} 為另一進場參考`,
  };
}

/**
 * 長期：結構錨點，不是緊停損。
 * - 分批買進區：200 日均線附近
 * - 減碼參考：接近 52 週高 / 估值偏高
 * - 「止損」= 檢討觸發價：收盤跌破 200 日線（轉弱）或論點/基本面改變
 */
export function longTermLevels(q: Quote, m: MarketStats | null): LongLevels | null {
  const price = q.current;
  if (!price || !m) return null;

  const { sma200, high52, low52 } = m;
  const accLow = sma200 ? Math.min(sma200 * 0.97, price) : low52 + (price - low52) * 0.4;
  const accHigh = sma200 ? sma200 * 1.05 : price;
  const review = sma200 ?? price * 0.75;
  const stretched = sma200 ? price > sma200 * 1.2 : false;

  return {
    accumulateZone: [r2(Math.min(accLow, accHigh)), r2(Math.max(accLow, accHigh))],
    trimZone: r2(high52),
    reviewTrigger: r2(review),
    stretched,
    basis:
      `分批區錨定 200 日線附近 · 減碼參考≈52週高 ${r2(high52)} · 「止損」=收盤跌破 200 日線 ${r2(review)} 或論點改變` +
      (stretched ? " · ⚠ 現價明顯高於均線，宜小額分批/等回檔" : ""),
  };
}

/**
 * 依帳戶風險算建議股數：單筆最多虧 accountSize×riskPct。
 * 回傳整數股數（風險金額 ÷ 每股風險）。
 */
export function positionSize(
  accountSize: number,
  riskPct: number,
  riskPerShare: number,
): number {
  if (riskPerShare <= 0) return 0;
  return Math.floor((accountSize * riskPct) / riskPerShare);
}
