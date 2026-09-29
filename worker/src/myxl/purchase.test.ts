import { describe, expect, it } from "vitest";
import { resolvePurchaseAmount } from "./purchase-executor";
import { buildPaymentItem, formatPurchaseResult, normalizePaymentItem, paymentForFromPackage } from "./purchase";

describe("purchase helpers", () => {
  it("resolvePurchaseAmount keeps default when overwrite is empty", () => {
    expect(resolvePurchaseAmount(25000, -1)).toBe(25000);
  });

  it("resolvePurchaseAmount uses custom overwrite", () => {
    expect(resolvePurchaseAmount(25000, 19900)).toBe(19900);
  });
  it("paymentForFromPackage falls back when family payment_for is empty", () => {
    expect(paymentForFromPackage({ package_family: { payment_for: "" } })).toBe("BUY_PACKAGE");
    expect(paymentForFromPackage({ package_family: { payment_for: "SHARE_PACKAGE" } })).toBe("SHARE_PACKAGE");
  });

  it("normalizePaymentItem coerces integer prices", () => {
    const item = normalizePaymentItem({
      item_code: " OPT1 ",
      product_type: "",
      item_price: 25000.9,
      item_name: "Paket",
      tax: 0,
      token_confirmation: " tok ",
    });
    expect(item.item_price).toBe(25000);
    expect(item.item_code).toBe("OPT1");
    expect(item.token_confirmation).toBe("tok");
  });

  it("buildPaymentItem maps package detail", () => {
    const item = buildPaymentItem({
      token_confirmation: "abc",
      package_option: {
        package_option_code: "OPT1",
        price: 15000,
        name: "Paket 1GB",
      },
    });
    expect(item.item_code).toBe("OPT1");
    expect(item.item_price).toBe(15000);
    expect(item.token_confirmation).toBe("abc");
  });

  it("formatPurchaseResult flags success and QR", () => {
    const ctx = formatPurchaseResult("QRIS", { status: "SUCCESS", qr_code: "QR-DATA" }, "QR-DATA");
    expect(ctx.result_success).toBe(true);
    expect(ctx.has_qris_img).toBe(true);
    expect(ctx.qris_img).toContain("QR-DATA");
  });

  it("formatPurchaseResult supports pending job", () => {
    const ctx = formatPurchaseResult("Wait", { status: "PENDING" }, null, { jobPending: true, jobId: "j1" });
    expect(ctx.job_pending).toBe(true);
    expect(ctx.job_id).toBe("j1");
  });

  it("formatPurchaseResult surfaces API error without data", () => {
    const ctx = formatPurchaseResult("Pembelian Pulsa", {
      status: "FAILED",
      message: "Format salah",
    });
    expect(ctx.has_result_data).toBe(false);
    expect(ctx.error_message).toContain("Format salah");
    expect(ctx.has_error_message).toBe(true);
  });
});