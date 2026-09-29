import type { Env } from "../env";
import { USER_MONITORING } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import type { MonitoringRule, RuleAction, RuleMatch, RuleTrigger } from "./types";

interface D1RuleRow {
  id: string;
  username: string;
  name: string;
  msisdn: string;
  match_json: string;
  trigger_json: string;
  actions_json: string;
  cooldown_seconds: number;
  enabled: number;
  last_fired_at: number | null;
  last_status: string | null;
  last_msg: string | null;
  created_at: number;
  updated_at: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function newRuleId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToRule(row: D1RuleRow): MonitoringRule {
  return {
    id: row.id,
    name: row.name,
    msisdn: Number.parseInt(row.msisdn, 10) || 0,
    match: parseJson<RuleMatch>(row.match_json, { kind: "any", data_type: "ANY" }),
    trigger: parseJson<RuleTrigger>(row.trigger_json, { metric: "remaining_pct", op: "lt", value: 10 }),
    actions: parseJson<RuleAction[]>(row.actions_json, []),
    cooldown_seconds: row.cooldown_seconds,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    last_fired_at: row.last_fired_at ?? 0,
    last_status: row.last_status ?? "",
    last_msg: row.last_msg ?? "",
  };
}

function useD1(env: Env): env is Env & { DB: D1Database } {
  return !!env.DB;
}

async function loadRulesBlob(storage: StorageBackend, username: string): Promise<MonitoringRule[]> {
  const raw = await getTextBlob(storage, username, USER_MONITORING);
  if (!raw) return [];
  try {
    const rules = JSON.parse(raw) as MonitoringRule[];
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

async function saveRulesBlob(storage: StorageBackend, username: string, rules: MonitoringRule[]): Promise<void> {
  await storage.putBlob(username, USER_MONITORING, JSON.stringify(rules));
}

export async function loadRules(env: Env, storage: StorageBackend, username: string): Promise<MonitoringRule[]> {
  if (useD1(env)) {
    const result = await env.DB.prepare(
      `SELECT * FROM monitoring_rules WHERE username = ? ORDER BY created_at ASC`,
    )
      .bind(username)
      .all<D1RuleRow>();
    return (result.results ?? []).map(rowToRule);
  }
  return loadRulesBlob(storage, username);
}

export async function getRule(
  env: Env,
  storage: StorageBackend,
  username: string,
  ruleId: string,
): Promise<MonitoringRule | null> {
  const rules = await loadRules(env, storage, username);
  return rules.find((r) => r.id === ruleId) ?? null;
}

export async function addRule(
  env: Env,
  storage: StorageBackend,
  username: string,
  payload: {
    name?: string;
    msisdn?: number | string;
    match?: RuleMatch;
    trigger?: RuleTrigger;
    actions?: RuleAction[];
    cooldown_seconds?: number;
    enabled?: boolean;
  },
): Promise<MonitoringRule> {
  const ts = nowSec();
  const rule: MonitoringRule = {
    id: newRuleId(),
    name: payload.name || "Untitled",
    msisdn: Number.parseInt(String(payload.msisdn ?? 0), 10) || 0,
    match: payload.match ?? { kind: "any", value: null, data_type: "ANY" },
    trigger: payload.trigger ?? { metric: "remaining_pct", op: "lt", value: 10 },
    actions: payload.actions ?? [],
    cooldown_seconds: Number(payload.cooldown_seconds ?? 3600),
    enabled: payload.enabled ?? true,
    created_at: ts,
    last_fired_at: 0,
    last_status: "",
    last_msg: "",
  };

  if (useD1(env)) {
    await env.DB.prepare(
      `INSERT INTO monitoring_rules (
         id, username, name, msisdn, match_json, trigger_json, actions_json,
         cooldown_seconds, enabled, last_fired_at, last_status, last_msg, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        rule.id,
        username,
        rule.name,
        String(rule.msisdn),
        JSON.stringify(rule.match),
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.actions),
        rule.cooldown_seconds,
        rule.enabled ? 1 : 0,
        null,
        "",
        "",
        ts,
        ts,
      )
      .run();
    return rule;
  }

  const rules = await loadRulesBlob(storage, username);
  rules.push(rule);
  await saveRulesBlob(storage, username, rules);
  return rule;
}

export async function updateRule(
  env: Env,
  storage: StorageBackend,
  username: string,
  ruleId: string,
  patch: Partial<MonitoringRule>,
): Promise<MonitoringRule | null> {
  if (useD1(env)) {
    const existing = await getRule(env, storage, username, ruleId);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id, created_at: existing.created_at };
    const ts = nowSec();
    await env.DB.prepare(
      `UPDATE monitoring_rules SET
         name = ?, msisdn = ?, match_json = ?, trigger_json = ?, actions_json = ?,
         cooldown_seconds = ?, enabled = ?, last_fired_at = ?, last_status = ?, last_msg = ?, updated_at = ?
       WHERE id = ? AND username = ?`,
    )
      .bind(
        next.name,
        String(next.msisdn),
        JSON.stringify(next.match),
        JSON.stringify(next.trigger),
        JSON.stringify(next.actions),
        next.cooldown_seconds,
        next.enabled ? 1 : 0,
        next.last_fired_at || null,
        next.last_status,
        next.last_msg,
        ts,
        ruleId,
        username,
      )
      .run();
    return next;
  }

  const rules = await loadRulesBlob(storage, username);
  let updated: MonitoringRule | null = null;
  for (const r of rules) {
    if (r.id === ruleId) {
      if (patch.name != null) r.name = patch.name;
      if (patch.msisdn != null) r.msisdn = patch.msisdn;
      if (patch.match != null) r.match = patch.match;
      if (patch.trigger != null) r.trigger = patch.trigger;
      if (patch.actions != null) r.actions = patch.actions;
      if (patch.cooldown_seconds != null) r.cooldown_seconds = patch.cooldown_seconds;
      if (patch.enabled != null) r.enabled = patch.enabled;
      if (patch.last_fired_at != null) r.last_fired_at = patch.last_fired_at;
      if (patch.last_status != null) r.last_status = patch.last_status;
      if (patch.last_msg != null) r.last_msg = patch.last_msg;
      updated = r;
      break;
    }
  }
  if (!updated) return null;
  await saveRulesBlob(storage, username, rules);
  return updated;
}

export async function deleteRule(
  env: Env,
  storage: StorageBackend,
  username: string,
  ruleId: string,
): Promise<boolean> {
  if (useD1(env)) {
    const res = await env.DB.prepare(`DELETE FROM monitoring_rules WHERE id = ? AND username = ?`)
      .bind(ruleId, username)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  const rules = await loadRulesBlob(storage, username);
  const filtered = rules.filter((r) => r.id !== ruleId);
  if (filtered.length === rules.length) return false;
  await saveRulesBlob(storage, username, filtered);
  return true;
}

export async function markRuleFired(
  env: Env,
  storage: StorageBackend,
  username: string,
  ruleId: string,
  status: string,
  msg: string,
): Promise<void> {
  await updateRule(env, storage, username, ruleId, {
    last_fired_at: nowSec(),
    last_status: status,
    last_msg: msg,
  });
}