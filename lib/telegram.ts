// Telegram 即時推播（免費）。沒設 token/chatId 就直接略過。
export async function sendTelegram(
  text: string,
  token: string | undefined,
  chatId: string | undefined,
): Promise<void> {
  if (!token || !chatId) return; // 沒設定就不推播
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn("  ⚠ Telegram 推播失敗:", res.status, await res.text());
    }
  } catch (err) {
    console.warn("  ⚠ Telegram 推播例外:", (err as Error).message);
  }
}
