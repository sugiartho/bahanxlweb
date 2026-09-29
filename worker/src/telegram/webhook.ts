import { Hono } from "hono";
import { resolveStorage } from "../storage/resolve";
import type { AppEnv } from "../types";
import { loadTelegramConfig } from "./config";
import { handleUpdate } from "./handler";
import type { TelegramUpdate } from "./types";

export const telegramWebhook = new Hono<AppEnv>();

function runInBackground(c: { executionCtx?: ExecutionContext }, work: Promise<void>): void {
  try {
    const ctx = c.executionCtx;
    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      return;
    }
  } catch {
    // Local tests may call app.fetch without ExecutionContext.
  }
  void work.catch((e) => console.error("telegram webhook background error", e));
}

telegramWebhook.post("/telegram/webhook", async (c) => {
  const storage = resolveStorage(c.env);
  const config = await loadTelegramConfig(c.env, storage);

  if (!config.bot_token) {
    return c.json({ ok: false, error: "Telegram bot not configured" }, 503);
  }

  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (config.webhook_secret && secret !== config.webhook_secret) {
    return c.text("Forbidden", 403);
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.text("Bad Request", 400);
  }

  runInBackground(
    c,
    handleUpdate(c.env, storage, update, config).catch((e) => {
      console.error("telegram webhook error", e);
    }),
  );

  return c.json({ ok: true });
});