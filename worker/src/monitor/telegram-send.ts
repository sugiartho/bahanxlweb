import type { Env } from "../env";
import { getUser } from "../auth/users";
import { USER_TELEGRAM } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import { createTelegramApi } from "../telegram/api";
import { loadTelegramConfig } from "../telegram/config";

export interface TelegramSendConfig {
  bot_token: string;
  chat_id: string;
}

async function loadUserTelegram(storage: StorageBackend, username: string): Promise<TelegramSendConfig> {
  const raw = await getTextBlob(storage, username, USER_TELEGRAM);
  if (!raw) return { bot_token: "", chat_id: "" };
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      bot_token: String(data.bot_token ?? "").trim(),
      chat_id: String(data.chat_id ?? "").trim(),
    };
  } catch {
    return { bot_token: "", chat_id: "" };
  }
}

export async function resolveSendConfig(
  env: Env,
  storage: StorageBackend,
  username?: string,
): Promise<TelegramSendConfig> {
  const globalCfg = await loadTelegramConfig(env, storage);
  let token = globalCfg.bot_token.trim();
  let chat = "";

  if (username) {
    const user = await getUser(storage, username);
    if (user?.telegram_chat_id) chat = String(user.telegram_chat_id);
  }

  const perUser = username ? await loadUserTelegram(storage, username) : { bot_token: "", chat_id: "" };
  if (!chat) chat = perUser.chat_id;
  if (!token) token = perUser.bot_token;

  return { bot_token: token, chat_id: chat };
}

export async function saveUserTelegram(
  storage: StorageBackend,
  username: string,
  botToken: string,
  chatId: string,
): Promise<void> {
  await storage.putBlob(
    username,
    USER_TELEGRAM,
    JSON.stringify({
      bot_token: (botToken || "").trim(),
      chat_id: (chatId || "").trim(),
    }),
  );
}

export async function sendTelegram(
  env: Env,
  storage: StorageBackend,
  text: string,
  options: { cfg?: TelegramSendConfig; username?: string } = {},
): Promise<{ ok: boolean; info: string }> {
  const cfg = options.cfg ?? (await resolveSendConfig(env, storage, options.username));
  const token = cfg.bot_token.trim();
  const chat = cfg.chat_id.trim();
  if (!token || !chat) return { ok: false, info: "Bot token / chat_id belum di-set" };

  const api = createTelegramApi(token);
  const chatId = Number.parseInt(chat, 10);
  if (!Number.isFinite(chatId)) return { ok: false, info: "Chat ID invalid" };

  try {
    const result = await api.sendMessageDetailed(chatId, text);
    return result.ok
      ? { ok: true, info: "Pesan terkirim" }
      : { ok: false, info: result.error ?? "Gagal kirim pesan" };
  } catch (e) {
    return { ok: false, info: `Exception: ${e}` };
  }
}