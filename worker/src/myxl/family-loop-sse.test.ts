import { describe, expect, it } from "vitest";
import { extractApiErr, formatSseEvent } from "./family-loop-sse";

describe("family-loop SSE helpers", () => {
  it("formatSseEvent encodes event and JSON data", () => {
    const out = formatSseEvent("info", { msg: "hello", total: 3 });
    expect(out).toContain("event: info\n");
    expect(out).toContain('data: {"msg":"hello","total":3}');
    expect(out.endsWith("\n\n")).toBe(true);
  });

  it("extractApiErr joins status message and code", () => {
    expect(extractApiErr({ status: "FAIL", message: "nope", code: "001" })).toContain("status=FAIL");
    expect(extractApiErr({ status: "FAIL", message: "nope", code: "001" })).toContain("nope");
    expect(extractApiErr({ status: "FAIL", message: "nope", code: "001" })).toContain("code=001");
  });

  it("extractApiErr handles empty response", () => {
    expect(extractApiErr(null)).toBe("Tidak ada response");
  });
});