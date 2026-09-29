import { describe, expect, it } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { axDeviceId, isLikelyAxFingerprint, loadAxFingerprint } from "./fingerprint";

const SECRETS = {
  xdataKey: "5dccbf08920a5527b99e222789c34bb7",
  axApiSigKey: "18b4d589826af50241177961590e6693",
  xApiBaseSecret: "test-secret",
  encryptedFieldKey: "5dccbf08920a5527",
  axFpKey: "18b4d589826af50241177961590e6693",
};

const REAL_FP =
  "YmQLy9ZiLLBFAEVcI4Dnw9+NJWZcdGoQyewxMF/9hbfhk/QyrKFt/IghoCJ8RbWCe7AFC6QWDE+eO5IZYF9Vot3Qf0ofa6795RKk6y2ur05lvSaSO/Fpdg1ihKbjjbnX";

describe("axDeviceId", () => {
  it("matches Python hashlib.md5 hex digest", () => {
    expect(axDeviceId("test-fingerprint-string")).toBe("0eea5dc390e488070fd417e3c21d779e");
  });
});

describe("isLikelyAxFingerprint", () => {
  it("rejects short AX_DEVICE_ID-style hex overrides", () => {
    expect(isLikelyAxFingerprint("92fb44c0804233eb4d9e29f838223a14")).toBe(false);
  });

  it("accepts migrated ax.fp blobs", () => {
    expect(isLikelyAxFingerprint(REAL_FP)).toBe(true);
  });
});

describe("loadAxFingerprint", () => {
  it("seeds new users from cli ax.fp instead of short env override", async () => {
    const storage = new MemoryStorageBackend();
    await storage.putBlob(null, "ax.fp", REAL_FP);

    const fp = await loadAxFingerprint(storage, "alice", SECRETS, "92fb44c0804233eb4d9e29f838223a14");
    expect(fp).toBe(REAL_FP);
    expect(await storage.getBlob("alice", "ax.fp")).toBe(REAL_FP);
    expect(axDeviceId(fp)).toBe("36c22c830917f376344c79f8bf4cd2e3");
  });
});