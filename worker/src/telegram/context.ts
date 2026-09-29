import type { Env } from "../env";
import {
  getUser,
  getUserByTelegram,
  linkTelegram,
  unlinkTelegram,
  type WebuiUserRecord,
} from "../auth/users";
import type { ActiveUser, RefreshTokenEntry } from "../myxl/accounts";
import {
  getActiveUser,
  listAccounts,
  setActiveUser,
} from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import { USER_ACTIVE_NUMBER } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import type { TelegramApi } from "./api";
import { TelegramStateStore } from "./state";
import type { ChatStateData, InlineKeyboard, PendingConfirm } from "./types";
import {
  cardAgeFromDob,
  chunkLines,
  esc,
  formatDateDmY,
  formatDateIso,
  formatHistoryLines,
  formatPaketBlock,
  formatRpLabel,
  tgErr,
} from "./formatters";
import { HELP_TEXT, kbBackMenu, mainMenuKeyboard } from "./keyboards";
import { formatRp } from "../ssr/filters";

export class BotContext {
  readonly stateStore: TelegramStateStore;
  private readonly accountsCache = new Map<string, RefreshTokenEntry[]>();

  constructor(
    readonly env: Env,
    readonly storage: StorageBackend,
    readonly api: TelegramApi,
  ) {
    this.stateStore = new TelegramStateStore(env);
  }

  async linkedUser(chatId: number): Promise<WebuiUserRecord | null> {
    return getUserByTelegram(this.storage, chatId);
  }

  async requireLinked(chatId: number): Promise<WebuiUserRecord | null> {
    const user = await this.linkedUser(chatId);
    if (!user) {
      await this.api.sendMessage(
        chatId,
        "Akun belum di-link. Generate kode di WebUI lalu kirim:\n<code>/link KODE</code>",
      );
    }
    return user;
  }

  async listAccountMeta(username: string): Promise<RefreshTokenEntry[]> {
    const cached = this.accountsCache.get(username);
    if (cached) return cached;
    const accounts = await listAccounts(this.storage, username);
    this.accountsCache.set(username, accounts);
    return accounts;
  }

  async loadActiveMsisdn(chatId: number, username: string): Promise<number | null> {
    const raw = await getTextBlob(this.storage, username, USER_ACTIVE_NUMBER);
    if (raw?.trim() && /^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10);
    return null;
  }

  async getState(chatId: number): Promise<ChatStateData> {
    return this.stateStore.loadState(chatId);
  }

  async saveState(chatId: number, state: ChatStateData, username?: string | null): Promise<void> {
    await this.stateStore.saveState(chatId, state, username);
  }

  async clearState(chatId: number, username?: string | null): Promise<void> {
    const prev = await this.getState(chatId);
    const active = prev.active_msisdn ?? prev.account_msisdn ?? null;
    await this.saveState(
      chatId,
      {
        step: null,
        active_msisdn: active,
        account_msisdn: active,
        pkg_map: {},
        unsub_map: {},
        dcy_map: {},
        bm_map: {},
        linked_username: username ?? prev.linked_username,
      },
      username ?? (typeof prev.linked_username === "string" ? prev.linked_username : null),
    );
  }

  async getActiveMsisdn(chatId: number, username: string): Promise<number | null> {
    const state = await this.getState(chatId);
    const fromState = state.active_msisdn ?? state.account_msisdn;
    if (fromState) return Number(fromState);

    const loaded = await this.loadActiveMsisdn(chatId, username);
    if (loaded) {
      state.active_msisdn = loaded;
      state.account_msisdn = loaded;
      await this.saveState(chatId, state, username);
      return loaded;
    }

    const accounts = await this.listAccountMeta(username);
    if (accounts.length === 1) {
      await this.saveActiveMsisdn(chatId, username, accounts[0].number);
      return accounts[0].number;
    }
    return null;
  }

  async saveActiveMsisdn(chatId: number, username: string, msisdn: number): Promise<boolean> {
    const accounts = await this.listAccountMeta(username);
    if (!accounts.some((a) => a.number === msisdn)) return false;

    const clients = createMyXlClients(this.env, this.storage, username);
    const ok = await setActiveUser(this.storage, username, msisdn, clients);
    if (!ok) return false;

    const state = await this.getState(chatId);
    state.active_msisdn = msisdn;
    state.account_msisdn = msisdn;
    await this.saveState(chatId, state, username);
    return true;
  }

  async getActiveAccount(chatId: number, username: string): Promise<ActiveUser | null> {
    const clients = createMyXlClients(this.env, this.storage, username);
    return getActiveUser(this.storage, username, clients);
  }

  async requireActiveAccount(
    chatId: number,
    username: string,
    msgId?: number | null,
  ): Promise<ActiveUser | null> {
    const msisdn = await this.getActiveMsisdn(chatId, username);
    if (msisdn) {
      const clients = createMyXlClients(this.env, this.storage, username);
      const active = await getActiveUser(this.storage, username, clients);
      if (active) return active;
    }

    const accounts = await this.listAccountMeta(username);
    if (!accounts.length) {
      await this.reply(chatId, msgId ?? null, "Tidak ada nomor MyXL terdaftar.");
      return null;
    }
    await this.sendNumberMenu(chatId, username, msgId ?? null, "Pilih nomor aktif dulu:");
    return null;
  }

  async reply(chatId: number, msgId: number | null, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
    if (msgId) await this.api.editMessage(chatId, msgId, text, replyMarkup);
    else await this.api.sendMessage(chatId, text, replyMarkup);
  }

  async buildMainMenuText(chatId: number, username: string): Promise<string> {
    const [active, accs] = await Promise.all([
      this.getActiveMsisdn(chatId, username),
      this.listAccountMeta(username),
    ]);
    if (active) {
      const meta = accs.find((a) => a.number === active);
      const st = meta ? esc(meta.subscription_type) : "";
      return (
        `<b>Menu utama</b>\n📱 Nomor aktif: <code>${active}</code>` +
        (st ? ` (${st})` : "") +
        "\n\nPilih menu:"
      );
    }
    if (accs.length > 1) {
      return "<b>Menu utama</b>\n⚠️ Belum ada nomor aktif — tap <b>📱 Nomor</b> untuk memilih.\n\nPilih menu:";
    }
    return "<b>Menu utama</b>\n\nPilih menu:";
  }

  async sendMainMenu(chatId: number, username: string, msgId: number | null = null): Promise<void> {
    this.api.sendChatAction(chatId);
    const text = await this.buildMainMenuText(chatId, username);
    await this.reply(chatId, msgId, text, mainMenuKeyboard());
  }

  async finishAction(chatId: number, username: string, msgId: number | null, result: string): Promise<void> {
    const menu = await this.buildMainMenuText(chatId, username);
    await this.reply(chatId, msgId, `${result}\n\n${menu}`, mainMenuKeyboard());
  }

  async sendNumberMenu(
    chatId: number,
    username: string,
    msgId: number | null,
    hint?: string,
  ): Promise<void> {
    const accounts = await this.listAccountMeta(username);
    if (!accounts.length) {
      await this.reply(chatId, msgId, "Tidak ada nomor MyXL terdaftar.");
      return;
    }
    const active = await this.getActiveMsisdn(chatId, username);
    const lines = [hint ?? "<b>📱 Pilih nomor aktif</b>", ""];
    if (active) lines.push(`Sekarang: <code>${active}</code>\n`);

    const kbRows = accounts.map((acc) => [{
      text: `📱 ${acc.number} (${acc.subscription_type || "?"})${acc.number === active ? " ✓" : ""}`,
      callback_data: `nomor:set:${acc.number}`,
    }]);
    kbRows.push([{ text: "« Menu utama", callback_data: "menu:home" }]);
    await this.reply(chatId, msgId, lines.join("\n"), { inline_keyboard: kbRows });
  }

  async executeKuota(chatId: number, username: string, msgId: number | null, active: ActiveUser): Promise<void> {
    this.api.sendChatAction(chatId);
    const clients = createMyXlClients(this.env, this.storage, username);
    const lines: string[] = ["<b>Info Pelanggan</b>"];

    try {
      const profileData = (await clients.engsel.getProfile(active.tokens.access_token, active.tokens.id_token)) ?? {};
      const prof = (profileData.profile as Record<string, unknown>) ?? {};
      lines.push(`Umur Kartu : ${cardAgeFromDob(String(prof.dob ?? ""))}`);

      const balWrap = await clients.engsel.sendApiRequest(
        "api/v8/packages/balance-and-credit",
        { is_enterprise: false, lang: "en" },
        active.tokens.id_token,
      );
      const balData =
        balWrap && typeof balWrap === "object" ? ((balWrap as Record<string, unknown>).data as Record<string, unknown>) ?? {} : {};
      const balance = (balData.balance as Record<string, unknown>) ?? {};

      const graceEnd = balData.grace_end_date;
      lines.push(`Aktif Hingga : ${formatDateIso(graceEnd ?? balance.expired_at)}`);

      const subStatus = String(balData.subscription_status ?? balData.suspended_status ?? "ACTIVE");
      lines.push(`Status Simcard : ${esc(subStatus)}`);

      try {
        const chk = await clients.famplan.validateMsisdn(active.tokens.id_token, String(active.number));
        const registered =
          chk && typeof chk === "object"
            ? ((chk as Record<string, unknown>).data as Record<string, unknown> | undefined)?.is_registered
            : undefined;
        lines.push(
          `Status Dukcapil : ${registered === true ? "Registered" : registered === false ? "Unregistered" : "-"}`,
        );
      } catch {
        lines.push("Status Dukcapil : -");
      }

      lines.push(`Masa Aktif Kartu : ${formatDateDmY(balance.expired_at)}`);
      if (balance.remaining != null) lines.push(`Pulsa : ${formatRp(balance.remaining)}`);

      if (active.subscription_type === "PREPAID") {
        const tier = await clients.engsel.getTieringInfo(active.tokens.id_token);
        if (tier) {
          lines.push(`Points : ${tier.current_point ?? 0} · Tier : ${tier.tier ?? 0}`);
        }
      }

      lines.push("");
      lines.push("<b>Info Paket Aktif</b>");

      const res = await clients.engsel.getQuotaDetailsRaw(active.tokens.id_token);
      if (!res || (res.status !== "SUCCESS" && String(res.code) !== "000")) {
        lines.push("Gagal mengambil daftar paket.");
      } else {
        const quotas = ((res.data as Record<string, unknown> | undefined)?.quotas as Record<string, unknown>[]) ?? [];
        if (!quotas.length) lines.push("Tidak ada paket aktif.");
        for (const q of quotas) lines.push(...formatPaketBlock(q), "");
      }

      const chunks = chunkLines(lines.filter((l, i, arr) => !(l === "" && i === arr.length - 1)));
      if (chunks.length === 1) {
        const menu = await this.buildMainMenuText(chatId, username);
        await this.reply(chatId, msgId, `${chunks[0]}\n\n${menu}`, mainMenuKeyboard());
        return;
      }
      await this.reply(chatId, msgId, chunks[0]);
      for (const part of chunks.slice(1, -1)) await this.api.sendMessage(chatId, part);
      const menu = await this.buildMainMenuText(chatId, username);
      await this.api.sendMessage(chatId, `${chunks.at(-1)}\n\n${menu}`, mainMenuKeyboard());
    } catch (e) {
      await this.finishAction(chatId, username, msgId, tgErr(e));
    }
  }

  async showHistory(chatId: number, username: string, msgId: number | null, active: ActiveUser): Promise<void> {
    this.api.sendChatAction(chatId);
    const clients = createMyXlClients(this.env, this.storage, username);
    try {
      const raw = await clients.engsel.getTransactionHistory(active.tokens.id_token);
      const list = Array.isArray((raw?.data as Record<string, unknown> | undefined)?.list)
        ? ((raw!.data as Record<string, unknown>).list as Record<string, unknown>[])
        : Array.isArray(raw?.list)
          ? (raw!.list as Record<string, unknown>[])
          : [];
      const text = formatHistoryLines(active.number, list);
      await this.finishAction(chatId, username, msgId, text);
    } catch (e) {
      await this.finishAction(chatId, username, msgId, tgErr(e));
    }
  }

  async fetchActiveQuotas(username: string, active: ActiveUser): Promise<Record<string, unknown>[]> {
    const clients = createMyXlClients(this.env, this.storage, username);
    const res = await clients.engsel.getQuotaDetailsRaw(active.tokens.id_token);
    if (!res || (res.status !== "SUCCESS" && String(res.code) !== "000")) return [];
    return ((res.data as Record<string, unknown> | undefined)?.quotas as Record<string, unknown>[]) ?? [];
  }

  async showUnsubMenu(chatId: number, username: string, msgId: number | null): Promise<void> {
    const active = await this.requireActiveAccount(chatId, username, msgId);
    if (!active) return;

    this.api.sendChatAction(chatId);
    await this.reply(chatId, msgId, "Mengambil paket aktif...");
    try {
      const quotas = await this.fetchActiveQuotas(username, active);
      if (!quotas.length) {
        await this.finishAction(
          chatId,
          username,
          msgId,
          `<b>🗑️ Unsubscribe</b>\n📱 <code>${active.number}</code>\n\nTidak ada paket aktif.`,
        );
        return;
      }

      const state = await this.getState(chatId);
      const unsubMap: Record<string, string> = {};
      const buttons = quotas.slice(0, 12).map((q, i) => {
        const name = String(q.name ?? "Paket").trim();
        const exp = formatDateDmY(q.expired_at);
        let label = exp !== "-" ? `${name} · exp ${exp}` : name;
        if (label.length > 60) label = `${label.slice(0, 57)}…`;
        unsubMap[String(i)] = JSON.stringify({
          quota_code: q.quota_code ?? "",
          quota_name: name,
          product_domain: q.product_domain ?? "",
          product_subscription_type: q.product_subscription_type ?? "",
        });
        return [{ text: label, callback_data: `unsub:pick:${i}` }];
      });
      state.unsub_map = unsubMap;
      await this.saveState(chatId, state, username);
      buttons.push([{ text: "« Menu utama", callback_data: "menu:home" }]);
      await this.reply(
        chatId,
        msgId,
        `<b>🗑️ Unsubscribe Paket</b>\n📱 <code>${active.number}</code>\n\nPilih paket aktif yang ingin di-stop:`,
        { inline_keyboard: buttons },
      );
    } catch (e) {
      await this.finishAction(chatId, username, msgId, tgErr(e));
    }
  }

  async savePending(chatId: number, pending: PendingConfirm): Promise<void> {
    await this.stateStore.savePending(chatId, pending);
  }

  async popPending(chatId: number): Promise<PendingConfirm | null> {
    const p = await this.stateStore.loadPending(chatId);
    if (p) await this.stateStore.clearPending(chatId);
    return p;
  }

  async executeUnsub(chatId: number, username: string, msgId: number | null, pending: PendingConfirm): Promise<void> {
    const account = pending.account as ActiveUser;
    const clients = createMyXlClients(this.env, this.storage, username);
    try {
      const ok = await clients.engsel.unsubscribePackage(
        account.tokens.id_token,
        String(pending.quota_code ?? ""),
        String(pending.product_domain ?? ""),
        String(pending.product_subscription_type ?? ""),
      );
      const msg = ok
        ? `✅ Berhasil unsubscribe <b>${esc(pending.quota_name)}</b>!`
        : `❌ Gagal unsubscribe ${esc(pending.quota_name)}`;
      await this.finishAction(chatId, username, msgId, msg);
    } catch (e) {
      await this.finishAction(chatId, username, msgId, tgErr(e));
    }
  }

  async executeBeli(chatId: number, username: string, msgId: number | null, pending: PendingConfirm): Promise<void> {
    const account = pending.account as ActiveUser;
    const pkg = pending.pkg as Record<string, unknown>;
    const opt = (pkg.package_option as Record<string, unknown>) ?? {};
    const clients = createMyXlClients(this.env, this.storage, username);
    const rt = { config: clients.config, engsel: clients.engsel, tokens: account.tokens };
    const { executeBalancePurchase } = await import("../myxl/purchase-executor");
    const { buildPaymentItem } = await import("../myxl/purchase");
    const item = buildPaymentItem(pkg);
    const pf = String(((pkg.package_family as Record<string, unknown> | undefined)?.payment_for as string) ?? "BUY_PACKAGE");

    try {
      const res = await executeBalancePurchase(rt, [item], pf, item.item_price);
      const result = res.result as Record<string, unknown> | null;
      const msg =
        result?.status === "SUCCESS"
          ? `✅ Berhasil beli <b>${esc(opt.name)}</b>!`
          : `❌ Gagal: ${esc((result?.message as string) ?? "Unknown error")}`;
      await this.finishAction(chatId, username, msgId, msg);
    } catch (e) {
      await this.finishAction(chatId, username, msgId, tgErr(e));
    }
  }

  // ── Commands ──

  async cmdStart(chatId: number, args: string[] = []): Promise<void> {
    if (args[0]) {
      await this.cmdLinkWithCode(chatId, args[0]);
      return;
    }
    const user = await this.linkedUser(chatId);
    if (user) {
      await this.sendMainMenu(chatId, user.username);
      return;
    }
    await this.api.sendMessage(
      chatId,
      "<b>me-cli Telegram Bot</b>\n\nBot ini terhubung dengan me-cli WebUI (MyXL).\n\n" +
        "Langkah pertama: buka WebUI → Monitoring → Telegram Settings → <b>Generate kode link</b>, lalu kirim:\n" +
        "<code>/link KODE</code>\n\n" +
        "Setelah login, ketik /menu atau kirim pesan apa saja untuk membuka menu.",
    );
  }

  async cmdHelp(chatId: number): Promise<void> {
    await this.api.sendMessage(chatId, HELP_TEXT);
  }

  async cmdLink(chatId: number, args: string[]): Promise<void> {
    if (!args[0]) {
      await this.api.sendMessage(
        chatId,
        "Usage: <code>/link KODE</code>\n\nGenerate kode di WebUI → Monitoring → Telegram Settings.",
      );
      return;
    }
    await this.cmdLinkWithCode(chatId, args[0]);
  }

  async cmdLinkWithCode(chatId: number, code: string): Promise<void> {
    const username = await this.storage.consumeTelegramLinkCode(code);
    if (!username) {
      await this.api.sendMessage(chatId, "Kode tidak valid atau sudah expired. Generate kode baru di WebUI.");
      return;
    }

    const user = await getUser(this.storage, username);
    if (!user) {
      await this.api.sendMessage(chatId, "Akun WebUI tidak ditemukan.");
      return;
    }

    const existing = await this.linkedUser(chatId);
    if (existing && existing.username !== user.username) {
      await unlinkTelegram(this.storage, existing.username);
    }
    await linkTelegram(this.storage, user.username, chatId);

    const accounts = await this.listAccountMeta(user.username);
    if (accounts.length === 1) {
      await this.saveActiveMsisdn(chatId, user.username, accounts[0].number);
      await this.api.sendMessage(
        chatId,
        `Berhasil link ke akun <b>${esc(user.username)}</b>!\nNomor aktif: <code>${accounts[0].number}</code>`,
      );
      await this.sendMainMenu(chatId, user.username);
    } else if (accounts.length > 1) {
      await this.api.sendMessage(
        chatId,
        `Berhasil link ke akun <b>${esc(user.username)}</b>!\nAda ${accounts.length} nomor — pilih nomor aktif di menu 📱 Nomor.`,
      );
      await this.sendNumberMenu(chatId, user.username, null);
    } else {
      await this.api.sendMessage(chatId, `Berhasil link ke <b>${esc(user.username)}</b>! Belum ada nomor MyXL di akun ini.`);
    }
  }

  async cmdUnlink(chatId: number): Promise<void> {
    const user = await this.linkedUser(chatId);
    if (!user) {
      await this.api.sendMessage(chatId, "Tidak ada akun yang di-link.");
      return;
    }
    await unlinkTelegram(this.storage, user.username);
    await this.stateStore.clearFlow(chatId, false);
    await this.api.sendMessage(chatId, `Akun <b>${esc(user.username)}</b> berhasil di-unlink.`);
  }

  async cmdKuota(chatId: number): Promise<void> {
    const user = await this.requireLinked(chatId);
    if (!user) return;
    const active = await this.requireActiveAccount(chatId, user.username);
    if (!active) return;
    await this.api.sendMessage(chatId, "Mengambil data...");
    await this.executeKuota(chatId, user.username, null, active);
  }

  async cmdBeli(chatId: number, args: string[]): Promise<void> {
    const user = await this.requireLinked(chatId);
    if (!user) return;
    if (!args[0]) {
      await this.api.sendMessage(chatId, "Usage: <code>/beli OPTION_CODE</code>");
      return;
    }
    const active = await this.requireActiveAccount(chatId, user.username);
    if (!active) return;

    const clients = createMyXlClients(this.env, this.storage, user.username);
    const optionCode = args[0];
    await this.api.sendMessage(chatId, `Mengambil detail paket <code>${esc(optionCode)}</code>...`);

    try {
      const pkg = await clients.engsel.getPackage(active.tokens.id_token, optionCode);
      if (!pkg) {
        await this.api.sendMessage(chatId, `Paket <code>${esc(optionCode)}</code> tidak ditemukan.`);
        return;
      }
      const opt = (pkg.package_option as Record<string, unknown>) ?? {};
      const priceStr = formatRpLabel(opt.price);

      await this.savePending(chatId, {
        action: "beli",
        option_code: optionCode,
        pkg,
        account: active as unknown as Record<string, unknown>,
        expires: Math.floor(Date.now() / 1000) + 120,
      });

      await this.api.sendMessage(
        chatId,
        `<b>Konfirmasi Pembelian</b>\n\n📦 ${esc(opt.name)}\n💰 ${priceStr}\n📱 ${active.number}\n💳 Metode: Pulsa (Balance)`,
        kbBackMenu([
          [
            { text: "✅ Ya, Beli", callback_data: "confirm:beli" },
            { text: "❌ Batal", callback_data: "cancel" },
          ],
        ]),
      );
    } catch (e) {
      await this.api.sendMessage(chatId, tgErr(e));
    }
  }

  async cmdHistory(chatId: number): Promise<void> {
    const user = await this.requireLinked(chatId);
    if (!user) return;
    const active = await this.requireActiveAccount(chatId, user.username);
    if (!active) return;
    await this.showHistory(chatId, user.username, null, active);
  }

  async cmdMenu(chatId: number): Promise<void> {
    const user = await this.requireLinked(chatId);
    if (!user) return;
    await this.sendMainMenu(chatId, user.username);
  }

  async cmdNomor(chatId: number): Promise<void> {
    const user = await this.requireLinked(chatId);
    if (!user) return;
    await this.sendNumberMenu(chatId, user.username, null);
  }

  async handleTextConfirm(chatId: number, text: string): Promise<boolean> {
    const pending = await this.stateStore.loadPending(chatId);
    if (!pending) return false;
    await this.stateStore.clearPending(chatId);

    if (pending.expires < Math.floor(Date.now() / 1000)) {
      const user = await this.linkedUser(chatId);
      if (user) await this.sendMainMenu(chatId, user.username);
      return true;
    }

    const answer = text.toLowerCase().trim();
    if (!["ya", "y", "yes", "ok"].includes(answer)) {
      const user = await this.linkedUser(chatId);
      if (user) {
        await this.api.sendMessage(chatId, "Dibatalkan.");
        await this.sendMainMenu(chatId, user.username);
      }
      return true;
    }

    const user = await this.linkedUser(chatId);
    if (!user) return true;
    if (pending.action === "beli") await this.executeBeli(chatId, user.username, null, pending);
    else if (pending.action === "unsub") await this.executeUnsub(chatId, user.username, null, pending);
    return true;
  }
}