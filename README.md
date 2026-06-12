# 📡 美股雷達 (stock-news-radar)

全免費的美股決策輔助工具，三個視圖：

- **短線 Day Trade**：催化劑 + 價位框架（進場／止損／止盈／部位）
- **長期持有**：估值／成長／體質／分析師 + 分批／減碼／檢討價
- **持倉管理**：你的真實持倉損益 + 「是否該調整止損止盈」的即時建議

每 5 分鐘由 GitHub Actions 更新；該動作時 Telegram 推你。

> ⚠️ **先講清楚**（碰真錢必讀）
> - 所有買/賣/止損/止盈價都是**透明規則從真實數據算的，不是 AI 預測、不是穩賺**。型態不保證重演。
> - 是 **5 分鐘級**、非逐秒；免費報價可能延遲；即時分 K/逐筆量是付費。
> - 「傳聞」「論點」標記幫你過濾雜訊，但不完美。
> - **最終下單與風險由你承擔。** 工具的價值是讓你每次都用同一套理性紀律。

---

## 架構

```
雲端 (GitHub Actions, 免費)  每 5 分鐘：
  Finnhub 新聞+報價+基本面 · Stooq 日線(ATR/均線/區間) · StockTwits 散戶情緒
   → Claude Haiku 判 {多空 · 信心 · 已證實/傳聞 · 是否改變長期論點}
   → levels.ts 算短線/長期價位框架 · positions.ts 檢視你的持倉
   → 寫 data/snapshot.json (commit 回 repo) · Telegram 推播
前端 (Vercel/Next.js)  每 60 秒從 raw GitHub 讀 snapshot.json，三視圖切換
```

資料來源全部免費：**Finnhub**（新聞/報價/基本面/分析師）、**Stooq**（日線歷史，免金鑰）、**StockTwits**（散戶情緒，盡力而為）、**Claude Haiku**（判讀）。

---

## 1. 拿金鑰（都有免費額度）

| 服務 | 用途 | 拿金鑰 |
|---|---|---|
| **Finnhub** | 新聞/報價/基本面 | https://finnhub.io |
| **Anthropic** | Claude 判讀 | https://console.anthropic.com |
| **Telegram**（選用） | 推播 | `@BotFather` → `/newbot`；chat id 見下 |

拿 Telegram chat id：跟你的 bot 講句話，開 `https://api.telegram.org/bot<TOKEN>/getUpdates` 找 `chat.id`。

## 2. 本機跑

```bash
npm install
cp .env.example .env      # 填金鑰
npm run ingest            # 跑一次，產生 data/snapshot.json
npm run dev               # http://localhost:3000
```

## 3. 上線（全免費）

1. 推上 GitHub（建議 **Public**：Actions 分鐘數無上限）。
2. repo **Settings → Secrets and variables → Actions** 設四個 secret：`FINNHUB_API_KEY`、`ANTHROPIC_API_KEY`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`。
3. **Actions** 分頁啟用 workflow（已設每 5 分鐘）。
4. Vercel 匯入 repo，設環境變數
   `NEXT_PUBLIC_DATA_URL = https://raw.githubusercontent.com/<你>/stock-news-radar/main/data/snapshot.json`
5.（建議）Vercel **Settings → Git → Ignored Build Step** 填
   `git diff --quiet HEAD^ HEAD -- ':(exclude)data'`（避免每次資料更新都重部署）。

## 4. 設定

| 想做什麼 | 改哪裡 |
|---|---|
| 追蹤清單 / 推播門檻 | `config/watchlist.json` |
| **你的真實持倉 + 帳戶大小/風險%** | `config/positions.json`（`mode` 填 day/long；`stop`/`target` 填 0 讓系統建議） |
| 短線/長期判讀邏輯 | `lib/analyze.ts`（Claude 提示詞） |
| 價位框架公式 | `lib/levels.ts` |
| 持倉調整規則 | `lib/positions.ts` |
| 推播頻率 | `.github/workflows/ingest.yml`（cron，最細 5 分鐘） |

## 5. 算法（透明、可逐行檢查）

**短線價位**（風險單位＝ATR）：回踩支撐進場 · 止損＝支撐下 0.5×ATR · 止盈＝風報比 2:1 · 部位＝帳戶×風險% ÷ 每股風險。

**長期價位**（結構錨點）：分批買進區錨 200 日線 · 減碼參考≈52 週高 · 「止損」其實是**檢討觸發價**（跌破 200 日線或論點改變）。

**持倉管理**（止損只往有利方向移）：
- 短線：+1R → 移到保本；+2R → 減碼一半＋追蹤止損；走高 → 止損上移（現價−1×ATR，只升不降）；跌破止損 → 出場。
- 長期：檢討價順勢上移到 200 日線；跌破或論點改變 → 檢視；估值偏高 → 部分減碼。

> 價格一律由公式算，**Claude 不參與算價**（只判新聞）。

## 6. 成本 / 額度

- **Finnhub**：免費 60 calls/分鐘（報價/新聞/基本面/分析師）。
- **Claude Haiku**：$1/$5 每百萬 token，只判新消息，量小。
- **Stooq / StockTwits / Telegram / Vercel**：免費。
- **GitHub Actions**：Public repo 無上限；Private 免費 2000 分鐘/月（每 5 分鐘會吃很快 → 建議 Public）。

## 7. 檔案結構

```
config/
  watchlist.json     追蹤清單 + 推播門檻
  positions.json     你的真實持倉 + 帳戶設定
lib/
  finnhub.ts         報價 / 新聞 / 基本面
  marketdata.ts      Stooq 日線 → ATR/均線/區間/量能
  stocktwits.ts      散戶情緒（選用）
  analyze.ts         Claude 判讀（多空/信心/傳聞/長期影響）
  levels.ts          短線+長期價位框架（純函式）
  positions.ts       持倉調整建議（純函式）
  telegram.ts        推播
  types.ts           共用型別
scripts/ingest.ts    主流程（Actions 每 5 分鐘跑）
app/                 Next.js 三視圖
components/
  TickerCard.tsx     短線卡
  LongCard.tsx       長期卡
  PositionsView.tsx  持倉管理
data/snapshot.json   給前端的快照 · store.json 去重庫（Actions 自動建）
```

## 8. 下一步

- **連富途/moomoo（本機）**：用 FutuOpenD + Python sidecar 接**即時報價 + 真實持倉自動同步**（取代手動 positions.json）；下單先用**模擬盤 + 一鍵確認**，不做全自動。
- 更多新聞源（Alpha Vantage / Reddit）、價格異動警報、情緒時間序列回看。
