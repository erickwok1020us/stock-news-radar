// StockTwits 散戶情緒（選用、盡力而為）。
// 注意：StockTwits 近年收緊了 API，未授權呼叫可能回 403/429。
// 本模組任何失敗都回 null，不會擋住主流程。要不要用，在 ingest 裡開關。
export interface SocialSentiment {
  bullish: number;
  bearish: number;
}

interface StreamResponse {
  messages?: Array<{
    entities?: { sentiment?: { basic?: "Bullish" | "Bearish" | null } | null };
  }>;
}

export async function getStockTwitsSentiment(
  symbol: string,
): Promise<SocialSentiment | null> {
  try {
    const res = await fetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as StreamResponse;
    let bullish = 0;
    let bearish = 0;
    for (const m of data.messages ?? []) {
      const b = m.entities?.sentiment?.basic;
      if (b === "Bullish") bullish++;
      else if (b === "Bearish") bearish++;
    }
    return { bullish, bearish };
  } catch {
    return null;
  }
}
