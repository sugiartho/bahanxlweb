import { EWALLET_FORM_METHODS } from "../clients/purchase/types";
import { getBookmarks, resolveBookmarkOptionCode, type BookmarkEntry } from "../myxl/bookmark";
import { createMyXlClients } from "../myxl/clients";
import { buildPaymentItem } from "../myxl/purchase";
import {
  executeBalancePurchase,
  executeDecoyPurchase,
  executeEwalletPurchase,
  executeQrisPurchase,
} from "../myxl/purchase-executor";
import { SHARED_HOT2 } from "../storage/keys";
import { getTextBlob } from "../myxl/blob";
import type { BotContext } from "./context";
import { listDefaultDecoyChoices } from "./decoy-choices";
import { esc, formatRpLabel, tgErr } from "./formatters";
import { kbBackMenu } from "./keyboards";

async function readHot2(storage: BotContext["storage"]): Promise<Record<string, unknown>[]> {
  const raw = await getTextBlob(storage, null, SHARED_HOT2);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

export async function startPurchaseFlow(ctx: BotContext, chatId: number, username: string, msgId: number): Promise<void> {
  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const state = await ctx.getState(chatId);
  state.step = "purchase_category";
  state.account_msisdn = active.number;
  state.active_msisdn = active.number;
  await ctx.saveState(chatId, state, username);

  const kb = kbBackMenu([
    [{ text: "🔥🔥 Hot-2", callback_data: "purchase:cat:hot" }],
    [{ text: "👨‍👩‍👧 By Family Code", callback_data: "purchase:cat:family" }],
    [{ text: "🎯 By Option Code", callback_data: "purchase:cat:option" }],
    [{ text: "🔖 Bookmark", callback_data: "purchase:cat:bookmark" }],
    [{ text: "❌ Batal", callback_data: "purchase:cancel" }],
  ]);
  await ctx.reply(chatId, msgId, `Pilih kategori pembelian\n📱 <code>${active.number}</code>:`, kb);
}

export async function handlePurchaseCallback(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  const sub = parts[1] ?? "";
  const state = await ctx.getState(chatId);

  if (sub === "start") {
    await startPurchaseFlow(ctx, chatId, username, msgId);
    return;
  }
  if (sub === "cancel") {
    await ctx.clearState(chatId, username);
    await ctx.api.sendMessage(chatId, "Dibatalkan.");
    await ctx.sendMainMenu(chatId, username, msgId);
    return;
  }
  if (sub === "cat") {
    await handlePurchaseCategory(ctx, chatId, username, msgId, parts[2] ?? "");
    return;
  }
  if (sub === "pkg") {
    const raw = parts[2] ?? "";
    const optionCode = (state.pkg_map ?? {})[raw] ?? raw;
    await handlePackageSelected(ctx, chatId, username, msgId, optionCode);
    return;
  }
  if (sub === "pm") {
    await handlePaymentMode(ctx, chatId, username, msgId, parts[2] ?? "");
    return;
  }
  if (sub === "pay") {
    const method = parts[2] ?? "";
    if (state.pending_hot && ["ewallet_dana", "ewallet_ovo"].includes(method)) {
      state.pending_hot_method = method;
      state.step = "await_wallet_number";
      await ctx.saveState(chatId, state, username);
      const label = method === "ewallet_dana" ? "DANA" : "OVO";
      await ctx.reply(chatId, msgId, `Masukkan nomor <b>${label}</b> (contoh: <code>08123456789</code>):`);
      return;
    }
    await handlePaymentMethod(ctx, chatId, username, msgId, method);
    return;
  }
  if (sub === "dcy") {
    await handleDecoyPayment(ctx, chatId, username, msgId, Number.parseInt(parts[2] ?? "-1", 10));
    return;
  }
  if (sub === "hot") {
    await handleHotSelected(ctx, chatId, username, msgId, Number.parseInt(parts[2] ?? "-1", 10));
    return;
  }
  if (sub === "bm") {
    await handleBookmarkSelected(ctx, chatId, username, msgId, Number.parseInt(parts[2] ?? "-1", 10));
    return;
  }
  await ctx.finishAction(chatId, username, msgId, `Unknown purchase action: ${esc(data)}`);
}

async function handlePurchaseCategory(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  category: string,
): Promise<void> {
  const state = await ctx.getState(chatId);
  const msisdn = await ctx.getActiveMsisdn(chatId, username);
  if (!msisdn) {
    await ctx.requireActiveAccount(chatId, username, msgId);
    return;
  }
  state.account_msisdn = msisdn;
  await ctx.saveState(chatId, state, username);

  if (category === "hot") await showHotDeals(ctx, chatId, username, msgId);
  else if (category === "family") {
    state.step = "await_family_code";
    await ctx.saveState(chatId, state, username);
    await ctx.reply(chatId, msgId, "Kirim <b>Family Code</b> yang mau dicari:");
  } else if (category === "option") {
    state.step = "await_option_code";
    await ctx.saveState(chatId, state, username);
    await ctx.reply(chatId, msgId, "Kirim <b>Option Code</b>:");
  } else if (category === "bookmark") await showBookmarks(ctx, chatId, username, msgId);
}

export async function handleFamilyCodeInput(
  ctx: BotContext,
  chatId: number,
  username: string,
  familyCode: string,
): Promise<void> {
  const msisdn = await ctx.getActiveMsisdn(chatId, username);
  if (!msisdn) {
    await ctx.api.sendMessage(chatId, "Belum ada nomor aktif. Gunakan /nomor.");
    return;
  }
  const active = await ctx.requireActiveAccount(chatId, username);
  if (!active) return;

  await ctx.api.sendMessage(chatId, `Mencari paket untuk family <code>${esc(familyCode)}</code>...`);
  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const family = await clients.engsel.getFamily(active.tokens.id_token, familyCode);
  if (!family) {
    await ctx.api.sendMessage(chatId, `Family code <code>${esc(familyCode)}</code> tidak ditemukan.`);
    await ctx.clearState(chatId, username);
    return;
  }

  const state = await ctx.getState(chatId);
  const pkgMap: Record<string, string> = {};
  const buttons: { text: string; callback_data: string }[][] = [];
  let count = 0;
  for (const v of (family.package_variants as Record<string, unknown>[]) ?? []) {
    for (const opt of (v.package_options as Record<string, unknown>[]) ?? []) {
      if (count >= 8) break;
      const name = String(opt.name ?? "-");
      const code = String(opt.package_option_code ?? "");
      const price = Number(opt.price ?? 0);
      const priceStr = price >= 1000 ? `Rp${Math.floor(price / 1000)}k` : `Rp${price}`;
      const key = String(count);
      pkgMap[key] = code;
      buttons.push([{ text: `${name} (${priceStr})`, callback_data: `purchase:pkg:${key}` }]);
      count++;
    }
    if (count >= 8) break;
  }
  state.pkg_map = pkgMap;
  await ctx.saveState(chatId, state, username);

  if (!buttons.length) {
    await ctx.api.sendMessage(chatId, "Tidak ada paket di family ini.");
    await ctx.clearState(chatId, username);
    return;
  }
  buttons.push([{ text: "❌ Batal", callback_data: "purchase:cancel" }]);
  buttons.push([{ text: "« Menu utama", callback_data: "menu:home" }]);
  await ctx.api.sendMessage(chatId, `Pilih paket dari family <code>${esc(familyCode)}</code>:`, {
    inline_keyboard: buttons,
  });
  state.step = "select_package";
  await ctx.saveState(chatId, state, username);
}

async function handlePackageSelected(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number | null,
  optionCode: string,
): Promise<void> {
  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const pkg = await clients.engsel.getPackage(active.tokens.id_token, optionCode);
  if (!pkg) {
    await ctx.finishAction(chatId, username, msgId, "Paket tidak ditemukan.");
    return;
  }

  const opt = (pkg.package_option as Record<string, unknown>) ?? {};
  const name = esc(opt.name ?? "-");
  const priceStr = formatRpLabel(opt.price);

  const state = await ctx.getState(chatId);
  delete state.pending_hot;
  state.pending_purchase = { option_code: optionCode, pkg, msisdn: active.number };
  state.step = "select_payment_mode";
  await ctx.saveState(chatId, state, username);

  await showPaymentModeMenu(
    ctx,
    chatId,
    msgId,
    `<b>Konfirmasi Pembelian</b>\n\n📦 ${name}\n💰 ${priceStr}\n📱 ${active.number}`,
  );
}

async function showPaymentModeMenu(ctx: BotContext, chatId: number, msgId: number | null, header: string): Promise<void> {
  const kb = kbBackMenu([
    [{ text: "✅ Normal (Pulsa / QRIS)", callback_data: "purchase:pm:n" }],
    [{ text: "🎭 Decoy", callback_data: "purchase:pm:d" }],
    [{ text: "❌ Batal", callback_data: "purchase:cancel" }],
  ]);
  await ctx.reply(chatId, msgId, `${header}\n\nPilih mode pembayaran:`, kb);
}

async function handlePaymentMode(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  mode: string,
): Promise<void> {
  const state = await ctx.getState(chatId);
  if (mode === "back") {
    const pending = state.pending_purchase as Record<string, unknown> | undefined;
    if (pending?.pkg) {
      const opt = ((pending.pkg as Record<string, unknown>).package_option as Record<string, unknown>) ?? {};
      const priceStr = formatRpLabel(opt.price);
      await showPaymentModeMenu(
        ctx,
        chatId,
        msgId,
        `<b>Konfirmasi Pembelian</b>\n\n📦 ${esc(opt.name)}\n💰 ${priceStr}\n📱 ${pending.msisdn}`,
      );
      return;
    }
    await ctx.finishAction(chatId, username, msgId, "Tidak ada transaksi pending.");
    return;
  }
  if (mode === "n") {
    const kb = kbBackMenu([
      [{ text: "💳 Pulsa (Balance)", callback_data: "purchase:pay:balance" }],
      [{ text: "📱 QRIS", callback_data: "purchase:pay:qris" }],
      [{ text: "« Mode pembayaran", callback_data: "purchase:pm:back" }],
      [{ text: "❌ Batal", callback_data: "purchase:cancel" }],
    ]);
    await ctx.reply(chatId, msgId, "<b>Normal</b> — pilih metode:", kb);
    return;
  }
  if (mode === "d") {
    if (state.pending_hot && !state.pending_purchase) {
      await ctx.reply(
        chatId,
        msgId,
        "🎭 Decoy belum didukung untuk Hot Deal bundle.\nGunakan mode Normal.",
        kbBackMenu([[{ text: "« Mode pembayaran", callback_data: "purchase:pm:back" }]]),
      );
      return;
    }
    await showDecoyMenu(ctx, chatId, username, msgId);
  }
}

async function showDecoyMenu(ctx: BotContext, chatId: number, username: string, msgId: number): Promise<void> {
  const choices = await listDefaultDecoyChoices(ctx.storage, username);
  if (!choices.length) {
    await ctx.reply(
      chatId,
      msgId,
      "🎭 <b>Decoy</b>\n\nBelum ada decoy yang dikonfigurasi.\nAtur di WebUI → /settings/decoy",
      kbBackMenu([[{ text: "« Mode pembayaran", callback_data: "purchase:pm:back" }]]),
    );
    return;
  }

  const state = await ctx.getState(chatId);
  const dcyMap: Record<string, string> = {};
  const buttons = choices.slice(0, 14).map((ch, i) => {
    dcyMap[String(i)] = JSON.stringify({ method: ch.method, slot: ch.slot ?? null });
    return [{ text: ch.label.slice(0, 58), callback_data: `purchase:dcy:${i}` }];
  });
  state.dcy_map = dcyMap;
  await ctx.saveState(chatId, state, username);
  buttons.push([{ text: "« Mode pembayaran", callback_data: "purchase:pm:back" }]);
  buttons.push([{ text: "❌ Batal", callback_data: "purchase:cancel" }]);
  await ctx.reply(chatId, msgId, `🎭 <b>Decoy</b> — pilih slot:`, { inline_keyboard: buttons });
}

async function settlePackage(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  method: string,
): Promise<void> {
  const state = await ctx.getState(chatId);
  const pending = state.pending_purchase as Record<string, unknown> | undefined;
  if (!pending?.pkg) {
    await ctx.clearState(chatId, username);
    await ctx.sendMainMenu(chatId, username, msgId);
    return;
  }

  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const pkg = pending.pkg as Record<string, unknown>;
  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };
  const pf = String(((pkg.package_family as Record<string, unknown> | undefined)?.payment_for as string) ?? "BUY_PACKAGE");
  const item = buildPaymentItem(pkg);
  const opt = (pkg.package_option as Record<string, unknown>) ?? {};

  await ctx.reply(chatId, msgId, "Memproses pembelian...");
  try {
    let msg: string;
    if (method === "qris") {
      const out = await executeQrisPurchase(rt, [item], pf, item.item_price);
      const qr = out.qrisCode;
      msg = qr
        ? `✅ QRIS untuk <b>${esc(opt.name)}</b>\n<code>${esc(qr)}</code>`
        : `❌ QRIS gagal`;
    } else {
      const out = await executeBalancePurchase(rt, [item], pf, item.item_price);
      const res = out.result as Record<string, unknown> | null;
      msg = res?.status === "SUCCESS" ? `✅ Berhasil beli <b>${esc(opt.name)}</b>!` : `❌ Gagal: ${esc(String(res?.message ?? "Unknown"))}`;
    }
    await ctx.finishAction(chatId, username, msgId, msg);
  } catch (e) {
    await ctx.finishAction(chatId, username, msgId, tgErr(e));
  }
  await ctx.clearState(chatId, username);
}

async function handlePaymentMethod(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  method: string,
): Promise<void> {
  const state = await ctx.getState(chatId);
  if (state.pending_hot) {
    await executeHotPurchase(ctx, chatId, username, msgId, method, state.pending_hot as Record<string, unknown>);
    return;
  }
  await settlePackage(ctx, chatId, username, msgId, method);
}

async function handleDecoyPayment(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  idx: number,
): Promise<void> {
  const state = await ctx.getState(chatId);
  const raw = (state.dcy_map ?? {})[String(idx)];
  if (!raw) {
    await ctx.finishAction(chatId, username, msgId, "Pilihan decoy tidak valid.");
    return;
  }
  const pending = state.pending_purchase as Record<string, unknown> | undefined;
  if (!pending?.pkg) {
    await ctx.finishAction(chatId, username, msgId, "Tidak ada paket pending.");
    return;
  }

  let choice: { method?: string; slot?: string };
  try {
    choice = JSON.parse(raw) as { method?: string; slot?: string };
  } catch {
    await ctx.finishAction(chatId, username, msgId, "Data decoy rusak.");
    return;
  }

  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const pkg = pending.pkg as Record<string, unknown>;
  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };
  const pf = String(((pkg.package_family as Record<string, unknown> | undefined)?.payment_for as string) ?? "BUY_PACKAGE");
  const method = choice.method ?? "decoy_balance";

  await ctx.reply(chatId, msgId, "Memproses pembelian decoy...");
  try {
    const out = await executeDecoyPurchase(
      rt,
      ctx.storage,
      username,
      active.subscription_type,
      pkg,
      method,
      pf,
      -1,
    );
    const res = out.result as Record<string, unknown> | null;
    const qr = (res?.qr_code as string) ?? null;
    let msg: string;
    if (res?.status === "SUCCESS" || qr) {
      msg = qr ? `✅ ${esc(out.title)}\n<code>${esc(qr)}</code>` : `✅ ${esc(out.title)}`;
    } else {
      msg = `❌ ${esc(String(res?.message ?? out.title))}`;
    }
    await ctx.finishAction(chatId, username, msgId, msg);
  } catch (e) {
    await ctx.finishAction(chatId, username, msgId, tgErr(e));
  }
  await ctx.clearState(chatId, username);
}

async function showHotDeals(ctx: BotContext, chatId: number, username: string, msgId: number): Promise<void> {
  const bundles = await readHot2(ctx.storage);
  if (!bundles.length) {
    await ctx.clearState(chatId, username);
    await ctx.finishAction(chatId, username, msgId, "Belum ada data Hot-2.");
    return;
  }
  const buttons = bundles.map((bundle, i) => {
    const name = String(bundle.name ?? `Bundle ${i + 1}`).trim();
    const price = String(bundle.price ?? "").trim();
    let label = price ? `🔥 ${name} · ${price}` : `🔥 ${name}`;
    if (label.length > 60) label = `${label.slice(0, 57)}…`;
    return [{ text: label, callback_data: `purchase:hot:${i}` }];
  });
  buttons.push([{ text: "❌ Batal", callback_data: "purchase:cancel" }]);
  buttons.push([{ text: "« Menu utama", callback_data: "menu:home" }]);
  await ctx.reply(chatId, msgId, "<b>🔥🔥 Hot-2</b>\nBundle gabungan — pilih paket:", { inline_keyboard: buttons });
}

async function handleHotSelected(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  idx: number,
): Promise<void> {
  const msisdn = await ctx.getActiveMsisdn(chatId, username);
  if (!msisdn || idx < 0) {
    await ctx.finishAction(chatId, username, msgId, "Pilihan tidak valid.");
    return;
  }
  const bundles = await readHot2(ctx.storage);
  if (idx >= bundles.length) {
    await ctx.finishAction(chatId, username, msgId, "Bundle Hot-2 tidak ditemukan.");
    return;
  }
  const bundle = bundles[idx];
  if (!((bundle.packages as unknown[]) ?? []).length) {
    await ctx.finishAction(chatId, username, msgId, "Bundle ini tidak punya sub-package.");
    return;
  }

  const state = await ctx.getState(chatId);
  delete state.pending_purchase;
  delete state.pending_hot_method;
  state.pending_hot = { bundle, idx, msisdn };
  state.step = "select_hot_payment";
  await ctx.saveState(chatId, state, username);

  const name = esc(bundle.name ?? "-");
  const price = esc(bundle.price ?? "");
  const nSub = ((bundle.packages as unknown[]) ?? []).length;
  const kb = kbBackMenu([
    [{ text: "💳 Balance (Pulsa)", callback_data: "purchase:pay:balance" }],
    [{ text: "📱 QRIS", callback_data: "purchase:pay:qris" }],
    [{ text: "💚 DANA", callback_data: "purchase:pay:ewallet_dana" }],
    [{ text: "🧡 ShopeePay", callback_data: "purchase:pay:ewallet_shopeepay" }],
    [{ text: "💙 GoPay", callback_data: "purchase:pay:ewallet_gopay" }],
    [{ text: "💜 OVO", callback_data: "purchase:pay:ewallet_ovo" }],
    [{ text: "« Daftar Hot-2", callback_data: "purchase:cat:hot" }],
    [{ text: "❌ Batal", callback_data: "purchase:cancel" }],
  ]);
  await ctx.reply(
    chatId,
    msgId,
    `<b>🔥 Hot-2 Bundle</b>\n\n📦 ${name}\n💰 ${price}\n📱 <code>${msisdn}</code>\n📎 ${nSub} sub-package(s)\n\nPilih metode pembayaran:`,
    kb,
  );
}

async function executeHotPurchase(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number | null,
  method: string,
  pendingHot: Record<string, unknown>,
): Promise<void> {
  const msisdn = Number(pendingHot.msisdn);
  const bundle = (pendingHot.bundle as Record<string, unknown>) ?? {};
  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };
  const items = [];
  for (const p of (bundle.packages as Record<string, unknown>[]) ?? []) {
    const pkgDetail = await clients.engsel.getPackageDetails(
      active.tokens.id_token,
      String(p.family_code ?? ""),
      String(p.variant_code ?? ""),
      Number(p.order ?? 1),
      Boolean(p.is_enterprise),
      String(p.migration_type ?? "NONE"),
    );
    if (!pkgDetail) {
      await ctx.finishAction(chatId, username, msgId, "Gagal fetch detail paket hot deal.");
      return;
    }
    items.push(buildPaymentItem(pkgDetail));
  }

  const paymentFor = String(bundle.payment_for ?? "BUY_PACKAGE");
  let overwrite = Number(bundle.overwrite_amount ?? -1);
  const tokenIdx = Number(bundle.token_confirmation_idx ?? 0);
  const amountIdx = Number(bundle.amount_idx ?? -1);
  if (overwrite === -1) {
    const refIdx = amountIdx !== -1 ? amountIdx : items.length - 1;
    overwrite = items[refIdx]?.item_price ?? 0;
  }

  const name = esc(bundle.name ?? "Hot-2");
  const walletNumber = String(pendingHot.wallet_number ?? "");
  await ctx.reply(chatId, msgId, "Memproses hot deal...");

  try {
    let msg: string;
    if (method === "qris") {
      const out = await executeQrisPurchase(rt, items, paymentFor, overwrite, tokenIdx, amountIdx, name);
      const qr = out.qrisCode;
      msg = qr ? `✅ QRIS <b>${name}</b>\n<code>${esc(qr)}</code>` : "✅ QRIS tx dibuat, kode QR tidak tersedia.";
    } else if (method in EWALLET_FORM_METHODS) {
      if (!walletNumber) {
        await ctx.finishAction(chatId, username, msgId, "Nomor e-wallet belum diisi.");
        return;
      }
      const out = await executeEwalletPurchase(rt, items, method, walletNumber, paymentFor, overwrite, tokenIdx, amountIdx, name);
      const res = out.result as Record<string, unknown> | null;
      msg = res?.status === "SUCCESS" ? `✅ Hot-2 <b>${name}</b> berhasil!` : `❌ Gagal: ${esc(String(res?.message ?? ""))}`;
    } else {
      const out = await executeBalancePurchase(rt, items, paymentFor, overwrite, tokenIdx, amountIdx);
      const res = out.result as Record<string, unknown> | null;
      msg = res?.status === "SUCCESS" ? `✅ Hot-2 <b>${name}</b> berhasil!` : `❌ Gagal: ${esc(String(res?.message ?? ""))}`;
    }
    await ctx.finishAction(chatId, username, msgId, msg);
  } catch (e) {
    await ctx.finishAction(chatId, username, msgId, tgErr(e));
  }
  await ctx.clearState(chatId, username);
}

export async function handleWalletNumberInput(
  ctx: BotContext,
  chatId: number,
  username: string,
  walletNumber: string,
): Promise<void> {
  const trimmed = walletNumber.trim();
  if (!trimmed.startsWith("08") || !/^\d+$/.test(trimmed) || trimmed.length < 10 || trimmed.length > 13) {
    await ctx.api.sendMessage(chatId, "Nomor tidak valid. Harus dimulai <code>08</code>, 10–13 digit.");
    return;
  }
  const state = await ctx.getState(chatId);
  const method = state.pending_hot_method ?? "";
  const pendingHot = state.pending_hot as Record<string, unknown> | undefined;
  if (!pendingHot || !method) {
    await ctx.sendMainMenu(chatId, username);
    return;
  }
  pendingHot.wallet_number = trimmed;
  state.step = "select_hot_payment";
  await ctx.saveState(chatId, state, username);
  await executeHotPurchase(ctx, chatId, username, null, method, pendingHot);
}

async function showBookmarks(ctx: BotContext, chatId: number, username: string, msgId: number): Promise<void> {
  const bookmarks = await getBookmarks(ctx.storage, username);
  if (!bookmarks.length) {
    await ctx.clearState(chatId, username);
    await ctx.finishAction(chatId, username, msgId, "Bookmark kosong.");
    return;
  }
  const state = await ctx.getState(chatId);
  const bmMap: Record<string, string> = {};
  const buttons = bookmarks.slice(0, 8).map((bm, i) => {
    const label = `${bm.family_name || bm.family_code.slice(0, 8)} · ${bm.option_name}`.slice(0, 40);
    bmMap[String(i)] = JSON.stringify(bm);
    return [{ text: label, callback_data: `purchase:bm:${i}` }];
  });
  state.bm_map = bmMap;
  await ctx.saveState(chatId, state, username);
  buttons.push([{ text: "❌ Batal", callback_data: "purchase:cancel" }]);
  buttons.push([{ text: "« Menu utama", callback_data: "menu:home" }]);
  await ctx.reply(chatId, msgId, "Pilih bookmark:", { inline_keyboard: buttons });
}

async function handleBookmarkSelected(
  ctx: BotContext,
  chatId: number,
  username: string,
  msgId: number,
  idx: number,
): Promise<void> {
  const state = await ctx.getState(chatId);
  const raw = (state.bm_map ?? {})[String(idx)];
  if (!raw) {
    await ctx.finishAction(chatId, username, msgId, "Bookmark tidak valid.");
    return;
  }
  let bm: BookmarkEntry;
  try {
    bm = JSON.parse(raw) as BookmarkEntry;
  } catch {
    await ctx.finishAction(chatId, username, msgId, "Data bookmark rusak.");
    return;
  }

  const active = await ctx.requireActiveAccount(chatId, username, msgId);
  if (!active) return;

  const direct = (bm.package_option_code ?? "").trim();
  if (direct) {
    await handlePackageSelected(ctx, chatId, username, msgId, direct);
    return;
  }

  const clients = createMyXlClients(ctx.env, ctx.storage, username);
  const family = await clients.engsel.getFamily(active.tokens.id_token, bm.family_code, bm.is_enterprise);
  if (!family) {
    await ctx.finishAction(chatId, username, msgId, "Family bookmark tidak ditemukan.");
    return;
  }
  const optionCode = resolveBookmarkOptionCode(family, bm);
  if (!optionCode) {
    await ctx.finishAction(chatId, username, msgId, "Paket bookmark tidak ditemukan di API.");
    return;
  }
  await handlePackageSelected(ctx, chatId, username, msgId, optionCode);
}

export async function handleOptionCodeInput(
  ctx: BotContext,
  chatId: number,
  username: string,
  optionCode: string,
): Promise<void> {
  await handlePackageSelected(ctx, chatId, username, null, optionCode);
}