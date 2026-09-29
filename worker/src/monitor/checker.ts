import type { Env } from "../env";
import { getAccountForMsisdn } from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import type { StorageBackend } from "../storage/types";
import { executeRuleActions } from "./actions";
import { compareValues, matchesFilter, quotaMetricValue } from "./evaluator";
import { logLine } from "./log";
import { loadRules, markRuleFired } from "./rules";
import { updateAccountCache } from "./quota-cache";

export async function checkUserOnce(env: Env, storage: StorageBackend, username: string): Promise<void> {
  const rules = (await loadRules(env, storage, username)).filter((r) => r.enabled);
  if (!rules.length) return;

  let clients;
  try {
    clients = createMyXlClients(env, storage, username);
  } catch (e) {
    await logLine(storage, username, `[${username}] MyXL clients err: ${e}`);
    return;
  }

  const byMsisdn = new Map<number, typeof rules>();
  for (const r of rules) {
    const n = Number(r.msisdn);
    if (!n) continue;
    const list = byMsisdn.get(n) ?? [];
    list.push(r);
    byMsisdn.set(n, list);
  }

  const now = Math.floor(Date.now() / 1000);

  for (const [msisdn, msisdnRules] of byMsisdn) {
    let user;
    try {
      user = await getAccountForMsisdn(storage, username, msisdn, clients);
    } catch (e) {
      await logLine(storage, username, `[${username}] getAccountForMsisdn(${msisdn}) err: ${e}`);
      continue;
    }
    if (!user || user.number !== msisdn) {
      await logLine(storage, username, `[${username}] cannot activate ${msisdn}`);
      continue;
    }

    let quotas: Record<string, unknown>[] = [];
    try {
      const data = await clients.engsel.getQuotaDetails(user.tokens.id_token);
      quotas = ((data?.quotas as Record<string, unknown>[]) ?? []) as Record<string, unknown>[];
    } catch (e) {
      await logLine(storage, username, `[${username}/${msisdn}] quota fetch err: ${e}`);
      continue;
    }

    let balance: Record<string, unknown> | null = null;
    try {
      balance = await clients.engsel.getBalance(user.tokens.id_token);
    } catch {
      balance = null;
    }
    await updateAccountCache(storage, username, msisdn, balance, quotas);

    for (const rule of msisdnRules) {
      const last = rule.last_fired_at || 0;
      const cd = rule.cooldown_seconds || 0;
      if (last && now - last < cd) continue;

      const trigger = rule.trigger ?? { metric: "remaining_pct", op: "lt", value: 10 };
      const metric = trigger.metric ?? "remaining_pct";
      const op = trigger.op ?? "lt";
      const target = Number(trigger.value ?? 0);

      let fired = false;
      for (const quota of quotas) {
        for (const benefit of (quota.benefits as Record<string, unknown>[]) ?? []) {
          if (!matchesFilter(quota, benefit, rule.match ?? { kind: "any" })) continue;
          const val = quotaMetricValue(quota, benefit, metric, now);
          if (val == null) continue;
          if (!compareValues(val, op, target)) continue;

          fired = true;
          let status = "error";
          let actionMsg = "";
          try {
            const res = await executeRuleActions(env, storage, rule, user, quota, benefit, clients, username);
            status = res.status;
            actionMsg = res.msg;
          } catch (e) {
            status = "error";
            actionMsg = String(e);
          }
          await markRuleFired(env, storage, username, rule.id, status, actionMsg);
          await logLine(
            storage,
            username,
            `[${username}/${msisdn}] rule '${rule.name}' FIRED: ${quota.name ?? "-"} · ${benefit.name ?? "-"} ` +
              `${metric}=${val.toFixed(1)} ${op} ${target} → ${actionMsg}`,
          );
          break;
        }
        if (fired) break;
      }
    }
  }
}