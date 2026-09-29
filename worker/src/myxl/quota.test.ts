import { describe, expect, it } from "vitest";
import { activeExpiryForQuota, formatMyPackages, formatQuotaByte } from "./quota";

describe("quota formatting", () => {
  it("formatQuotaByte matches Python style", () => {
    expect(formatQuotaByte(1024 ** 3)).toBe("1.00 GB");
    expect(formatQuotaByte(512)).toBe("512 B");
  });

  it("formatMyPackages formats DATA benefits", () => {
    const out = formatMyPackages([
      {
        name: "Internet",
        quota_code: "Q1",
        benefits: [{ data_type: "DATA", remaining: 1024 ** 3, total: 2 * 1024 ** 3, name: "Kuota" }],
      },
    ]);
    expect(out[0].has_benefits).toBe(true);
    expect(out[0].benefits[0].rem_disp).toBe("1.00 GB");
    expect(out[0].benefits[0].pct).toBe(50);
  });

  it("formatMyPackages pre-formats expired_at for templates", () => {
    const out = formatMyPackages([
      { name: "Combo", quota_code: "Q1", expired_at: 2080141199, benefits: [] },
    ]);
    expect(out[0].has_expired_at).toBe(true);
    expect(out[0].expired_at_display).toMatch(/\d+ \w+ 2035/);
  });

  it("activeExpiryForQuota matches active subscription by code", () => {
    const out = activeExpiryForQuota(
      [{ quota_code: "OPT-1", expired_at: 1781542800 }],
      "OPT-1",
    );
    expect(out.has_active_expiry).toBe(true);
    expect(out.active_expiry_display).toContain("2026");
  });
});