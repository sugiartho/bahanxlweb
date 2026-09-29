import { describe, expect, it } from "vitest";
import { chunkLines, esc, formatHistoryLines, formatRpLabel } from "./formatters";

describe("telegram formatters", () => {
  it("esc escapes HTML", () => {
    expect(esc("<a>&")).toBe("&lt;a&gt;&amp;");
  });

  it("formatHistoryLines builds transaction list", () => {
    const text = formatHistoryLines(628111, [
      { title: "Paket A", price: "IDR 1000", status: "SUCCESS" },
    ]);
    expect(text).toContain("628111");
    expect(text).toContain("Paket A");
    expect(text).toContain("✅");
  });

  it("chunkLines splits long output", () => {
    const chunks = chunkLines(["a".repeat(2000), "b".repeat(2000)], 2500);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("formatRpLabel formats IDR", () => {
    expect(formatRpLabel(2000)).toContain("2.000");
  });
});