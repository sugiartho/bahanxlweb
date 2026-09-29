import { describe, expect, it, vi } from "vitest";
import {
  ensureWebhookSecret,
  getTelegramWebhookInfo,
  registerTelegramWebhook,
  webhookUrlForRequest,
} from "./webhook-setup";

describe("telegram webhook setup", () => {
  it("builds webhook url from request origin", () => {
    expect(webhookUrlForRequest("https://webui-xl.example.workers.dev/monitoring/telegram")).toBe(
      "https://webui-xl.example.workers.dev/telegram/webhook",
    );
  });

  it("prefers env webhook secret", () => {
    expect(ensureWebhookSecret("blob-secret", "env-secret")).toBe("env-secret");
  });

  it("generates secret when missing", () => {
    const secret = ensureWebhookSecret("", "");
    expect(secret.length).toBeGreaterThan(10);
  });

  it("registers webhook via Telegram API", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ ok: true, description: "Webhook was set" }),
    );
    const result = await registerTelegramWebhook(
      "123:ABC",
      "https://host/telegram/webhook",
      "sec",
      fetchFn,
    );
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("reads webhook info", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          url: "https://host/telegram/webhook",
          pending_update_count: 2,
          last_error_message: "",
        },
      }),
    );
    const info = await getTelegramWebhookInfo("123:ABC", fetchFn);
    expect(info.ok).toBe(true);
    expect(info.url).toContain("/telegram/webhook");
    expect(info.pending_update_count).toBe(2);
  });
});