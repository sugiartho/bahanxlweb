import { describe, expect, it, vi } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { createGoogleUser, getUserByGoogleSub } from "./users";
import { resolveGoogleAuthUser, verifyGoogleIdToken } from "./google";

describe("google auth", () => {
  it("creates user on register intent", async () => {
    const storage = new MemoryStorageBackend();
    const resolved = await resolveGoogleAuthUser(
      storage,
      "register",
      { sub: "google-1", email: "alice@example.com", email_verified: true },
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.user.google_sub).toBe("google-1");
      expect(resolved.user.email).toBe("alice@example.com");
    }
  });

  it("logs in existing google user", async () => {
    const storage = new MemoryStorageBackend();
    await createGoogleUser(storage, {
      sub: "google-2",
      email: "bob@example.com",
      email_verified: true,
    });
    const resolved = await resolveGoogleAuthUser(
      storage,
      "login",
      { sub: "google-2", email: "bob@example.com", email_verified: true },
    );
    expect(resolved.ok).toBe(true);
  });

  it("rejects login for unknown google account", async () => {
    const storage = new MemoryStorageBackend();
    const resolved = await resolveGoogleAuthUser(
      storage,
      "login",
      { sub: "google-x", email: "x@example.com", email_verified: true },
    );
    expect(resolved.ok).toBe(false);
  });

  it("verifies id token via tokeninfo", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        aud: "client-id",
        iss: "accounts.google.com",
        sub: "abc",
        email: "a@b.com",
        email_verified: "true",
      }),
    );
    const claims = await verifyGoogleIdToken("token", "client-id", fetchFn);
    expect(claims?.sub).toBe("abc");
    expect(await getUserByGoogleSub(new MemoryStorageBackend(), "abc")).toBeNull();
  });
});