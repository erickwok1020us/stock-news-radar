// 整個系統共用的資料型別 —— ingest 腳本和前端都從這裡 import

export type Sentiment = "bullish" | "bearish" | "neutral";

/** 已證實 vs 傳聞 —— 這是幫你閃開「放消息拉高出貨」陷阱的關鍵欄位 */
export type Credibility = "confirmed" | "rumor" | "unknown";

/** 從新聞來源抓到、尚未分析的一則消息 */
export interface RawNews {
  id: string;
  ticker: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  /** unix 秒 */
  datetime: number;
}

/** 經 Claude 判讀後的一則消息 */
export interface AnalyzedNews extends RawNews {
  sentiment: Sentiment;
  /** 0-1 */
  confidence: number;
  credibility: Credibility;
  /** 對長期論點的影響：thesis=可能改變論點 / noise=短線雜訊 */
  longTermImpact: "thesis" | "noise";
  /** 一句話原因（繁中） */
  reason: string;
}

export interface Quote {
  /** 現價 */
  current: number;
  /** 漲跌幅 % */
  changePct: number;
  high: number;
  low: number;
  prevClose: number;
}

export interface TickerSnapshot {
  ticker: string;
  quote: Quote | null;
  signal: {
    sentiment: Sentiment;
    /** 綜合分數 -1..1 */
    score: number;
    bullCount: number;
    bearCount: number;
  };
  /** StockTwits 散戶情緒（選用，抓不到就是 null） */
  social: { bullish: number; bearish: number } | null;
  /** 技術統計（ATR/均線/區間/量能）；抓不到歷史就是 null */
  stats: MarketStats | null;
  /** 規則計算的價位框架 —— 透明公式，非預測 */
  day: DayLevels | null;
  long: LongLevels | null;
  /** 基本面（估值/成長/體質/分析師）；抓不到就是 null */
  fundamentals: Fundamentals | null;
  news: AnalyzedNews[];
}

/** 寫進 data/snapshot.json 的完整快照 */
export interface Snapshot {
  /** ISO 時間 */
  generatedAt: string;
  account: Account;
  tickers: TickerSnapshot[];
  /** 對每筆持倉的即時檢視 + 調整建議 */
  positions: PositionReview[];
}

/** 由日線歷史（Stooq）算出的技術統計 */
export interface MarketStats {
  /** 14 日 ATR（平均真實波動，當風險單位用） */
  atr14: number | null;
  sma50: number | null;
  sma200: number | null;
  /** 近 20 日擺動高/低（短線阻力/支撐） */
  swingHigh: number;
  swingLow: number;
  high52: number;
  low52: number;
  avgVol20: number | null;
  lastVol: number | null;
}

/** 基本面快照（Finnhub 免費端點：profile2 / metric / recommendation） */
export interface Fundamentals {
  /** 市值（百萬美元） */
  marketCap: number | null;
  industry: string | null;
  peTTM: number | null;
  psTTM: number | null;
  /** 毛利率 %（TTM） */
  grossMarginTTM: number | null;
  beta: number | null;
  /** EPS 年增 % */
  epsGrowthTTMYoy: number | null;
  /** 營收年增 % */
  revenueGrowthTTMYoy: number | null;
  analyst: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  } | null;
}

/** 短線價位框架（規則算出，非預測） */
export interface DayLevels {
  /** 進場參考區 [低, 高] */
  entryZone: [number, number];
  /** 突破買進參考 */
  breakout: number;
  stop: number;
  target: number;
  /** 風報比 */
  rr: number;
  /** 每股風險（進場 − 止損） */
  riskPerShare: number;
  basis: string;
}

/** 長期價位框架（結構錨點；「止損」= 檢討觸發，非緊停損） */
export interface LongLevels {
  /** 分批買進區 [低, 高] */
  accumulateZone: [number, number];
  /** 減碼/止盈參考 */
  trimZone: number;
  /** 檢討觸發價（跌破=轉弱，檢視論點） */
  reviewTrigger: number;
  /** 現價是否明顯偏離均線（偏貴） */
  stretched: boolean;
  basis: string;
}

// ── 持倉管理 ──────────────────────────────────────────────

export type PositionMode = "day" | "long";

/** 你的一筆持倉（記在 config/positions.json） */
export interface Position {
  id: string;
  ticker: string;
  mode: PositionMode;
  shares: number;
  /** 成本價 */
  entry: number;
  /** 目前掛的止損（0/未填則系統會建議補上） */
  stop?: number;
  /** 目前掛的止盈/目標（0/未填則由框架建議） */
  target?: number;
  openedAt?: string;
  note?: string;
}

export interface Account {
  size: number;
  riskPct: number;
  currency: string;
}

export type PosAction =
  | "hold" // 續抱
  | "move_stop_be" // 移動止損到保本
  | "trail_stop" // 順勢上移止損/檢討價
  | "take_partial" // 部分減碼/止盈
  | "exit" // 出場（止損觸及）
  | "review"; // 檢討（長期論點/估值）

/** 對一筆持倉的即時檢視 + 調整建議 */
export interface PositionReview {
  position: Position;
  price: number;
  pnlPct: number;
  pnlAmount: number;
  /** 目前獲利是幾個 R（依原始風險）；沒設止損則 null */
  rMultiple: number | null;
  action: PosAction;
  /** 建議的新止損/檢討價（null = 維持） */
  suggestedStop: number | null;
  suggestedTarget: number | null;
  reason: string;
  /** true → 該推播提醒 */
  urgent: boolean;
}
