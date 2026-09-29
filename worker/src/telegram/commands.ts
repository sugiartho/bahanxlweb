import type { BotContext } from "./context";

export type CommandHandler = (ctx: BotContext, chatId: number, args: string[]) => Promise<void>;

export const COMMANDS: Record<string, CommandHandler> = {
  "/start": (ctx, chatId, args) => ctx.cmdStart(chatId, args),
  "/help": (ctx, chatId) => ctx.cmdHelp(chatId),
  "/link": (ctx, chatId, args) => ctx.cmdLink(chatId, args),
  "/unlink": (ctx, chatId) => ctx.cmdUnlink(chatId),
  "/kuota": (ctx, chatId) => ctx.cmdKuota(chatId),
  "/saldo": (ctx, chatId) => ctx.cmdKuota(chatId),
  "/paket": (ctx, chatId) => ctx.cmdKuota(chatId),
  "/beli": (ctx, chatId, args) => ctx.cmdBeli(chatId, args),
  "/unsub": async (ctx, chatId, args) => {
    const user = await ctx.requireLinked(chatId);
    if (!user) return;
    if (!args.length) {
      await ctx.showUnsubMenu(chatId, user.username, null);
      return;
    }
    const active = await ctx.requireActiveAccount(chatId, user.username);
    if (!active) return;
    const quotaCode = args[0];
    let quotaName = quotaCode;
    let productDomain = "";
    let productSubType = "";
    try {
      const quotas = await ctx.fetchActiveQuotas(user.username, active);
      for (const q of quotas) {
        if (q.quota_code === quotaCode) {
          quotaName = String(q.name ?? quotaCode);
          productDomain = String(q.product_domain ?? "");
          productSubType = String(q.product_subscription_type ?? "");
          break;
        }
      }
    } catch {
      // ignore
    }
    await ctx.savePending(chatId, {
      action: "unsub",
      quota_code: quotaCode,
      quota_name: quotaName,
      product_domain: productDomain,
      product_subscription_type: productSubType,
      account: active as unknown as Record<string, unknown>,
      expires: Math.floor(Date.now() / 1000) + 120,
    });
    const { kbBackMenu } = await import("./keyboards");
    const { esc } = await import("./formatters");
    await ctx.api.sendMessage(
      chatId,
      `<b>Konfirmasi Unsubscribe</b>\n\n📦 ${esc(quotaName)}\n📱 <code>${active.number}</code>`,
      kbBackMenu([
        [
          { text: "✅ Ya, Unsubscribe", callback_data: "confirm:unsub" },
          { text: "❌ Batal", callback_data: "unsub:list" },
        ],
      ]),
    );
  },
  "/history": (ctx, chatId) => ctx.cmdHistory(chatId),
  "/menu": (ctx, chatId) => ctx.cmdMenu(chatId),
  "/nomor": (ctx, chatId) => ctx.cmdNomor(chatId),
};