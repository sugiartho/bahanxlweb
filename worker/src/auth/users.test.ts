import { describe, expect, it } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import {
  authenticate,
  changePassword,
  createGoogleUser,
  createUser,
  getTheme,
  getUserByTelegram,
  linkTelegram,
  loadUsers,
  setTheme,
  unlinkTelegram,
} from "./users";

describe("webui users", () => {
  it("creates and authenticates user", async () => {
    const storage = new MemoryStorageBackend();
    const created = await createUser(storage, "alice", "secret12");
    expect(created.ok).toBe(true);
    expect((await loadUsers(storage)).length).toBe(1);

    const user = await authenticate(storage, "alice", "secret12");
    expect(user?.username).toBe("alice");
    expect(await authenticate(storage, "alice", "nope")).toBeNull();
  });

  it("rejects invalid username", async () => {
    const storage = new MemoryStorageBackend();
    const result = await createUser(storage, "X", "secret12");
    expect(result.ok).toBe(false);
  });

  it("createGoogleUser registers oauth-only account", async () => {
    const storage = new MemoryStorageBackend();
    const created = await createGoogleUser(storage, {
      sub: "gid-1",
      email: "newuser@gmail.com",
      email_verified: true,
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.user.password_hash).toBe("");
      expect(created.user.google_sub).toBe("gid-1");
    }
  });

  it("linkTelegram and unlinkTelegram manage chat id", async () => {
    const storage = new MemoryStorageBackend();
    await createUser(storage, "alice", "secret12");
    expect(await linkTelegram(storage, "alice", 4242)).toBe(true);
    expect((await getUserByTelegram(storage, 4242))?.username).toBe("alice");
    expect(await unlinkTelegram(storage, "alice")).toBe(true);
    expect(await getUserByTelegram(storage, 4242)).toBeNull();
  });

  it("setTheme updates user preference", async () => {
    const storage = new MemoryStorageBackend();
    await createUser(storage, "alice", "secret12");
    expect(getTheme(await authenticate(storage, "alice", "secret12"))).toBe("dark");
    expect(await setTheme(storage, "alice", "light")).toBe(true);
    const user = await authenticate(storage, "alice", "secret12");
    expect(getTheme(user)).toBe("light");
    expect(await setTheme(storage, "alice", "nope")).toBe(false);
  });

  it("changePassword verifies old password and updates hash", async () => {
    const storage = new MemoryStorageBackend();
    await createUser(storage, "alice", "secret12");

    const wrong = await changePassword(storage, "alice", "nope", "newpass1");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("Password lama salah");
    expect(await authenticate(storage, "alice", "secret12")).not.toBeNull();

    const short = await changePassword(storage, "alice", "secret12", "abc");
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain("minimal 6");

    const ok = await changePassword(storage, "alice", "secret12", "newpass1");
    expect(ok.ok).toBe(true);
    expect(await authenticate(storage, "alice", "secret12")).toBeNull();
    expect(await authenticate(storage, "alice", "newpass1")).not.toBeNull();
  });
});