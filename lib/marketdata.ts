// 免費日線歷史（Yahoo Finance chart API，免金鑰）→ 算 ATR、均線、近期高低、52週區間、量能。
// （原本用 Stooq，但它加了防爬蟲 JS 驗證牆，已改 Yahoo。）
import type { MarketStats } from "./types";

// 注意：帶瀏覽器 User-Agent 反而會被 Yahoo 限流(429)；用 Node 預設 UA 才穩。

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  return values.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** 14 日 ATR：真實波動區間的平均，當「一個風險單位」 */
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
  return trs.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** RSI(14)，Wilder 平滑 */
function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function emaSeries(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

/** MACD(12,26,9) */
function macd(
  closes: number[],
): { macd: number; signal: number; hist: number } | null {
  if (closes.length < 35) return null;
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(line, 9);
  const m = line[line.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

interface YahooChart {
  chart?: {
    result?: Array<{
      indicators?: {
        quote?: Array<{
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
}

export async function getMarketStats(
  symbol: string,
): Promise<MarketStats | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=1y&interval=1d`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url); // 不要帶 User-Agent
      if (res.ok) break;
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
        continue;
      }
      return null;
    }
    if (!res || !res.ok) return null;
    const data = (await res.json()) as YahooChart;
    const q = data.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!q) return null;

    const H = q.high ?? [];
    const L = q.low ?? [];
    const C = q.close ?? [];
    const V = q.volume ?? [];

    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    const vols: number[] = [];
    for (let i = 0; i < C.length; i++) {
      const h = H[i];
      const l = L[i];
      const c = C[i];
      const v = V[i];
      if (
        typeof h === "number" &&
        typeof l === "number" &&
        typeof c === "number" &&
        Number.isFinite(c)
      ) {
        highs.push(h);
        lows.push(l);
        closes.push(c);
        vols.push(typeof v === "number" && Number.isFinite(v) ? v : 0);
      }
    }
    if (closes.length < 30) return null;

    const W = 20; // 近期擺動視窗
    return {
      atr14: atr(highs, lows, closes, 14),
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      swingHigh: Math.max(...highs.slice(-W)),
      swingLow: Math.min(...lows.slice(-W)),
      high52: Math.max(...highs.slice(-252)),
      low52: Math.min(...lows.slice(-252)),
      avgVol20: sma(vols, 20),
      lastVol: vols[vols.length - 1] ?? null,
      rsi14: rsi(closes, 14),
      macd: macd(closes),
    };
  } catch (err) {
    console.warn(`  ⚠ getMarketStats(${symbol}) 失敗:`, (err as Error).message);
    return null;
  }
}
