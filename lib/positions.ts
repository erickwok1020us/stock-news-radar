// 持倉管理 —— 對每筆已持倉，依透明規則給「是否調整止損/止盈」的建議。
// 核心原則：止損只會往「有利方向」移（多單只升不降），絕不建議放寬風險。
// 這些是紀律參考，不是預測。最終下單與風險由使用者承擔。
import type {
  Account,
  MarketStats,
  PosAction,
  Position,
  PositionReview,
} from "./types";

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface PositionSignals {
  /** 該檔出現偏空、已證實的催化劑 */
  bearishCatalyst?: boolean;
  /** 該檔出現可能改變長期論點的新聞 */
  thesisChanged?: boolean;
}

export function reviewPosition(
  pos: Position,
  price: number,
  stats: MarketStats | null,
  sig: PositionSignals = {},
): PositionReview {
  const entry = pos.entry;
  const curStop = pos.stop && pos.stop > 0 ? pos.stop : null;
  const pnlPct = entry > 0 ? (price - entry) / entry : 0;
  const pnlAmount = (price - entry) * pos.shares;
  const riskPerShare = curStop ? entry - curStop : null;
  const rMultiple =
    riskPerShare && riskPerShare > 0 ? (price - entry) / riskPerShare : null;
  const atr = stats?.atr14 ?? null;

  const base = {
    position: pos,
    price: r2(price),
    pnlPct,
    pnlAmount: r2(pnlAmount),
    rMultiple,
    suggestedTarget: pos.target && pos.target > 0 ? pos.target : null,
  };

  let action: PosAction = "hold";
  let suggestedStop: number | null = null;
  let reason = "續抱，未觸發調整。";
  let urgent = false;

  if (pos.mode === "day") {
    // 1) 已跌破止損 → 出場
    if (curStop && price <= curStop) {
      return {
        ...base,
        action: "exit",
        suggestedStop: curStop,
        reason: `已觸及止損 ${r2(curStop)}，建議出場。`,
        urgent: true,
      };
    }
    // 2) 順勢計算「只升不降」的新止損：保本(達1R) + ATR 追蹤
    const breakeven = rMultiple !== null && rMultiple >= 1 ? entry : -Infinity;
    const atrTrail = atr ? price - 1.0 * atr : -Infinity;
    const newStop = Math.max(curStop ?? -Infinity, breakeven, atrTrail);

    if (curStop === null) {
      suggestedStop = atr ? r2(price - 1.0 * atr) : r2(price * 0.98);
      action = "trail_stop";
      reason = `尚未設止損，建議補設 ${suggestedStop}（現價下 1×ATR）。`;
      urgent = true;
    } else if (rMultiple !== null && rMultiple >= 2) {
      suggestedStop = r2(Math.max(newStop, entry));
      action = "take_partial";
      reason = `獲利已達 +${rMultiple.toFixed(1)}R，建議減碼一半，剩餘移動止損到 ${suggestedStop}。`;
      urgent = true;
    } else if (rMultiple !== null && rMultiple >= 1 && newStop > curStop + 1e-6) {
      suggestedStop = r2(Math.max(newStop, entry));
      action = "move_stop_be";
      reason = `獲利達 +${rMultiple.toFixed(1)}R，建議移動止損到保本/順勢 ${suggestedStop}。`;
      urgent = true;
    } else if (newStop > curStop + (atr ? 0.25 * atr : 0.005 * price)) {
      suggestedStop = r2(newStop);
      action = "trail_stop";
      reason = `價格走高，建議止損上移到 ${suggestedStop}（順勢、不下移）。`;
    }

    if (sig.bearishCatalyst) {
      urgent = true;
      reason += " ⚠ 出現偏空已證實催化劑，留意。";
    }
  } else {
    // 長期：結構性「檢討價」，順勢上移到 200 日線；跌破才檢視
    const sma200 = stats?.sma200 ?? null;

    if (sma200 && price < sma200) {
      action = "review";
      urgent = true;
      suggestedStop = r2(sma200);
      reason = `跌破 200 日線 ${r2(sma200)}，趨勢轉弱，檢視長期論點/考慮減碼。`;
    } else if (sma200 && price > sma200 * 1.25) {
      action = "take_partial";
      suggestedStop = curStop ? r2(Math.max(curStop, sma200)) : r2(sma200);
      reason = `現價明顯高於 200 日線（偏貴），可考慮部分減碼再平衡，核心續抱。`;
    } else if (sma200) {
      const floor = curStop ? Math.max(curStop, sma200) : sma200;
      if (!curStop || floor > curStop + 1e-6) {
        suggestedStop = r2(floor);
        action = "trail_stop";
        reason = `論點未變，續抱；把「檢討價」上移到 200 日線 ${r2(sma200)}。`;
      } else {
        reason = "論點未變，續抱。";
      }
    }

    if (sig.thesisChanged) {
      action = "review";
      urgent = true;
      reason = "出現可能改變長期論點的新聞，建議檢視這筆持倉。";
    }
  }

  return { ...base, action, suggestedStop, reason, urgent };
}
