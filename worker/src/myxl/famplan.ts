import { formatDate, humanizeBytes } from "../ssr/filters";

export interface FamplanMemberRow {
  idx: number;
  msisdn: string;
  alias: string;
  slot_id: string | number;
  family_member_id: string;
  member_type: string;
  add_chances: number;
  total_add_chances: number;
  quota_allocated: number;
  quota_used: number;
  quota_pct: number;
  quota_allocated_disp: string;
  quota_used_disp: string;
  quota_alloc_mb: number;
  exp_ts: number;
  exp_date: string;
  is_empty: boolean;
  is_parent: boolean;
  is_additional: boolean;
  has_quota: boolean;
  has_chances: boolean;
  has_exp: boolean;
  quota_bar_high: boolean;
  quota_bar_mid: boolean;
  quota_bar_low: boolean;
  show_actions: boolean;
}

function buildMember(
  mem: Record<string, unknown>,
  idx: number,
  isAdditional = false,
): FamplanMemberRow {
  const msisdn = String(mem.msisdn ?? "");
  const usage = (mem.usage as Record<string, unknown>) ?? {};
  const alloc = Number(usage.quota_allocated ?? 0);
  const used = Number(usage.quota_used ?? 0);
  const memPct = alloc ? Math.floor((used / alloc) * 100) : 0;
  const expTs = Number(usage.quota_expired_at ?? 0);
  const memberType = String(mem.member_type ?? "");
  const isEmpty = msisdn === "";
  const isParent = memberType === "PARENT";
  const addChances = Number(mem.add_chances ?? 0);
  const totalChances = Number(mem.total_add_chances ?? 0);

  return {
    idx,
    msisdn,
    alias: String(mem.alias ?? ""),
    slot_id: mem.slot_id as string | number,
    family_member_id: String(mem.family_member_id ?? ""),
    member_type: memberType,
    add_chances: addChances,
    total_add_chances: totalChances,
    quota_allocated: alloc,
    quota_used: used,
    quota_pct: memPct,
    quota_allocated_disp: humanizeBytes(alloc),
    quota_used_disp: humanizeBytes(used),
    quota_alloc_mb: Math.round(alloc / (1024 * 1024)),
    exp_ts: expTs,
    exp_date: expTs ? formatDate(expTs) : "",
    is_empty: isEmpty,
    is_parent: isParent,
    is_additional: isAdditional,
    has_quota: !isEmpty && alloc > 0,
    has_chances: addChances > 0 || totalChances > 0,
    has_exp: expTs > 0,
    quota_bar_high: memPct > 85,
    quota_bar_mid: memPct > 60 && memPct <= 85,
    quota_bar_low: memPct <= 60,
    show_actions: !isEmpty && !isParent,
  };
}

export function formatFamplanPage(data: unknown) {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const inner = (root.data as Record<string, unknown> | undefined) ?? {};
  const m = (inner.member_info as Record<string, unknown> | undefined) ?? {};
  const planType = String(m.plan_type ?? "");

  if (!planType) {
    return {
      has_plan: false,
      data_json: JSON.stringify(data ?? null, null, 2),
      members: [] as FamplanMemberRow[],
      additional: [] as FamplanMemberRow[],
    };
  }

  const totalQ = Number(m.total_quota ?? 0);
  const remQ = Number(m.remaining_quota ?? 0);
  const usedQ = Math.max(0, totalQ - remQ);
  const pct = totalQ ? Math.floor((usedQ / totalQ) * 100) : 0;
  const endTs = Number(m.end_date ?? 0);

  const members: FamplanMemberRow[] = [];
  for (const [i, mem] of ((m.members as Record<string, unknown>[]) ?? []).entries()) {
    members.push(buildMember(mem, i + 1));
  }

  const additional: FamplanMemberRow[] = [];
  const base = members.length;
  for (const [i, mem] of ((m.additional_members as Record<string, unknown>[]) ?? []).entries()) {
    additional.push(buildMember(mem, base + i + 1, true));
  }

  const membersFilled = members.filter((x) => !x.is_empty).length;
  const additionalFilled = additional.filter((x) => !x.is_empty).length;

  return {
    has_plan: true,
    data_json: JSON.stringify(data ?? null, null, 2),
    info: {
      plan_type: planType,
      parent_msisdn: String(m.parent_msisdn ?? ""),
      total_quota_disp: humanizeBytes(totalQ),
      remaining_quota_disp: humanizeBytes(remQ),
      used_quota_disp: humanizeBytes(usedQ),
      usage_pct: pct,
      end_date: endTs ? formatDate(endTs) : "",
      has_end_date: endTs > 0,
      total_regular_slot: Number(m.total_regular_slot ?? 0),
      total_paid_slot: Number(m.total_paid_slot ?? 0),
    },
    members,
    members_filled: membersFilled,
    members_total: members.length,
    additional,
    additional_filled: additionalFilled,
    additional_total: additional.length,
    has_additional: additional.length > 0,
  };
}

export function formatApiResult(res: unknown): { res_json: string; has_res: boolean } {
  const json = JSON.stringify(res ?? null, null, 2);
  return { res_json: json, has_res: res != null };
}