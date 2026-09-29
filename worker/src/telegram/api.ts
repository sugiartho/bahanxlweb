import type { InlineKeyboard } from "./types";

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

export type ChatAction = "typing" | "upload_photo" | "upload_document";

export interface TelegramApi {
  sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<boolean>;
  sendMessageDetailed(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<TelegramSendResult>;
  editMessage(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard): Promise<boolean>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  sendChatAction(chatId: number, action?: ChatAction): void;
}

export function createTelegramApi(botToken: string, fetchFn: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function post(method: string, body: Record<string, unknown>): Promise<Response> {
    return fetchFn(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function sendMessageDetailed(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<TelegramSendResult> {
    const attempts: Array<Record<string, unknown>> = [
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
    ];

    let lastError = "Gagal kirim pesan";
    for (const payload of attempts) {
      try {
        const res = await post("sendMessage", payload);
        if (res.ok) return { ok: true };
        let data: { description?: string } = {};
        try {
          data = (await res.json()) as { description?: string };
        } catch {
          // ignore
        }
        lastError = String(data.description ?? `HTTP ${res.status}`);
      } catch (e) {
        lastError = String(e);
      }
    }
    return { ok: false, error: lastError };
  }

  return {
    async sendMessage(chatId, text, replyMarkup) {
      const result = await sendMessageDetailed(chatId, text, replyMarkup);
      return result.ok;
    },

    sendMessageDetailed,

    async editMessage(chatId, messageId, text, replyMarkup) {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      try {
        const res = await post("editMessageText", payload);
        return res.ok;
      } catch {
        return false;
      }
    },

    async answerCallbackQuery(callbackQueryId, text) {
      try {
        const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
        if (text) body.text = text;
        void post("answerCallbackQuery", body);
      } catch {
        // ignore
      }
    },

    sendChatAction(chatId, action = "typing") {
      void post("sendChatAction", { chat_id: chatId, action }).catch(() => {});
    },
  };
}