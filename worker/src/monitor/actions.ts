import type { Env } from "../env";
import type { PurchaseRuntime } from "../clients/purchase/common";
import { settlementBalanceWithRetry, settlementQris, getQrisCode } from "../clients/purchase";
import type { ActiveUser, MyXlClients } from "../myxl/accounts";
import { buildPaymentItem } from "../myxl/purchase";
import type { StorageBackend } from "../storage/types";
import { humanizeBytes } from "../ssr/filters";
import type { MonitoringRule } from "./types";
import { resolveSendConfig, sendTelegram } from "./telegram-send";

function formatBytes(n: unknown): string {
  return humanizeBytes(n);
}

export async function executeRuleActions(
  env: Env,
  storage: StorageBackend,
  rule: MonitoringRule,
  user: ActiveUser,
  quota: Record<string, unknown>,
  benefit: Record<string, unknown>,
  clients: MyXlClients,
  username: string,
): Promise<{ status: string; msg: string }> {
  const results: string[] = [];
  const tgCfg = await resolveSendConfig(env, storage, username);
  const rt: PurchaseRuntime = {
    config: clients.config,
    engsel: clients.engsel,
    tokens: user.tokens,
  };

  for (const action of rule.actions ?? []) {
    const t = action.type;
    try {
      if (t === "telegram") {
        let msg = action.message || rule.name || "rule";
        msg = msg.replace("{quota}", String(quota.name ?? "-"));
        msg = msg.replace("{benefit}", String(benefit.name ?? "-"));
        const rem = Number(benefit.remaining ?? 0);
        const tot = Number(benefit.total ?? 0);
        const pct = tot ? (rem / tot) * 100 : 0;
        msg = msg.replace("{pct}", pct.toFixed(1));
        const isData = String(benefit.data_type ?? "") === "DATA";
        msg = msg.replace("{remaining}", isData ? formatBytes(rem) : String(rem));
        msg = msg.replace("{total}", isData ? formatBytes(tot) : String(tot));
        msg = msg.replace("{msisdn}", String(user.number));
        if (!msg.includes("{nodefault}")) {
          const header =
            `⚠️ <b>Peringatan Kuota</b>\n` +
            `📱 <code>${user.number}</code> · ${user.subscription_type}\n` +
            `📦 ${quota.name ?? "-"}\n` +
            `📊 ${benefit.name ?? "-"}: <b>${pct.toFixed(1)}%</b> ` +
            `(${isData ? formatBytes(rem) : rem} / ${isData ? formatBytes(tot) : tot})\n\n`;
          msg = header + msg;
        }
        msg = msg.replace("{nodefault}", "");
        const { ok, info } = await sendTelegram(env, storage, msg, { cfg: tgCfg, username });
        results.push(`${ok ? "✅ tg: " : "⚠️ tg: "}${info}`);
      } else if (t === "buy_option") {
        const code = String(action.option_code ?? "").trim();
        const method = String(action.method ?? "balance").toLowerCase();
        if (!code) {
          results.push("⚠️ buy: option_code kosong");
          continue;
        }
        const pkg = await clients.engsel.getPackage(user.tokens.id_token, code);
        if (!pkg) {
          results.push(`⚠️ buy: paket ${code} not found`);
          continue;
        }
        const item = buildPaymentItem(pkg);
        const pf = String(
          ((pkg.package_family as Record<string, unknown> | undefined)?.payment_for as string) ?? "BUY_PACKAGE",
        );
        const opt = (pkg.package_option as Record<string, unknown>) ?? {};
        const optName = String(opt.name ?? code);
        if (method === "balance") {
          const res = await settlementBalanceWithRetry(rt, [item], {
            paymentFor: pf,
            askOverwrite: false,
            overwriteAmount: item.item_price,
          });
          const ok = typeof res === "object" && res !== null && (res as Record<string, unknown>).status === "SUCCESS";
          results.push(`${ok ? "✅ buy " : "⚠️ buy "}${optName} (pulsa)`);
        } else if (method === "qris") {
          const tx = await settlementQris(rt, [item], {
            paymentFor: pf,
            askOverwrite: false,
            overwriteAmount: item.item_price,
          });
          if (tx && typeof tx === "string") {
            const qrisCode = await getQrisCode(rt, tx);
            results.push(`✅ qris tx=${tx.slice(0, 12)}…`);
            if (qrisCode && tgCfg.bot_token) {
              await sendTelegram(
                env,
                storage,
                `💸 QRIS untuk auto-buy ${optName} (${user.number}):\n<code>${qrisCode}</code>`,
                { cfg: tgCfg },
              );
            }
          } else {
            results.push("⚠️ qris settlement gagal");
          }
        } else {
          results.push(`⚠️ buy: method ${method} belum di-handle untuk auto-action`);
        }
      } else if (t === "unsubscribe") {
        const ok = await clients.engsel.unsubscribePackage(
          user.tokens.id_token,
          String(quota.quota_code ?? ""),
          String(quota.product_domain ?? ""),
          String(quota.product_subscription_type ?? ""),
        );
        results.push(`${ok ? "✅ unsub " : "⚠️ unsub "}${quota.name ?? ""}`);
      } else {
        results.push(`⚠️ action type '${t}' unknown`);
      }
    } catch (e) {
      results.push(`❌ action ${t} exception: ${e}`);
    }
  }

  const msg = results.length ? results.join(" | ") : "no actions";
  const status = results.length && results.every((r) => r.startsWith("✅")) ? "ok" : results.length ? "partial" : "ok";
  return { status, msg };
}