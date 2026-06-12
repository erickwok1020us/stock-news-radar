"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";
import { TickerCard } from "@/components/TickerCard";
import { LongCard } from "@/components/LongCard";
import { PositionsView } from "@/components/PositionsView";

const DATA_URL = process.env.NEXT_PUBLIC_DATA_URL || "/snapshot.json";
const REFRESH_MS = 60_000;

type View = "short" | "long" | "positions";

const DEFAULT_ACCOUNT = { size: 10000, riskPct: 0.01, currency: "USD" };

export default function Home() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("short");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (alive) {
          setSnap(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const account = snap?.account ?? DEFAULT_ACCOUNT;
  const tickers = snap?.tickers ?? [];
  const positions = snap?.positions ?? [];
  // 短線：訊號最強的浮上來
  const shortSorted = [...tickers].sort(
    (a, b) => Math.abs(b.signal.score) - Math.abs(a.signal.score),
  );
  const posAlerts = positions.filter((p) => p.urgent).length;

  return (
    <div className="wrap">
      <div className="header">
        <h1>📡 美股雷達</h1>
        <span className="meta">
          {snap
            ? `更新於 ${new Date(snap.generatedAt).toLocaleString("zh-Hant")} · 每 60 秒刷新`
            : loading
              ? "載入中…"
              : ""}
        </span>
      </div>

      <div className="seg">
        <button className={view === "short" ? "active" : ""} onClick={() => setView("short")}>短線 Day Trade</button>
        <button className={view === "long" ? "active" : ""} onClick={() => setView("long")}>長期持有</button>
        <button className={view === "positions" ? "active" : ""} onClick={() => setView("positions")}>
          持倉{posAlerts > 0 ? ` (${posAlerts})` : ""}
        </button>
      </div>

      {error && (
        <div className="error">
          讀取資料失敗：{error}
          <br />
          （若還沒部署 ingest，這是正常的。設好 NEXT_PUBLIC_DATA_URL 指向 raw GitHub 的 snapshot.json 即可。）
        </div>
      )}

      {view === "positions" ? (
        <PositionsView positions={positions} account={account} />
      ) : tickers.length > 0 ? (
        <div className="grid">
          {view === "short"
            ? shortSorted.map((t) => <TickerCard key={t.ticker} t={t} account={account} />)
            : tickers.map((t) => <LongCard key={t.ticker} t={t} />)}
        </div>
      ) : (
        !loading && <div className="empty">尚無資料 — 等第一次 ingest 跑完就會出現。</div>
      )}
    </div>
  );
}
