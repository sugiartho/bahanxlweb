import type { BotContext } from "./context";
import { esc } from "./formatters";
import { kbBackMenu } from "./keyboards";
import { handlePurchaseCallback } from "./purchase-flow";

export async function handleCallback(
  ctx: BotContext,
  chatId: number,
  msgId: number,
  callbackId: string,
  data: string,
): Promise<void> {
  await ctx.api.answerCallbackQuery(callbackId);

  const user = await ctx.linkedUser(chatId);

  if (data.startsWith("menu:")) {
    if (!user) {
      await ctx.api.sendMessage(chatId, "Akun belum di-link. Generate kode di WebUI lalu kirim:\n<code>/link KODE</code>");
      return;
    }
    await handleMenuAction(ctx, chatId, user.username, msgId, data.split(":", 2)[1] ?? "");
    return;
  }

  if (data.startsWith("nomor:")) {
    if (!user) return;
    await handleNumberCallback(ctx, chatId, user.username, msgId, data);
    return;
  }

  if (data.startsWith("purchase:")) {
    if (!user) return;
    await handlePurchaseCallback(ctx, chatId, user.username, msgId, data);
    return;
  }

  if (data.startsWith("confirm:")) {
    if (!user) return;
    await handleConfirmCallback(ctx, chatId, user.username, msgId, data);
    return;
  }

  if (data.startsWith("unsub:")) {
    if (!user) return;
    await handleUnsubCallback(ctx, chatId, user.username, msgId, data);
    return;
  }

  if (data.startsWith("cancel")) {
    if (user) {
      await ctx.clearState(chatId, user.username);
      await ctx.stateStore.clearPending(chatId);
    }
    await ctx.api.sendMessage(chatId, "Dibatalkan.");
    if (user) await ctx.sendMainMenu(chatId, user.username, msgId);
  }
}

async function handleMenuAction(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  action: string,
): Promise<void> {
  if (action === "home") {
    await ctx.sendMainMenu(chatId, username, msgId);
    return;
  }
  if (action === "nomor") {
    await ctx.sendNumberMenu(chatId, username, msgId);
    return;
  }
  if (action === "kuota") {
    ctx.api.sendChatAction(chatId);
    const active = await ctx.requireActiveAccount(chatId, username, msgId);
    if (!active) return;
    await ctx.reply(chatId, msgId, "Mengambil data...");
    await ctx.executeKuota(chatId, username, msgId, active);
    return;
  }
  if (action === "history") {
    ctx.api.sendChatAction(chatId);
    const active = await ctx.requireActiveAccount(chatId, username, msgId);
    if (!active) return;
    await ctx.reply(chatId, msgId, "Mengambil riwayat...");
    await ctx.showHistory(chatId, username, msgId, active);
    return;
  }
  if (action === "unsub") {
    await ctx.showUnsubMenu(chatId, username, msgId);
    return;
  }
  if (action === "help") {
    const { HELP_TEXT } = await import("./keyboards");
    await ctx.finishAction(chatId, username, msgId, HELP_TEXT);
    return;
  }
  if (action === "unlink") {
    const linked = await ctx.linkedUser(chatId);
    if (linked) {
      const { unlinkTelegram } = await import("../auth/users");
      await unlinkTelegram(ctx.storage, linked.username);
      await ctx.clearState(chatId, linked.username);
      await ctx.finishAction(chatId, username, msgId, `Akun <b>${esc(linked.username)}</b> berhasil di-unlink.`);
    } else {
      await ctx.finishAction(chatId, username, msgId, "Tidak ada akun yang di-link.");
    }
  }
}

async function handleNumberCallback(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  data: string,
): Promise<void> {
  if (data === "nomor:menu") {
    await ctx.sendNumberMenu(chatId, username, msgId);
    return;
  }
  if (data.startsWith("nomor:set:")) {
    const msisdn = Number.parseInt(data.split(":", 3)[2] ?? "", 10);
    if (!msisdn) {
      await ctx.finishAction(chatId, username, msgId, "Nomor tidak valid.");
      return;
    }
    const ok = await ctx.saveActiveMsisdn(chatId, username, msisdn);
    if (!ok) {
      await ctx.finishAction(chatId, username, msgId, "Gagal menyimpan nomor aktif.");
      return;
    }
    await ctx.sendMainMenu(chatId, username, msgId);
  }
}

async function handleUnsubCallback(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  data: string,
): Promise<void> {
  if (data === "unsub:list") {
    await ctx.showUnsubMenu(chatId, username, msgId);
    return;
  }
  if (!data.startsWith("unsub:pick:")) {
    await ctx.finishAction(chatId, username, msgId, "Aksi unsubscribe tidak dikenal.");
    return;
  }

  const idx = data.split(":", 3)[2] ?? "";
  const state = await ctx.getState(chatId);
  const raw = (state.unsub_map ?? {})[idx];
  if (!raw) {
    await ctx.finishAction(chatId, username, msgId, "Paket tidak valid atau sudah expired.");
    return;
  }

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    await ctx.finishAction(chatId, username, msgId, "Data paket rusak.");
    return;
  }

  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  await ctx.savePending(chatId, {
    action: "unsub",
    quota_code: info.quota_code,
    quota_name: info.quota_name,
    product_domain: info.product_domain,
    product_subscription_type: info.product_subscription_type,
    account: active as unknown as Record<string, unknown>,
    expires: Math.floor(Date.now() / 1000) + 120,
  });

  const kb = kbBackMenu([
    [
      { text: "✅ Ya, Unsubscribe", callback_data: "confirm:unsub" },
      { text: "❌ Batal", callback_data: "unsub:list" },
    ],
  ]);
  await ctx.reply(
    chatId,
    msgId,
    `<b>Konfirmasi Unsubscribe</b>\n\n📦 ${esc(info.quota_name)}\n📱 <code>${active.number}</code>\n\nYakin ingin stop paket ini?`,
    kb,
  );
}

async function handleConfirmCallback(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  data: string,
): Promise<void> {
  const pending = await ctx.popPending(chatId);
  if (!pending) {
    await ctx.sendMainMenu(chatId, username, msgId);
    return;
  }
  if (pending.expires < Math.floor(Date.now() / 1000)) {
    await ctx.finishAction(chatId, username, msgId, "Konfirmasi sudah expired. Silakan ulangi command.");
    return;
  }

  const action = data.split(":", 2)[1] ?? pending.action;
  if (action === "beli" || pending.action === "beli") {
    await ctx.reply(chatId, msgId, "Memproses pembelian...");
    await ctx.executeBeli(chatId, username, msgId, pending);
    return;
  }
  if (action === "unsub" || pending.action === "unsub") {
    await ctx.reply(chatId, msgId, "Memproses unsubscribe...");
    await ctx.executeUnsub(chatId, username, msgId, pending);
  }
}