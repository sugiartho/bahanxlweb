/** Quota formatting — mirrors app/menus/util.format_quota_byte */

import { formatDate } from "../ssr/filters";

export function normalizeExpiredAt(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export function formatQuotaByte(quotaByte: number): string {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const KB = 1024;
  if (quotaByte >= GB) return `${(quotaByte / GB).toFixed(2)} GB`;
  if (quotaByte >= MB) return `${(quotaByte / MB).toFixed(2)} MB`;
  if (quotaByte >= KB) return `${(quotaByte / KB).toFixed(2)} KB`;
  return `${quotaByte} B`;
}

export interface FormattedBenefit {
  id: unknown;
  name: string;
  data_type: string;
  rem_disp: string;
  tot_disp: string;
  unit: string;
  pct: number;
  is_unlimited: boolean;
}

export interface FormattedQuota {
  name: string;
  quota_code: string;
  group_name: string;
  group_code: string;
  expired_at: number | null;
  has_expired_at: boolean;
  expired_at_display: string;
  product_domain: string;
  product_subscription_type: string;
  benefits: FormattedBenefit[];
  has_benefits: boolean;
}

export function activeExpiryForQuota(
  quotas: Record<string, unknown>[],
  quotaCode: string,
): { has_active_expiry: boolean; active_expiry_display: string } {
  const match = quotas.find((q) => String(q.quota_code ?? "") === quotaCode);
  const expTs = match ? normalizeExpiredAt(match.expired_at) : null;
  return {
    has_active_expiry: expTs != null,
    active_expiry_display: expTs != null ? formatDate(expTs) : "",
  };
}

export function formatMyPackages(quotas: Record<string, unknown>[]): FormattedQuota[] {
  return quotas.map((q) => {
    const benefits: FormattedBenefit[] = [];
    for (const b of (q.benefits as Record<string, unknown>[]) ?? []) {
      const dt = String(b.data_type ?? "");
      const rem = Number(b.remaining ?? 0);
      const tot = Number(b.total ?? 0);
      let remDisp: string;
      let totDisp: string;
      let unit = "";
      if (dt === "DATA") {
        remDisp = formatQuotaByte(rem);
        totDisp = formatQuotaByte(tot);
      } else if (dt === "VOICE") {
        remDisp = `${Math.round(rem / 60)}`;
        totDisp = `${Math.round(tot / 60)}`;
        unit = "menit";
      } else if (dt === "TEXT") {
        remDisp = String(rem);
        totDisp = String(tot);
        unit = "SMS";
      } else {
        remDisp = String(rem);
        totDisp = String(tot);
        unit = dt;
      }
      benefits.push({
        id: b.id,
        name: String(b.name ?? ""),
        data_type: dt,
        rem_disp: remDisp,
        tot_disp: totDisp,
        unit,
        pct: tot ? Math.floor((rem / tot) * 100) : 0,
        is_unlimited: Boolean(b.is_unlimited),
      });
    }
    const expTs = normalizeExpiredAt(q.expired_at);
    return {
      name: String(q.name ?? "-"),
      quota_code: String(q.quota_code ?? ""),
      group_name: String(q.group_name ?? ""),
      group_code: String(q.group_code ?? ""),
      expired_at: expTs,
      has_expired_at: expTs != null,
      expired_at_display: expTs != null ? formatDate(expTs) : "",
      product_domain: String(q.product_domain ?? ""),
      product_subscription_type: String(q.product_subscription_type ?? ""),
      benefits,
      has_benefits: benefits.length > 0,
    };
  });
}