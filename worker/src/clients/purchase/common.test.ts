import { describe, expect, it } from "vitest";
import {
  buildPaymentTargets,
  normalizeSettlementItems,
  resolveAmount,
  resolveItemIndex,
  resolvePaymentFor,
} from "./common";
import type { PaymentItem } from "./types";

const items: PaymentItem[] = [
  {
    item_code: "OPT-A",
    product_type: "",
    item_price: 1000,
    item_name: "A",
    tax: 0,
    token_confirmation: "tok-a",
  },
  {
    item_code: "OPT-B",
    product_type: "",
    item_price: 2000,
    item_name: "B",
    tax: 0,
    token_confirmation: "tok-b",
  },
];

describe("purchase common", () => {
  it("buildPaymentTargets joins item codes", () => {
    expect(buildPaymentTargets(items)).toBe("OPT-A;OPT-B");
  });

  it("resolveItemIndex supports negative python-style indices", () => {
    expect(resolveItemIndex(items, -1)).toBe(1);
    expect(resolveItemIndex(items, 0)).toBe(0);
  });

  it("resolveAmount uses overwrite or indexed price", () => {
    expect(resolveAmount(items, 5000, -1)).toBe(5000);
    expect(resolveAmount(items, -1, 0)).toBe(1000);
    expect(resolveAmount(items, -1, -1)).toBe(2000);
  });

  it("resolvePaymentFor defaults empty values to BUY_PACKAGE", () => {
    expect(resolvePaymentFor("")).toBe("BUY_PACKAGE");
    expect(resolvePaymentFor(" SHARE_PACKAGE ")).toBe("SHARE_PACKAGE");
  });

  it("normalizeSettlementItems trims codes and truncates prices", () => {
    const raw = [
      {
        item_code: " OPT-A ",
        product_type: "",
        item_price: 1000.8,
        item_name: "A",
        tax: 0,
        token_confirmation: " tok ",
      },
    ];
    const out = normalizeSettlementItems(raw);
    expect(out[0].item_code).toBe("OPT-A");
    expect(out[0].item_price).toBe(1000);
    expect(out[0].token_confirmation).toBe("tok");
  });
});