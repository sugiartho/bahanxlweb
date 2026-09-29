import type { Env } from "../env";
import { wibTodayAtUnix } from "../clients/time";
import { getUser } from "../auth/users";
import { getAccountForMsisdn, listAccounts } from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import { GLOBAL_MONITOR_DAILY_SUMMARY } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import { logLine } from "./log";
import { updateAccountCache } from "./quota-cache";
import { resolveSendConfig, sendTelegram } from "./telegram-send";
import type { TelegramConfig } from "../telegram/config";
import {
  cardAgeFromDob,
  chunkLines,
  esc,
  formatDateDmY,
  formatDateIso,
  formatPaketBlock,
} from "../telegram/formatters";
import { formatRp } from "../ssr/filters";

type SummaryState = Record<string, number>;

async function loadSummaryState(storage: StorageBackend): Promise<SummaryState> {
  const raw = await getTextBlob(storage, null, GLOBAL_MONITOR_DAILY_SUMMARY);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as SummaryState;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function saveSummaryState(storage: StorageBackend, state: SummaryState): Promise<void> {
  await storage.putBlob(null, GLOBAL_MONITOR_DAILY_SUMMARY, JSON.stringify(state));
}

function todayTargetTs(cfg: TelegramConfig, now = new Date()): number {
  return wibTodayAtUnix(cfg.daily_summary_hour, cfg.daily_summary_minute, now);
}

export async function maybeSendDailySummary(
  env: Env,
  storage: StorageBackend,
  username: string,
  tgCfg: TelegramConfig,
): Promise<void> {
  if (!tgCfg.daily_summary_enabled || !tgCfg.bot_token) return;

  const user = await getUser(storage, username);
  if (!user?.telegram_chat_id) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const targetTs = todayTargetTs(tgCfg);
  if (nowSec < targetTs) return;

  const state = await loadSummaryState(storage);
  const last = state[username] ?? 0;
  if (last >= targetTs) return;

  const cfg = await resolveSendConfig(env, storage, username);
  const sendCfg = { bot_token: cfg.bot_token, chat_id: String(user.telegram_chat_id) };

  let clients;
  try {
    clients = createMyXlClients(env, storage, username);
  } catch (e) {
    await logLine(storage, username, `[daily-summary] client init err: ${e}`);
    return;
  }

  const accounts = await listAccounts(storage, username);
  if (!accounts.length) {
    await logLine(storage, username, `[daily-summary] no accounts for ${username}`);
    return;
  }

  let sentCount = 0;
  for (const acc of accounts) {
    const msisdn = acc.number;
    if (!msisdn) continue;

    try {
      const active = await getAccountForMsisdn(storage, username, msisdn, clients);
      if (!active) {
        await logLine(storage, username, `[daily-summary] cannot activate ${msisdn}`);
        continue;
      }

      const lines: string[] = ["<b>Info Pelanggan</b>"];

      // Profile
      try {
        const profileData = (await clients.engsel.getProfile(active.tokens.access_token, active.tokens.id_token)) ?? {};
        const prof = (profileData.profile as Record<string, unknown>) ?? {};
        lines.push(`Umur Kartu : ${cardAgeFromDob(String(prof.dob ?? ""))}`);
      } catch {
        lines.push("Umur Kartu : -");
      }

      // Balance & credit
      let balance: Record<string, unknown> = {};
      let balData: Record<string, unknown> = {};
      try {
        const balWrap = await clients.engsel.sendApiRequest(
          "api/v8/packages/balance-and-credit",
          { is_enterprise: false, lang: "en" },
          active.tokens.id_token,
        );
        balData =
          balWrap && typeof balWrap === "object"
            ? ((balWrap as Record<string, unknown>).data as Record<string, unknown>) ?? {}
            : {};
        balance = (balData.balance as Record<string, unknown>) ?? {};
      } catch {
        // proceed with empty
      }

      const graceEnd = balData.grace_end_date;
      lines.push(`Aktif Hingga : ${formatDateIso(graceEnd ?? balance.expired_at)}`);

      const subStatus = String(balData.subscription_status ?? balData.suspended_status ?? "ACTIVE");
      lines.push(`Status Simcard : ${esc(subStatus)}`);

      // Dukcapil
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

      // Points (PREPAID)
      if (active.subscription_type === "PREPAID") {
        try {
          const tier = await clients.engsel.getTieringInfo(active.tokens.id_token);
          if (tier) {
            lines.push(`Points : ${tier.current_point ?? 0} · Tier : ${tier.tier ?? 0}`);
          }
        } catch {
          // skip
        }
      }

      lines.push("");
      lines.push("<b>Info Paket Aktif</b>");

      // Quota details + update cache
      let quotas: Record<string, unknown>[] = [];
      try {
        const res = await clients.engsel.getQuotaDetailsRaw(active.tokens.id_token);
        if (res && (res.status === "SUCCESS" || String(res.code) === "000")) {
          quotas = ((res.data as Record<string, unknown> | undefined)?.quotas as Record<string, unknown>[]) ?? [];
        }
      } catch {
        // skip
      }

      if (!quotas.length) {
        lines.push("Tidak ada paket aktif.");
      } else {
        for (const q of quotas) lines.push(...formatPaketBlock(q), "");
      }

      // Update cache so WebUI also shows fresh data
      await updateAccountCache(storage, username, msisdn, balance, quotas);

      // Send as separate message(s) per account
      const chunks = chunkLines(lines.filter((l, i, arr) => !(l === "" && i === arr.length - 1)));
      for (const chunk of chunks) {
        await sendTelegram(env, storage, chunk, { cfg: sendCfg });
      }

      sentCount++;
      await logLine(storage, username, `[daily-summary] sent report for ${msisdn}`);
    } catch (e) {
      await logLine(storage, username, `[daily-summary] fetch ${msisdn} err: ${e}`);
    }
  }

  if (sentCount > 0) {
    state[username] = nowSec;
    await saveSummaryState(storage, state);
    await logLine(storage, username, `[daily-summary] ${sentCount} report(s) sent to ${user.telegram_chat_id}`);
  }
}
