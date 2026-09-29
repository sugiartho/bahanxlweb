import type { Env } from "../env";
import type { StorageBackend } from "../storage/types";
import { createTelegramApi } from "./api";
import { loadTelegramConfig, type TelegramConfig } from "./config";
import { BotContext } from "./context";
import { handleCallback } from "./callbacks";
import { COMMANDS } from "./commands";
import {
  handleFamilyCodeInput,
  handleOptionCodeInput,
  handleWalletNumberInput,
} from "./purchase-flow";
import type { TelegramUpdate } from "./types";

export async function handleUpdate(
  env: Env,
  storage: StorageBackend,
  update: TelegramUpdate,
  preloadedConfig?: TelegramConfig,
): Promise<void> {
  const config = preloadedConfig ?? (await loadTelegramConfig(env, storage));
  if (!config.bot_token) return;

  const api = createTelegramApi(config.bot_token);
  const ctx = new BotContext(env, storage, api);

  const cb = update.callback_query;
  if (cb?.message) {
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    await handleCallback(ctx, chatId, msgId, cb.id, cb.data ?? "");
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  if (!text) return;

  if (await ctx.handleTextConfirm(chatId, text)) return;

  if (text.startsWith("/")) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().split("@")[0];
    const args = parts.slice(1);
    const handler = COMMANDS[cmd];
    if (handler) {
      api.sendChatAction(chatId);
      await handler(ctx, chatId, args);
      return;
    }
    await api.sendMessage(chatId, "Command tidak dikenal. Ketik /help untuk daftar command.");
    return;
  }

  api.sendChatAction(chatId);
  const user = await ctx.linkedUser(chatId);
  const state = user ? await ctx.getState(chatId) : null;
  const step = state?.step;

  if (user && step === "await_family_code") {
    await handleFamilyCodeInput(ctx, chatId, user.username, text);
    return;
  }
  if (user && step === "await_option_code") {
    await handleOptionCodeInput(ctx, chatId, user.username, text);
    return;
  }
  if (user && step === "await_wallet_number") {
    await handleWalletNumberInput(ctx, chatId, user.username, text);
    return;
  }

  if (user) {
    await ctx.sendMainMenu(chatId, user.username);
  } else {
    await api.sendMessage(chatId, "Akun belum di-link. Generate kode di WebUI lalu kirim:\n<code>/link KODE</code>");
  }
}