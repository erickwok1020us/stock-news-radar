// 用 Google Gemini（免費）判每則新聞的多空 / 信心 / 已證實vs傳聞 / 是否改變長期論點。
// 用 responseSchema 強制結構化 JSON 輸出。對外介面 analyzeNews 不變，其他檔案不用改。
import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzedNews, Credibility, RawNews, Sentiment } from "./types";

const MODEL = "gemini-2.5-flash";

// 延遲建立 client（避免沒設金鑰時在 import 階段就爆，保留優雅報錯）
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _ai;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          sentiment: { type: Type.STRING, enum: ["bullish", "bearish", "neutral"] },
          confidence: { type: Type.NUMBER },
          credibility: { type: Type.STRING, enum: ["confirmed", "rumor", "unknown"] },
          longTermImpact: { type: Type.STRING, enum: ["thesis", "noise"] },
          reason: { type: Type.STRING },
        },
        required: ["id", "sentiment", "confidence", "credibility", "longTermImpact", "reason"],
      },
    },
  },
  required: ["items"],
};

const INSTRUCTIONS = `你是股票新聞分析師。針對每一則美股新聞判斷：
1. sentiment：對該股「短線股價」偏多(bullish)/偏空(bearish)/中性(neutral)。
2. confidence：信心 0-1。
3. credibility：已證實事實(confirmed，如財報/官方公告/成交) vs 未證實傳聞/推測/小道消息(rumor，如「據傳」「傳聞」「分析師猜測」)，無法判斷則 unknown。傳聞常被用來拉抬出貨，要嚴格區分。
4. longTermImpact：是否可能改變公司長期投資論點(thesis，如護城河/長期成長/結構性競爭力/重大財務變化)，還是只是短線雜訊(noise)。
5. reason：一句話原因，繁體中文，20字內。
務必對輸入陣列中「每一則」都輸出對應結果，用 id 對應。`;

interface AnalysisItem {
  id: string;
  sentiment: Sentiment;
  confidence: number;
  credibility: Credibility;
  longTermImpact: "thesis" | "noise";
  reason: string;
}

/** 把一批未分析新聞送 Gemini，回傳帶判讀結果的版本（順序與輸入一致） */
export async function analyzeNews(items: RawNews[]): Promise<AnalyzedNews[]> {
  if (items.length === 0) return [];

  const payload = items.map((n) => ({
    id: n.id,
    ticker: n.ticker,
    headline: n.headline,
    summary: n.summary.slice(0, 500),
  }));
  const prompt = `${INSTRUCTIONS}\n\n新聞陣列：\n${JSON.stringify(payload)}`;

  // Gemini 免費層偶爾 503/限流，重試幾次
  let text = "";
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await getAI().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      });
      text = res.text ?? "";
      if (text) break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, (attempt + 1) * 4000));
    }
  }
  if (!text) throw lastErr ?? new Error("Gemini 無回應");

  let parsed: { items?: AnalysisItem[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const byId = new Map((parsed.items ?? []).map((r) => [r.id, r]));

  // 以輸入為準補齊；模型漏掉的就當中性/雜訊
  return items.map((n) => {
    const a = byId.get(n.id);
    return {
      ...n,
      sentiment: a?.sentiment ?? "neutral",
      confidence: typeof a?.confidence === "number" ? a.confidence : 0,
      credibility: a?.credibility ?? "unknown",
      longTermImpact: a?.longTermImpact ?? "noise",
      reason: a?.reason ?? "",
    };
  });
}
