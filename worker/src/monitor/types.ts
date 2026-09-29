export type MatchKind = "any" | "quota_name" | "quota_code" | "group_name";
export type TriggerMetric = "remaining_pct" | "remaining_bytes" | "remaining_minutes" | "expiring_in_days";
export type TriggerOp = "lt" | "lte" | "gt" | "gte" | "eq";
export type ActionType = "telegram" | "buy_option" | "unsubscribe";

export interface RuleMatch {
  kind: MatchKind;
  value?: string | null;
  data_type?: string;
}

export interface RuleTrigger {
  metric: TriggerMetric;
  op: TriggerOp;
  value: number;
}

export interface RuleAction {
  type: ActionType;
  message?: string;
  option_code?: string;
  method?: string;
}

export interface MonitoringRule {
  id: string;
  name: string;
  msisdn: number;
  match: RuleMatch;
  trigger: RuleTrigger;
  actions: RuleAction[];
  cooldown_seconds: number;
  enabled: boolean;
  created_at: number;
  last_fired_at: number;
  last_status: string;
  last_msg: string;
}

export interface QuotaCacheEntry {
  updated_at: number;
  balance: Record<string, unknown> | null;
  quotas: Record<string, unknown>[] | null;
}

export type QuotaCache = Record<string, QuotaCacheEntry>;