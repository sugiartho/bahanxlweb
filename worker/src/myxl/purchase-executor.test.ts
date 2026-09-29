import { describe, expect, it } from "vitest";
import { isRedeemPurchaseMethod } from "./purchase-executor";
import { formatPoints } from "./packages";

describe("redeem purchase helpers", () => {
  it("isRedeemPurchaseMethod recognizes redeem flows", () => {
    expect(isRedeemPurchaseMethod("redeem_loyalty")).toBe(true);
    expect(isRedeemPurchaseMethod("redeem_bounty")).toBe(true);
    expect(isRedeemPurchaseMethod("redeem_bounty_allotment")).toBe(true);
    expect(isRedeemPurchaseMethod("balance")).toBe(false);
  });

  it("formatPoints renders Indonesian locale", () => {
    expect(formatPoints(1500)).toBe("1.500 Poin");
  });
});