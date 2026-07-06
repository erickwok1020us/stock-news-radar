// 多套「明確公式」策略（趨勢／反轉／動能／量能／區間／事件 各種派別）：各自依規則自動開模擬單。
// 每套都是透明、可驗證的判準。track.ts 讓每套各自下注、各自結算、各自一份成績表，長期比出最好。
// style（派別）：順勢=追漲殺跌、逆勢=抄底摸頂、事件=消息面、綜合=多因子合成。故意讓兩派對打。
import type { TickerSnapshot } from "./types";

export interface StratSignal {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
}

export interface Strategy {
  name: string;
  basis: string;
  /** 派別：順勢（追漲殺跌）/ 逆勢（抄底摸頂）/ 事件 / 綜合 */
  style: "順勢" | "逆勢" | "事件" | "綜合";
  evaluate: (t: TickerSnapshot) => StratSignal | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 用 ATR 配 1.5×風險、2:1 風報比 產生進出場 */
function levelsFor(direction: "long" | "short", price: number, atr: number): StratSignal {
  const risk = 1.5 * atr;
  return {
    direction,
    entry: r2(price),
    stop: r2(direction === "long" ? price - risk : price + risk),
    target: r2(direction === "long" ? price + 2 * risk : price - 2 * risk),
    riskPerShare: r2(risk),
  };
}

export const STRATEGIES: Strategy[] = [
  {
    name: "綜合時機",
    basis: "趨勢+RSI+MACD+量能+新聞 合成方向",
    style: "綜合",
    evaluate(t) {
      const d = t.day;
      const dir = t.timing?.direction;
      if ((dir === "long" || dir === "short") && d) {
        return {
          direction: dir,
          entry: r2((d.entryZone[0] + d.entryZone[1]) / 2),
          stop: d.stop,
          target: d.target,
          riskPerShare: d.riskPerShare,
        };
      }
      return null;
    },
  },
  {
    name: "RSI反轉",
    basis: "RSI<30 做多 / >70 做空（抓超賣反彈、超買回落）",
    style: "逆勢",
    evaluate(t) {
      const r = t.stats?.rsi14;
      const p = t.quote?.current;
      const atr = t.stats?.atr14;
      if (r == null || !p || !atr) return null;
      if (r < 30) return levelsFor("long", p, atr);
      if (r > 70) return levelsFor("short", p, atr);
      return null;
    },
  },
  {
    name: "均線順勢",
    basis: "站上 SMA20>SMA50 做多 / 跌破 SMA20<SMA50 做空",
    style: "順勢",
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.sma20 || !s.sma50 || !s.atr14 || !p) return null;
      if (p > s.sma20 && s.sma20 > s.sma50) return levelsFor("long", p, s.atr14);
      if (p < s.sma20 && s.sma20 < s.sma50) return levelsFor("short", p, s.atr14);
      return null;
    },
  },
  {
    name: "新聞動能",
    basis: "新聞情緒強(±0.3)就順著做",
    style: "事件",
    evaluate(t) {
      const sc = t.signal.score;
      const p = t.quote?.current;
      const atr = t.stats?.atr14;
      if (!p || !atr) return null;
      if (sc >= 0.3) return levelsFor("long", p, atr);
      if (sc <= -0.3) return levelsFor("short", p, atr);
      return null;
    },
  },
  {
    name: "突破",
    basis: "突破近 20 日高做多 / 跌破近 20 日低做空",
    style: "順勢",
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.atr14 || !p) return null;
      if (s.swingHigh && p >= s.swingHigh) return levelsFor("long", p, s.atr14);
      if (s.swingLow && p <= s.swingLow) return levelsFor("short", p, s.atr14);
      return null;
    },
  },
  {
    name: "爆量順勢",
    basis: "成交量爆量（>1.8×20日均量）就順著當日漲跌方向做",
    style: "順勢",
    evaluate(t) {
      const s = t.stats;
      const q = t.quote;
      if (!s?.atr14 || !s.avgVol20 || !s.lastVol || !q) return null;
      if (s.lastVol < s.avgVol20 * 1.8) return null; // 沒爆量
      if (Math.abs(q.changePct) < 1) return null; // 當日方向不夠明顯
      return levelsFor(q.changePct > 0 ? "long" : "short", q.current, s.atr14);
    },
  },
  {
    name: "區間回歸",
    basis: "預估當日區間=昨收±ATR；碰到預估低位做多、高位做空（賭往中間回歸）",
    style: "逆勢",
    evaluate(t) {
      const s = t.stats;
      const q = t.quote;
      if (!s?.atr14 || !q?.prevClose || !q.current) return null;
      const low = q.prevClose - 0.8 * s.atr14; // 預估當日低位
      const high = q.prevClose + 0.8 * s.atr14; // 預估當日高位
      if (q.current <= low) return levelsFor("long", q.current, s.atr14);
      if (q.current >= high) return levelsFor("short", q.current, s.atr14);
      return null;
    },
  },
  {
    name: "乖離回歸",
    basis: "偏離 20 日均線過大（>2×ATR）就賭回歸：太高做空、太低做多",
    style: "逆勢",
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.sma20 || !s.atr14 || !p) return null;
      const dev = p - s.sma20;
      if (dev >= 2 * s.atr14) return levelsFor("short", p, s.atr14);
      if (dev <= -2 * s.atr14) return levelsFor("long", p, s.atr14);
      return null;
    },
  },
  {
    name: "52週動能",
    basis: "逼近 52 週高點（2%內）做多、逼近 52 週低點做空（強者恆強）",
    style: "順勢",
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.atr14 || !s.high52 || !s.low52 || !p) return null;
      if (p >= s.high52 * 0.98) return levelsFor("long", p, s.atr14);
      if (p <= s.low52 * 1.02) return levelsFor("short", p, s.atr14);
      return null;
    },
  },
  {
    name: "MACD動能",
    basis: "MACD 在零軸上且柱狀為正做多；零軸下且柱狀為負做空",
    style: "順勢",
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.macd || !s.atr14 || !p) return null;
      const { macd, signal, hist } = s.macd;
      if (macd > 0 && macd > signal && hist > 0) return levelsFor("long", p, s.atr14);
      if (macd < 0 && macd < signal && hist < 0) return levelsFor("short", p, s.atr14);
      return null;
    },
  },
];
