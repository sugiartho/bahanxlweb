import { describe, expect, it } from "vitest";
import {
  GMT7_OFFSET_MIN,
  javaLikeTimestamp,
  refreshAxRequestAtGmt7,
  tsGmt7WithoutColon,
  wibTodayAtUnix,
} from "./time";

/** Instant: 2026-06-13 03:30:45.123 UTC = 10:30:45.123 WIB */
const INSTANT = new Date("2026-06-13T03:30:45.123Z");

describe("client time helpers", () => {
  it("javaLikeTimestamp matches Python GMT+7 vector", () => {
    expect(javaLikeTimestamp(INSTANT, { offsetMinutes: GMT7_OFFSET_MIN })).toBe(
      "2026-06-13T10:30:45.12+07:00",
    );
  });

  it("javaLikeTimestamp matches Python UTC vector", () => {
    expect(javaLikeTimestamp(INSTANT, { offsetMinutes: 0 })).toBe("2026-06-13T03:30:45.12+00:00");
  });

  it("tsGmt7WithoutColon matches Python vector", () => {
    expect(tsGmt7WithoutColon(INSTANT)).toBe("2026-06-13T10:30:45.123+0700");
  });

  it("tsGmt7WithoutColon minus 5 minutes", () => {
    const minus5 = new Date(INSTANT.getTime() - 5 * 60_000);
    expect(tsGmt7WithoutColon(minus5)).toBe("2026-06-13T10:25:45.123+0700");
  });

  it("refreshAxRequestAtGmt7 uses millisecond fraction", () => {
    expect(refreshAxRequestAtGmt7(INSTANT)).toBe("2026-06-13T10:30:45.123+0700");
  });

  it("wibTodayAtUnix maps 07:00 WIB to midnight UTC on the same WIB calendar day", () => {
    const now = new Date("2026-06-15T06:00:00Z"); // 13:00 WIB
    expect(wibTodayAtUnix(7, 0, now)).toBe(Math.floor(new Date("2026-06-15T00:00:00Z").getTime() / 1000));
  });

  it("wibTodayAtUnix keeps 07:00 WIB before the slot on the prior UTC day", () => {
    const now = new Date("2026-06-14T23:30:00Z"); // 06:30 WIB on 15 Jun
    expect(wibTodayAtUnix(7, 0, now)).toBe(Math.floor(new Date("2026-06-15T00:00:00Z").getTime() / 1000));
    expect(Math.floor(now.getTime() / 1000)).toBeLessThan(wibTodayAtUnix(7, 0, now));
  });
});