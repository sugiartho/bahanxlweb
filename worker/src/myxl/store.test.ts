import { describe, expect, it } from "vitest";
import {
  categoryPageTitle,
  formatCategoryFamilies,
  formatRedeemables,
  formatRedeemablesCategoryCatalog,
  formatStorePackages,
  formatTieringExchangeCatalog,
  redeemActionLabel,
  resolveRedeemActionParam,
  storeActionHref,
} from "./store";

describe("store helpers", () => {
  it("storeActionHref maps PDP, PLP, and loyalty landings", () => {
    expect(storeActionHref("PDP", "OPT123")).toBe("/packages/by-option?code=OPT123");
    expect(storeActionHref("PLP", "FAM1")).toBe("/packages/by-family?code=FAM1");
    expect(storeActionHref("LOYALTY", "cat-1")).toBe("/store/category?code=cat-1&source=LOYALTY");
    expect(storeActionHref("MYPOINT_LANDING", "cat-2", { enterprise: true })).toBe(
      "/store/category?code=cat-2&source=MYPOINT_LANDING&enterprise=true",
    );
    expect(storeActionHref("OTHER", "x")).toBeNull();
  });

  it("resolveRedeemActionParam falls back to parent category_code for landings", () => {
    expect(
      resolveRedeemActionParam(
        { action_type: "MYPOINT_LANDING", action_param: "" },
        "19e9c819-48b6-4d3a-8175-e7d6cedc6f3d",
        "MYPOINT_LANDING",
      ),
    ).toBe("19e9c819-48b6-4d3a-8175-e7d6cedc6f3d");
    expect(
      resolveRedeemActionParam({ action_type: "PDP", action_param: "" }, "cat-x", "PDP"),
    ).toBe("");
  });

  it("formatRedeemables skips invalid valid_until and hides uuid category codes", () => {
    const cats = formatRedeemables({
      data: {
        categories: [
          {
            category_name: "XL Poin",
            category_code: "19e9c819-48b6-4d3a-8175-e7d6cedc6f3d",
            redeemables: [
              {
                name: "Redeem with XL Poin",
                valid_until: 0,
                action_type: "MYPOINT_LANDING",
                action_param: "19e9c819-48b6-4d3a-8175-e7d6cedc6f3d",
              },
            ],
          },
        ],
      },
    });
    expect(cats[0].show_code).toBe(false);
    const item = (cats[0].redeem_items as Record<string, unknown>[])[0];
    expect(item.has_valid_until).toBe(false);
    expect(item.has_href).toBe(true);
    expect(redeemActionLabel("MYPOINT_LANDING")).toBe("XL Poin");
    expect(cats[0].has_category_href).toBe(true);
  });

  it("formatRedeemables links MYPOINT_LANDING when action_param is empty", () => {
    const cats = formatRedeemables({
      data: {
        categories: [
          {
            category_name: "myRewards",
            category_code: "7a05d8d7-1111-2222-3333-444455556666",
            redeemables: [
              {
                name: "Let's, Redeem Your Rewards",
                valid_until: "1970-01-01",
                action_type: "LOYALTY",
                action_param: "",
              },
            ],
          },
        ],
      },
    });
    const item = (cats[0].redeem_items as Record<string, unknown>[])[0];
    expect(item.has_href).toBe(true);
    expect(item.has_valid_until).toBe(false);
    expect(String(item.href)).toContain("7a05d8d7-1111-2222-3333-444455556666");
    expect(String(item.href)).toContain("source=LOYALTY");
  });

  it("formatCategoryFamilies extracts family rows", () => {
    const rows = formatCategoryFamilies({
      data: {
        families: [{ package_family_code: "fam-1", name: "Reward A", icon_url: "http://x" }],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toContain("fam-1");
  });

  it("formatCategoryFamilies unwraps nested package_family objects", () => {
    const rows = formatCategoryFamilies({
      data: {
        package_families: [
          {
            package_family: {
              package_family_code: "fam-nested",
              name: "Nested Reward",
              icon_url: "http://y",
            },
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("fam-nested");
    expect(rows[0].label).toBe("Nested Reward");
  });

  it("formatCategoryFamilies accepts data array responses", () => {
    const rows = formatCategoryFamilies({
      data: [{ package_family_code: "fam-array", name: "Array Reward" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("fam-array");
  });

  it("formatRedeemablesCategoryCatalog maps PDP items in category", () => {
    const rows = formatRedeemablesCategoryCatalog(
      {
        data: {
          categories: [
            {
              category_code: "cat-1",
              redeemables: [
                { name: "Landing", action_type: "MYPOINT_LANDING", action_param: "" },
                { name: "Paket 1GB", action_type: "PDP", action_param: "OPT1" },
              ],
            },
          ],
        },
      },
      "cat-1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toContain("OPT1");
  });

  it("formatTieringExchangeCatalog extracts nested exchange rows", () => {
    const rows = formatTieringExchangeCatalog({
      current_point: 11070,
      rewards: [{ item_code: "RWD1", item_name: "Kuota 1GB", points: 500 }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].has_points_label).toBe(true);
    expect(rows[0].href).toContain("RWD1");
  });

  it("categoryPageTitle maps sources", () => {
    expect(categoryPageTitle("LOYALTY")).toBe("Katalog myRewards");
    expect(categoryPageTitle("MYPOINT_LANDING")).toBe("Katalog XL Poin");
  });

  it("formatStorePackages extracts price rows", () => {
    const rows = formatStorePackages({
      data: {
        results_price_only: [
          { title: "Paket A", discounted_price: 1000, original_price: 2000, action_type: "PDP", action_param: "X" },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].has_href).toBe(true);
    expect(rows[0].has_discount).toBe(true);
  });
});