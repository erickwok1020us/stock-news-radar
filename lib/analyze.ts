// 用 Claude Haiku 4.5 判每則新聞的多空 / 信心 / 「已證實 vs 傳聞」/「是否改變長期論點」。
// 走 tool-use 強制結構化輸出（tool_choice 指定工具），不靠解析自由文字。
import Anthropic from "@anthropic-ai/sdk";
import type { AnalyzedNews, Credibility, RawNews, Sentiment } from "./types";

const MODEL = "claude-haiku-4-5";

// SDK 會自動讀 ANTHROPIC_API_KEY
const client = new Anthropic();

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "record_analysis",
  description: "記錄每一則新聞的判讀結果",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "每則新聞一個物件，用 id 對應輸入",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "對應輸入新聞的 id" },
            sentiment: {
              type: "string",
              enum: ["bullish", "bearish", "neutral"],
              description: "對該股短線股價的影響方向",
            },
            confidence: { type: "number", description: "信心 0-1" },
            credibility: {
              type: "string",
              enum: ["confirmed", "rumor", "unknown"],
              description:
                "confirmed=已證實事實(財報/官方公告)；rumor=未證實傳聞/推測/小道消息；unknown=無法判斷",
            },
            longTermImpact: {
              type: "string",
              enum: ["thesis", "noise"],
              description:
                "thesis=可能改變公司長期投資論點(基本面/競爭力/結構性)；noise=只是短線雜訊",
            },
            reason: {
              type: "string",
              description: "一句話原因，繁體中文，20字內",
            },
          },
          required: [
            "id",
            "sentiment",
            "confidence",
            "credibility",
            "longTermImpact",
            "reason",
          ],
        },
      },
    },
    required: ["items"],
  },
};

const SYSTEM = `你是股票新聞分析師。針對每一則美股新聞判斷：
1. sentiment：對該股「短線股價」偏多(bullish)/偏空(bearish)/中性(neutral)。
2. confidence：你的信心 0-1。
3. credibility：已證實的事實(confirmed，如財報、官方公告、成交)還是未經證實的傳聞/推測/小道消息(rumor，如「據傳」「傳聞」「分析師猜測」)，無法判斷則 unknown。傳聞常被用來拉抬出貨，要嚴格區分。
4. longTermImpact：這則消息是否可能「改變公司的長期投資論點」(thesis，如護城河、長期成長、結構性競爭力、重大財務變化)，還是只是短線雜訊(noise)。長期投資人只該理會 thesis。
5. reason：一句話原因，繁體中文，20字內。
務必對輸入陣列中「每一則」都輸出對應結果。`;

interface AnalysisItem {
  id: string;
  sentiment: Sentiment;
  confidence: number;
  credibility: Credibility;
  longTermImpact: "thesis" | "noise";
  reason: string;
}

/** 把一批未分析新聞送 Claude，回傳帶判讀結果的版本（順序與輸入一致） */
export async function analyzeNews(items: RawNews[]): Promise<AnalyzedNews[]> {
  if (items.length === 0) return [];

  const payload = items.map((n) => ({
    id: n.id,
    ticker: n.ticker,
    headline: n.headline,
    summary: n.summary.slice(0, 500),
  }));

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "record_analysis" },
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Claude 未回傳 tool_use 結果");
  }

  const result = block.input as { items?: AnalysisItem[] };
  const byId = new Map((result.items ?? []).map((r) => [r.id, r]));

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
