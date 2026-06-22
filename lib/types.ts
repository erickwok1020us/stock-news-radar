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

/** 經 Gemini 判讀後的一則消息 */
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
  /** 進場時機（技術指標合成，方向感知） */
  timing: TimingRead | null;
  /** in-play 熱度 0-100（量能/波動/異動/新聞），短線視圖排序用 */
  heat: number;
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
  /** 訊號成效追蹤摘要 */
  track: TrackSummary | null;
}

/** 由日線歷史（Stooq）算出的技術統計 */
export interface MarketStats {
  /** 14 日 ATR（平均真實波動，當風險單位用） */
  atr14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** 近 20 日擺動高/低（短線阻力/支撐） */
  swingHigh: number;
  swingLow: number;
  high52: number;
  low52: number;
  avgVol20: number | null;
  lastVol: number | null;
  /** RSI(14)：>70 超買 / <30 超賣 */
  rsi14: number | null;
  /** MACD（動能） */
  macd: { macd: number; signal: number; hist: number } | null;
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
  /** 操作方向：做多 / 做空 */
  direction: "long" | "short";
  /** 進場參考區 [低, 高] */
  entryZone: [number, number];
  /** 順勢突破/跌破參考 */
  breakout: number;
  stop: number;
  target: number;
  /** 風報比 */
  rr: number;
  /** 每股風險（進場 − 止損） */
  riskPerShare: number;
  basis: string;
}

/** 進場時機（技術指標合成，方向感知）。非預測，是紀律性的「現在是不是好時機」讀數。 */
export interface TimingRead {
  /** 建議方向：long=做多 / short=做空 / none=觀望 */
  direction: "long" | "short" | "none";
  /** 該方向的有利程度 0-1 */
  score: number;
  /** 一句話結論 */
  label: string;
  /** 拆解因子（趨勢/RSI/量能/MACD/乖離…） */
  factors: string[];
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

// ── 成效追蹤（訊號回測）──────────────────────────────────────

/** 一筆被記錄、等待結算的短線訊號 */
export interface TrackedSignal {
  id: string;
  /** 由哪一套策略（公式）開出 */
  strategy: string;
  ticker: string;
  direction: "long" | "short";
  createdAt: string;
  createdPrice: number;
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
  /** open=未結算 / hit_target=達標(贏) / hit_stop=停損(輸) / expired=到期結算 */
  status: "open" | "hit_target" | "hit_stop" | "expired";
  closedAt?: string;
  closePrice?: number;
  /** 實現的 R 倍數 */
  rMultiple?: number;
  /** 開倉中：目前的浮動 R（依現價，summary 時計算，不持久化） */
  unrealizedR?: number;
  /** 假設每單 100 港幣的損益（已結算=實現/開倉中=浮動），summary 時計算 */
  pnlHKD?: number;
}

export interface TrackStat {
  closed: number;
  wins: number;
  losses: number;
  /** 勝率 = wins / (wins + losses) */
  winRate: number;
  avgR: number;
  totalR: number;
  /** 假設每張單投入 100 港幣，已結算單的累積損益（港幣） */
  totalHKD: number;
}

/** 單一策略（公式）的成績 */
export interface StrategyStat extends TrackStat {
  name: string;
}

export interface TrackSummary extends TrackStat {
  open: number;
  /** 各策略（公式）各自一份成績，長期比出最好 */
  byStrategy: StrategyStat[];
  /** 最近結算的幾筆，給 UI 顯示 */
  recent: TrackedSignal[];
  /** 目前進行中的模擬單（含浮動 R），給 UI 顯示「個別情況」 */
  openList: TrackedSignal[];
}
