// 5 套「明確公式」策略：各自依規則自動開模擬單。每套都是透明、可驗證的判準。
// 之後 track.ts 會讓每套各自下注、各自結算、各自一份成績表，長期比出最好。
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
    evaluate(t) {
      const s = t.stats;
      const p = t.quote?.current;
      if (!s?.atr14 || !p) return null;
      if (s.swingHigh && p >= s.swingHigh) return levelsFor("long", p, s.atr14);
      if (s.swingLow && p <= s.swingLow) return levelsFor("short", p, s.atr14);
      return null;
    },
  },
];
