import { describe, expect, it } from "vitest";
import { formatApiResult, formatFamplanPage } from "./famplan";

describe("famplan helpers", () => {
  it("formatFamplanPage returns has_plan false when no plan_type", () => {
    const ctx = formatFamplanPage({ status: "SUCCESS", data: { member_info: {} } });
    expect(ctx.has_plan).toBe(false);
  });

  it("formatFamplanPage builds member rows and quota pct", () => {
    const ctx = formatFamplanPage({
      status: "SUCCESS",
      data: {
        member_info: {
          plan_type: "AKRAB",
          parent_msisdn: "628111",
          total_quota: 10_000_000_000,
          remaining_quota: 5_000_000_000,
          members: [
            {
              msisdn: "628222",
              alias: "Anak",
              member_type: "CHILD",
              slot_id: 2,
              family_member_id: "fm1",
              usage: { quota_allocated: 1024, quota_used: 512, quota_expired_at: 1700000000 },
            },
            { msisdn: "", member_type: "CHILD", slot_id: 3, family_member_id: "fm2", usage: {} },
          ],
        },
      },
    });
    expect(ctx.has_plan).toBe(true);
    expect(ctx.members).toHaveLength(2);
    expect(ctx.members[0].quota_pct).toBe(50);
    expect(ctx.members[0].show_actions).toBe(true);
    expect(ctx.members[1].is_empty).toBe(true);
    expect(ctx.members_filled).toBe(1);
  });

  it("formatApiResult serializes response", () => {
    const out = formatApiResult({ status: "SUCCESS" });
    expect(out.has_res).toBe(true);
    expect(out.res_json).toContain("SUCCESS");
  });
});