import { describe, expect, it } from "vitest";
import { compareValues, matchesFilter, quotaMetricValue } from "./evaluator";

describe("monitor evaluator", () => {
  const quota = {
    name: "Internet 10GB",
    quota_code: "QC001",
    group_name: "Main Quota",
    expired_at: 1_700_000_000,
  };
  const benefit = {
    name: "Data",
    data_type: "DATA",
    remaining: 512 * 1024 * 1024,
    total: 10 * 1024 * 1024 * 1024,
  };

  it("computes remaining_pct", () => {
    const val = quotaMetricValue(quota, benefit, "remaining_pct");
    expect(val).toBeCloseTo(5, 0);
  });

  it("matches quota_name filter", () => {
    expect(matchesFilter(quota, benefit, { kind: "quota_name", value: "internet" })).toBe(true);
    expect(matchesFilter(quota, benefit, { kind: "quota_name", value: "voice" })).toBe(false);
  });

  it("matches quota_name using package family fallback", () => {
    const familyQuota = { package_family: { name: "Add PRIO" }, benefits: [] };
    expect(matchesFilter(familyQuota, benefit, { kind: "quota_name", value: "add prio" })).toBe(true);
  });

  it("filters by data_type", () => {
    expect(matchesFilter(quota, benefit, { kind: "any", data_type: "DATA" })).toBe(true);
    expect(matchesFilter(quota, benefit, { kind: "any", data_type: "VOICE" })).toBe(false);
  });

  it("compares trigger values", () => {
    expect(compareValues(5, "lt", 10)).toBe(true);
    expect(compareValues(10, "lt", 10)).toBe(false);
    expect(compareValues(10, "eq", 10)).toBe(true);
  });

  it("computes expiring_in_days", () => {
    const now = 1_699_000_000;
    const val = quotaMetricValue(quota, benefit, "expiring_in_days", now);
    expect(val).toBeCloseTo((1_700_000_000 - now) / 86400, 2);
  });
});