// 進場時機 —— 把技術指標(趨勢/RSI/MACD/量能/乖離)+新聞情緒合成成「方向感知」的讀數。
// 純函式、透明。這是紀律性的「現在是不是好時機」，不是預測。
import type { MarketStats, Quote, TickerSnapshot, TimingRead } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeTiming(
  quote: Quote | null,
  stats: MarketStats | null,
  signal: TickerSnapshot["signal"],
): TimingRead {
  const factors: string[] = [];
  if (!quote) return { direction: "none", score: 0, label: "無報價，無法判時機", factors };

  const price = quote.current;
  const sma20 = stats?.sma20 ?? null;
  const sma50 = stats?.sma50 ?? null;
  const rsi14 = stats?.rsi14 ?? null;
  const macd = stats?.macd ?? null;

  let L = 0;
  let S = 0;

  // 趨勢濾網（最重要：順勢才做，不逆勢接刀）
  if (sma20 && sma50) {
    if (price > sma20 && sma20 > sma50) {
      L += 2;
      factors.push("順勢↑");
    } else if (price < sma20 && sma20 < sma50) {
      S += 2;
      factors.push("順勢↓");
    } else if (price > sma50) {
      L += 1;
      factors.push("偏多");
    } else {
      S += 1;
      factors.push("偏空");
    }
  }

  // 新聞情緒
  if (signal.score > 0.15) {
    L += 1;
    factors.push("新聞偏多");
  } else if (signal.score < -0.15) {
    S += 1;
    factors.push("新聞偏空");
  }

  // RSI 超買/超賣
  if (typeof rsi14 === "number") {
    if (rsi14 > 70) {
      S += 1;
      L -= 1;
      factors.push(`RSI ${r1(rsi14)} 超買`);
    } else if (rsi14 < 30) {
      L += 1;
      S -= 1;
      factors.push(`RSI ${r1(rsi14)} 超賣`);
    } else {
      factors.push(`RSI ${r1(rsi14)} 中性`);
    }
  }

  // MACD 動能
  if (macd) {
    if (macd.hist > 0) {
      L += 1;
      factors.push("MACD↑");
    } else {
      S += 1;
      factors.push("MACD↓");
    }
  }

  // 量能確認（突破要帶量）
  if (stats?.lastVol && stats?.avgVol20) {
    const vr = stats.lastVol / stats.avgVol20;
    if (vr > 1.5) factors.push("爆量");
    else if (vr < 0.7) factors.push("量縮");
  }

  // 乖離（過熱/超跌，避免追）
  if (sma20) {
    const dev = (price - sma20) / sma20;
    if (dev > 0.1) {
      L -= 1;
      factors.push("乖離大·追高險");
    } else if (dev < -0.1) {
      S -= 1;
      factors.push("乖離大·殺低險");
    }
  }

  let direction: TimingRead["direction"] = "none";
  if (L >= 2 && L > S) direction = "long";
  else if (S >= 2 && S > L) direction = "short";

  const score = clamp(Math.max(L, S) / 6, 0, 1);
  const label =
    direction === "long"
      ? "偏好做多（順勢、未過熱時進場）"
      : direction === "short"
        ? "偏好做空（反彈靠近阻力進場）"
        : "多空不明 → 觀望";

  return { direction, score: Number(score.toFixed(2)), label, factors };
}

/** in-play 熱度 0-100：量能爆發 + 波動 + 當日異動 + 新聞活躍 */
export function computeHeat(
  quote: Quote | null,
  stats: MarketStats | null,
  signal: TickerSnapshot["signal"],
): number {
  const price = quote?.current ?? 0;
  const volRatio =
    stats?.lastVol && stats?.avgVol20 ? stats.lastVol / stats.avgVol20 : 1;
  const volat = stats?.atr14 && price ? stats.atr14 / price : 0;
  const move = Math.abs(quote?.changePct ?? 0) / 100;
  const news = Math.abs(signal.score);
  const h =
    0.35 * clamp(volRatio / 2.5, 0, 1) +
    0.25 * clamp(volat / 0.04, 0, 1) +
    0.25 * clamp(move / 0.05, 0, 1) +
    0.15 * clamp(news, 0, 1);
  return Math.round(100 * clamp(h, 0, 1));
}
