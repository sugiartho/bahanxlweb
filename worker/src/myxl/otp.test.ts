import { describe, expect, it } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { clearOtpPending, isOtpPendingForPhone, loadOtpPending, saveOtpPending } from "./otp";

describe("otp pending state", () => {
  it("roundtrips pending OTP per user", async () => {
    const storage = new MemoryStorageBackend();
    await saveOtpPending(storage, "alice", "6281234567890", "sub-xyz");
    const state = await loadOtpPending(storage, "alice");
    expect(state?.phone).toBe("6281234567890");
    expect(state?.subscriberId).toBe("sub-xyz");
    expect(isOtpPendingForPhone(state, "6281234567890")).toBe(true);
    await clearOtpPending(storage, "alice");
    expect(await loadOtpPending(storage, "alice")).toBeNull();
  });
});