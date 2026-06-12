import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Account, Position } from "./types";

export interface WatchlistConfig {
  alertThreshold: number;
  tickers: string[];
}

/** 讀 config/watchlist.json —— 以 repo 根目錄為基準（GH Actions / 本機都從根目錄跑） */
export function loadWatchlist(): WatchlistConfig {
  const path = resolve(process.cwd(), "config/watchlist.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    alertThreshold:
      typeof raw.alertThreshold === "number" ? raw.alertThreshold : 0.7,
    tickers: Array.isArray(raw.tickers)
      ? raw.tickers.map((t: string) => t.toUpperCase())
      : [],
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`缺少環境變數 ${name} —— 請設定 .env（本機）或 GitHub secret（Actions）`);
  }
  return v;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export interface Portfolio {
  account: Account;
  positions: Position[];
}

const DEFAULT_ACCOUNT: Account = { size: 10000, riskPct: 0.01, currency: "USD" };

/**
 * 讀持倉 + 帳戶設定。
 * 優先讀環境變數 POSITIONS_JSON（整包 JSON）—— 公開 repo 時把真實持倉放在
 * GitHub Secret，就不會進版控；沒設才退回 config/positions.json。
 */
export function loadPortfolio(): Portfolio {
  let raw: { account?: Partial<Account>; positions?: Position[] } = {};
  const fromEnv = process.env.POSITIONS_JSON;
  if (fromEnv) {
    try {
      raw = JSON.parse(fromEnv);
    } catch {
      raw = {};
    }
  } else {
    try {
      raw = JSON.parse(
        readFileSync(resolve(process.cwd(), "config/positions.json"), "utf8"),
      );
    } catch {
      raw = {};
    }
  }
  return {
    account: { ...DEFAULT_ACCOUNT, ...(raw.account ?? {}) },
    positions: Array.isArray(raw.positions) ? raw.positions : [],
  };
}
