import { quotaDisplayName } from "./format";
import type { RuleMatch, TriggerMetric, TriggerOp } from "./types";

export function quotaMetricValue(
  quota: Record<string, unknown>,
  benefit: Record<string, unknown>,
  metric: TriggerMetric,
  nowSec = Math.floor(Date.now() / 1000),
): number | null {
  const rem = Number(benefit.remaining ?? 0);
  const tot = Number(benefit.total ?? 0);
  if (metric === "remaining_pct") return tot ? (rem / tot) * 100 : 0;
  if (metric === "remaining_bytes") return rem;
  if (metric === "remaining_minutes") return rem / 60;
  if (metric === "expiring_in_days") {
    const exp = Number(quota.expired_at ?? 0);
    if (!exp) return null;
    return (exp - nowSec) / 86400;
  }
  return null;
}

export function matchesFilter(
  quota: Record<string, unknown>,
  benefit: Record<string, unknown>,
  match: RuleMatch,
): boolean {
  const kind = match.kind ?? "any";
  const val = String(match.value ?? "").trim();
  const dtFilter = String(match.data_type ?? "ANY").toUpperCase();

  if (dtFilter !== "ANY") {
    if (String(benefit.data_type ?? "").toUpperCase() !== dtFilter) return false;
  }

  if (kind === "any") return true;
  if (kind === "quota_name") {
    return quotaDisplayName(quota).toLowerCase().includes(val.toLowerCase());
  }
  if (kind === "quota_code") return val === String(quota.quota_code ?? "");
  if (kind === "group_name") {
    return String(quota.group_name ?? "").toLowerCase().includes(val.toLowerCase());
  }
  return false;
}

export function compareValues(a: number, op: TriggerOp, b: number): boolean {
  if (op === "lt") return a < b;
  if (op === "lte") return a <= b;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "eq") return Math.abs(a - b) < 1e-9;
  return false;
}