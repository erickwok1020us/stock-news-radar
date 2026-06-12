// Finnhub 免費 API —— 美股近即時報價 + 個股新聞。免費額度 60 calls/分鐘。
// 註冊拿 token：https://finnhub.io
import type { Fundamentals, Quote, RawNews } from "./types";

const BASE = "https://finnhub.io/api/v1";

interface FinnhubQuote {
  c: number; // current
  d: number; // change
  dp: number; // change percent
  h: number; // high
  l: number; // low
  o: number; // open
  pc: number; // previous close
}

interface FinnhubNewsItem {
  datetime: number; // unix 秒
  headline: string;
  id: number;
  source: string;
  summary: string;
  url: string;
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const qs = new URLSearchParams({ ...params, token }).toString();
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`Finnhub ${path} 回傳 ${res.status}`);
  return (await res.json()) as T;
}

/** 近即時報價；失敗回 null（不擋整個流程） */
export async function getQuote(symbol: string, token: string): Promise<Quote | null> {
  try {
    const q = await get<FinnhubQuote>("/quote", { symbol }, token);
    if (!q || typeof q.c !== "number" || q.c === 0) return null;
    return {
      current: q.c,
      changePct: q.dp ?? 0,
      high: q.h,
      low: q.l,
      prevClose: q.pc,
    };
  } catch (err) {
    console.warn(`  ⚠ getQuote(${symbol}) 失敗:`, (err as Error).message);
    return null;
  }
}

/** 抓某檔在 [from, to]（YYYY-MM-DD）的個股新聞；失敗回 []。最多取最近 30 則。 */
export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string,
  token: string,
): Promise<RawNews[]> {
  try {
    const items = await get<FinnhubNewsItem[]>(
      "/company-news",
      { symbol, from, to },
      token,
    );
    return (items ?? [])
      .filter((n) => n.headline && n.url)
      .slice(0, 30)
      .map((n) => ({
        id: `finnhub-${n.id}`,
        ticker: symbol,
        headline: n.headline,
        summary: n.summary ?? "",
        source: n.source ?? "Finnhub",
        url: n.url,
        datetime: n.datetime,
      }));
  } catch (err) {
    console.warn(`  ⚠ getCompanyNews(${symbol}) 失敗:`, (err as Error).message);
    return [];
  }
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** 基本面：公司簡介 + 財務指標 + 分析師共識（都是 Finnhub 免費端點）。失敗回 null。 */
export async function getFundamentals(
  symbol: string,
  token: string,
): Promise<Fundamentals | null> {
  try {
    const [profile, metricResp, rec] = await Promise.all([
      get<{ marketCapitalization?: number; finnhubIndustry?: string }>(
        "/stock/profile2",
        { symbol },
        token,
      ).catch(() => null),
      get<{ metric?: Record<string, number> }>(
        "/stock/metric",
        { symbol, metric: "all" },
        token,
      ).catch(() => null),
      get<Array<Record<string, number>>>(
        "/stock/recommendation",
        { symbol },
        token,
      ).catch(() => null),
    ]);
    const m = metricResp?.metric ?? {};
    const r = Array.isArray(rec) && rec.length ? rec[0] : null;
    return {
      marketCap: num(profile?.marketCapitalization),
      industry: profile?.finnhubIndustry ?? null,
      peTTM: num(m.peTTM),
      psTTM: num(m.psTTM),
      grossMarginTTM: num(m.grossMarginTTM),
      beta: num(m.beta),
      epsGrowthTTMYoy: num(m.epsGrowthTTMYoy),
      revenueGrowthTTMYoy: num(m.revenueGrowthTTMYoy),
      analyst: r
        ? {
            strongBuy: r.strongBuy ?? 0,
            buy: r.buy ?? 0,
            hold: r.hold ?? 0,
            sell: r.sell ?? 0,
            strongSell: r.strongSell ?? 0,
          }
        : null,
    };
  } catch (err) {
    console.warn(`  ⚠ getFundamentals(${symbol}) 失敗:`, (err as Error).message);
    return null;
  }
}
