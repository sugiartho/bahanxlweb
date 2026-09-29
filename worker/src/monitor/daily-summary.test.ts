import { describe, expect, it } from "vitest";
import { wibTodayAtUnix } from "../clients/time";

describe("daily summary schedule", () => {
  it("fires after 07:00 WIB, not at 07:00 UTC (14:00 WIB)", () => {
    const summaryHour = 7;
    const summaryMinute = 0;
    const atSevenAmWib = new Date("2026-06-15T00:05:00Z"); // 07:05 WIB
    const atSevenAmUtc = new Date("2026-06-15T07:05:00Z"); // 14:05 WIB

    const targetTs = wibTodayAtUnix(summaryHour, summaryMinute, atSevenAmWib);
    const nowSecWib = Math.floor(atSevenAmWib.getTime() / 1000);
    const nowSecUtc = Math.floor(atSevenAmUtc.getTime() / 1000);

    expect(nowSecWib).toBeGreaterThanOrEqual(targetTs);
    expect(nowSecUtc).toBeGreaterThanOrEqual(targetTs);
    expect(nowSecUtc - targetTs).toBeGreaterThan(6 * 3600);
  });
});