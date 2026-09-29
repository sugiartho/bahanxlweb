import { Hono } from "hono";
import { getUser } from "../auth/users";
import { getAccountForMsisdn, listAccounts } from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import { checkUserOnce } from "../monitor/checker";
import {
  DEFAULT_RULE_TELEGRAM_MESSAGE,
  extractQuotaNameOptions,
  formatCacheCards,
  formatRuleRows,
  hourOptions,
  minuteOptions,
} from "../monitor/format";
import { logLine, tailLog } from "../monitor/log";
import { loadQuotaCache, updateAccountCache } from "../monitor/quota-cache";
import { addRule, deleteRule, getRule, loadRules, updateRule } from "../monitor/rules";
import { resolveSendConfig, saveUserTelegram, sendTelegram } from "../monitor/telegram-send";
import { renderWebuiPage, requireWebuiUser } from "../myxl/require";
import { loadTelegramConfig, saveTelegramConfig } from "../telegram/config";
import {
  ensureWebhookSecret,
  getTelegramWebhookInfo,
  registerTelegramWebhook,
  webhookUrlForRequest,
} from "../telegram/webhook-setup";
import type { MatchKind, TriggerMetric, TriggerOp } from "../monitor/types";
import type { AppEnv } from "../types";

export const monitoring = new Hono<AppEnv>();

function msgFlags(msg: string) {
  return {
    msg,
    has_msg: !!msg,
    msg_refreshed: msg === "refreshed",
    msg_rule_added: msg === "rule_added",
    msg_rule_deleted: msg === "rule_deleted",
    msg_ran: msg === "ran",
    msg_saved: msg === "saved" || msg === "webhook_ok",
    msg_webhook_ok: msg === "webhook_ok",
    msg_webhook_fail: msg === "webhook_fail",
    msg_link_code: msg === "link_code",
    msg_test_ok: msg === "test_ok",
    msg_test_fail: msg === "test_fail",
    msg_no_chat_id: msg === "no_chat_id",
  };
}

async function buildTelegramPageContext(request: Request, env: AppEnv["Bindings"], storage: AppEnv["Variables"]["storage"], webuiUser: { username: string }) {
  const tgGlobal = await loadTelegramConfig(env, storage);
  const tgUser = await resolveSendConfig(env, storage, webuiUser.username);
  const user = await getUser(storage, webuiUser.username);
  const expectedWebhookUrl = webhookUrlForRequest(request.url);
  const webhookInfo = tgGlobal.bot_token ? await getTelegramWebhookInfo(tgGlobal.bot_token) : null;
  const registeredUrl = webhookInfo?.url ?? "";
  return {
    tg_global: tgGlobal,
    tg_user: tgUser,
    chat_id: user?.telegram_chat_id ?? null,
    has_chat_id: !!user?.telegram_chat_id,
    hour_options: hourOptions(tgGlobal.daily_summary_hour),
    minute_options: minuteOptions(tgGlobal.daily_summary_minute),
    expected_webhook_url: expectedWebhookUrl,
    registered_webhook_url: registeredUrl,
    webhook_ok: Boolean(registeredUrl && registeredUrl === expectedWebhookUrl),
    webhook_pending_updates: webhookInfo?.pending_update_count ?? 0,
    webhook_last_error: webhookInfo?.last_error_message ?? "",
    has_webhook_error: Boolean(webhookInfo?.last_error_message),
    has_bot_token: Boolean(tgGlobal.bot_token),
  };
}

async function syncTelegramWebhook(request: Request, env: AppEnv["Bindings"], storage: AppEnv["Variables"]["storage"]) {
  const current = await loadTelegramConfig(env, storage);
  const botToken = current.bot_token.trim();
  if (!botToken) return { ok: false, description: "Bot token belum di-set" };

  const webhookSecret = ensureWebhookSecret(current.webhook_secret, env.TELEGRAM_WEBHOOK_SECRET);
  if (webhookSecret !== current.webhook_secret) {
    await saveTelegramConfig(env, storage, { webhook_secret: webhookSecret });
  }

  const webhookUrl = webhookUrlForRequest(request.url);
  return registerTelegramWebhook(botToken, webhookUrl, webhookSecret);
}

monitoring.get("/monitoring", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const cache = await loadQuotaCache(storage, webuiUser.username);
  const rules = await loadRules(c.env, storage, webuiUser.username);
  const tgGlobal = await loadTelegramConfig(c.env, storage);
  const tgUser = await resolveSendConfig(c.env, storage, webuiUser.username);
  const accounts = await listAccounts(storage, webuiUser.username);
  const logLines = await tailLog(storage, webuiUser.username, 50);
  const quotaOptions = extractQuotaNameOptions(cache);

  return renderWebuiPage(c, webuiUser, "monitoring", {
    page_title: "Monitoring · WebUI-XL",
    ...msgFlags(c.req.query("msg") ?? ""),
    tg_global_enabled: tgGlobal.enabled && !!tgGlobal.bot_token,
    tg_user_chat_id: tgUser.chat_id,
    has_tg_chat_id: !!tgUser.chat_id,
    cache_cards: formatCacheCards(cache),
    has_cache: Object.keys(cache).length > 0,
    rules: formatRuleRows(rules),
    has_rules: rules.length > 0,
    log_lines: logLines.map((line) => ({ line })),
    has_log: logLines.length > 0,
    log_count: logLines.length,
    myxl_accounts: accounts.map((a) => ({
      number: a.number,
      subscription_type: a.subscription_type || "?",
    })),
    has_accounts: accounts.length > 0,
    quota_options: quotaOptions,
    has_quota_options: quotaOptions.length > 0,
    default_telegram_message: DEFAULT_RULE_TELEGRAM_MESSAGE,
  });
});

monitoring.post("/monitoring/refresh", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const accounts = await listAccounts(storage, webuiUser.username);

  try {
    const clients = createMyXlClients(c.env, storage, webuiUser.username);
    for (const acc of accounts) {
      const msisdn = acc.number;
      if (!msisdn) continue;
      const user = await getAccountForMsisdn(storage, webuiUser.username, msisdn, clients);
      if (!user) continue;
      try {
        const balance = await clients.engsel.getBalance(user.tokens.id_token);
        const data = await clients.engsel.getQuotaDetails(user.tokens.id_token);
        const quotas = ((data?.quotas as Record<string, unknown>[]) ?? null) as Record<string, unknown>[] | null;
        await updateAccountCache(storage, webuiUser.username, msisdn, balance, quotas);
      } catch {
        // skip failed account
      }
    }
  } catch {
    // clients not configured
  }

  return c.redirect("/monitoring?msg=refreshed", 303);
});

monitoring.get("/monitoring/telegram", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const page = await buildTelegramPageContext(c.req.raw, c.env, storage, webuiUser);

  const testInfo = String(c.req.query("test_info") ?? "").trim();
  const linkCode = String(c.req.query("link_code") ?? "").trim();
  return renderWebuiPage(c, webuiUser, "monitoring_telegram", {
    page_title: "Telegram Settings · WebUI-XL",
    ...msgFlags(c.req.query("msg") ?? ""),
    test_info: testInfo,
    has_test_info: !!testInfo,
    link_code: linkCode,
    has_link_code: !!linkCode,
    ...page,
  });
});

monitoring.post("/monitoring/telegram", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const storage = c.get("storage");
  const current = await loadTelegramConfig(c.env, storage);
  const botToken = String(body.bot_token ?? "").trim() || current.bot_token;
  const enabled = body.enabled === "on";
  const dailySummaryEnabled = body.daily_summary_enabled === "on";
  const dailySummaryHour = Number.parseInt(String(body.daily_summary_hour ?? 7), 10);
  const dailySummaryMinute = Number.parseInt(String(body.daily_summary_minute ?? 0), 10);
  const lowQuotaThreshold = Number.parseInt(String(body.low_quota_threshold_pct ?? 10), 10);
  const pollInterval = Math.max(1, Number.parseInt(String(body.poll_interval_minutes ?? 5), 10));
  const webhookSecret = ensureWebhookSecret(current.webhook_secret, c.env.TELEGRAM_WEBHOOK_SECRET);

  await saveTelegramConfig(c.env, storage, {
    bot_token: botToken,
    enabled,
    webhook_secret: webhookSecret,
    daily_summary_enabled: dailySummaryEnabled,
    daily_summary_hour: dailySummaryHour,
    daily_summary_minute: dailySummaryMinute,
    low_quota_threshold_pct: lowQuotaThreshold,
    poll_interval_minutes: pollInterval,
  });

  const user = await getUser(storage, webuiUser.username);
  await saveUserTelegram(
    storage,
    webuiUser.username,
    botToken,
    user?.telegram_chat_id ? String(user.telegram_chat_id) : "",
  );

  const webhook = botToken ? await syncTelegramWebhook(c.req.raw, c.env, storage) : { ok: false, description: "Bot token kosong" };
  const msg = webhook.ok ? "webhook_ok" : "webhook_fail";
  return c.redirect(`/monitoring/telegram?msg=${msg}`, 303);
});

monitoring.post("/monitoring/telegram/webhook", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const webhook = await syncTelegramWebhook(c.req.raw, c.env, storage);
  return c.redirect(`/monitoring/telegram?msg=${webhook.ok ? "webhook_ok" : "webhook_fail"}`, 303);
});

monitoring.post("/monitoring/telegram/link-code", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const code = await storage.createTelegramLinkCode(webuiUser.username);
  return c.redirect(`/monitoring/telegram?msg=link_code&link_code=${encodeURIComponent(code)}`, 303);
});

monitoring.post("/monitoring/telegram/test", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const storage = c.get("storage");
  const tgCfg = await loadTelegramConfig(c.env, storage);
  const user = await getUser(storage, webuiUser.username);
  if (!user?.telegram_chat_id) {
    return c.redirect("/monitoring/telegram?msg=no_chat_id", 303);
  }

  const cfg = { bot_token: tgCfg.bot_token, chat_id: String(user.telegram_chat_id) };
  const { ok, info } = await sendTelegram(
    c.env,
    storage,
    "✅ <b>Test berhasil!</b>\n\nBot Telegram WebUI-XL sudah terhubung ke akun kamu.",
    { cfg },
  );
  return c.redirect(`/monitoring/telegram?msg=${ok ? "test_ok" : "test_fail"}&test_info=${encodeURIComponent(info)}`, 303);
});

monitoring.post("/monitoring/rules", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const actionType = String(body.action_type ?? "telegram");
  const actions = [];
  const actionMessage =
    String(body.action_message ?? "").trim() || DEFAULT_RULE_TELEGRAM_MESSAGE || String(body.name ?? "");
  if (actionType === "telegram") {
    actions.push({ type: "telegram" as const, message: actionMessage });
  } else if (actionType === "buy_option") {
    actions.push({
      type: "buy_option" as const,
      option_code: String(body.action_option_code ?? ""),
      method: String(body.action_method ?? "balance"),
    });
  } else if (actionType === "unsubscribe") {
    actions.push({ type: "unsubscribe" as const });
  } else if (actionType === "telegram_and_buy") {
    actions.push({ type: "telegram" as const, message: actionMessage });
    actions.push({
      type: "buy_option" as const,
      option_code: String(body.action_option_code ?? ""),
      method: String(body.action_method ?? "balance"),
    });
  }

  await addRule(c.env, c.get("storage"), webuiUser.username, {
    name: String(body.name ?? "") || "Untitled Rule",
    msisdn: String(body.msisdn ?? "0"),
    match: {
      kind: String(body.match_kind ?? "any") as MatchKind,
      value: String(body.match_value ?? ""),
      data_type: String(body.match_data_type ?? "ANY"),
    },
    trigger: {
      metric: String(body.trigger_metric ?? "remaining_pct") as TriggerMetric,
      op: String(body.trigger_op ?? "lt") as TriggerOp,
      value: Number.parseFloat(String(body.trigger_value ?? "10")) || 10,
    },
    actions,
    cooldown_seconds: Number.parseInt(String(body.cooldown_seconds ?? 3600), 10),
  });

  return c.redirect("/monitoring?msg=rule_added", 303);
});

monitoring.post("/monitoring/rules/:ruleId/delete", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;
  await deleteRule(c.env, c.get("storage"), webuiUser.username, c.req.param("ruleId"));
  return c.redirect("/monitoring?msg=rule_deleted", 303);
});

monitoring.post("/monitoring/rules/:ruleId/toggle", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;
  const rule = await getRule(c.env, c.get("storage"), webuiUser.username, c.req.param("ruleId"));
  if (rule) {
    await updateRule(c.env, c.get("storage"), webuiUser.username, rule.id, { enabled: !rule.enabled });
  }
  return c.redirect("/monitoring", 303);
});

monitoring.post("/monitoring/run-once", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  try {
    await checkUserOnce(c.env, c.get("storage"), webuiUser.username);
  } catch (e) {
    await logLine(c.get("storage"), webuiUser.username, `[run-once] ${webuiUser.username} err: ${e}`);
  }

  return c.redirect("/monitoring?msg=ran", 303);
});