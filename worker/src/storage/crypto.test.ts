import { describe, expect, it } from "vitest";
import { USER_REFRESH_TOKENS, isEncryptedKey } from "./keys";
import { decryptText, encryptText, isEncrypted, resolveEncryptionKey } from "./crypto";

describe("storage crypto", () => {
  it("roundtrip AES-GCM", async () => {
    const key = await resolveEncryptionKey("test-key-for-unit-tests-only");
    const raw = await encryptText('{"refresh_token":"abc"}', key);
    expect(isEncrypted(raw)).toBe(true);
    expect(await decryptText(raw, key)).toBe('{"refresh_token":"abc"}');
  });

  it("sensitive key detection", () => {
    expect(isEncryptedKey(USER_REFRESH_TOKENS)).toBe(true);
    expect(isEncryptedKey("decoy_data/decoy-default-balance.json")).toBe(true);
    expect(isEncryptedKey("shared/hot.json")).toBe(false);
  });
});