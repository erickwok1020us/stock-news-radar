// 免費日線歷史（Stooq CSV，免金鑰）→ 算 ATR、均線、近期高低、52週區間、量能。
// 美股 ticker 自動加 .us，例如 NVDA → nvda.us
import type { MarketStats } from "./types";

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** 14 日 ATR：真實波動區間的平均，用來當「一個風險單位」 */
function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  n = 14,
): number | null {
  if (closes.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  const slice = trs.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

export async function getMarketStats(
  symbol: string,
): Promise<MarketStats | null> {
  try {
    const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const csv = await res.text();
    const rows = csv.trim().split("\n").slice(1); // 去掉表頭 Date,Open,High,Low,Close,Volume
    if (rows.length < 30) return null; // 歷史太短就不算（避免亂給數字）

    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    const vols: number[] = [];
    for (const line of rows) {
      const cols = line.split(",");
      const h = parseFloat(cols[2]);
      const l = parseFloat(cols[3]);
      const c = parseFloat(cols[4]);
      const v = parseFloat(cols[5]);
      if (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
        highs.push(h);
        lows.push(l);
        closes.push(c);
        vols.push(Number.isFinite(v) ? v : 0);
      }
    }
    if (closes.length < 30) return null;

    const W = 20; // 近期擺動視窗
    return {
      atr14: atr(highs, lows, closes, 14),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      swingHigh: Math.max(...highs.slice(-W)),
      swingLow: Math.min(...lows.slice(-W)),
      high52: Math.max(...highs.slice(-252)),
      low52: Math.min(...lows.slice(-252)),
      avgVol20: sma(vols, 20),
      lastVol: vols[vols.length - 1] ?? null,
    };
  } catch (err) {
    console.warn(`  ⚠ getMarketStats(${symbol}) 失敗:`, (err as Error).message);
    return null;
  }
}
