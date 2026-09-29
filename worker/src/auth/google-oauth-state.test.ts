import { describe, expect, it } from "vitest";
import { utf8Encode } from "../crypto/encoding";
import { openGoogleOAuthState, sealGoogleOAuthState } from "./google-oauth-state";

describe("google oauth state", () => {
  it("seals and opens payload", async () => {
    const secret = utf8Encode("test-secret-key-32bytes-long!!");
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = await sealGoogleOAuthState(
      { state: "abc123", intent: "register", next: "/", exp },
      secret,
    );
    const opened = await openGoogleOAuthState(token, secret);
    expect(opened?.state).toBe("abc123");
    expect(opened?.intent).toBe("register");
  });
});