import { describe, expect, it, vi } from "vitest";
import type { CiamClient } from "../clients/ciam";
import type { EngselClient } from "../clients/engsel";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { USER_ACTIVE_NUMBER, USER_REFRESH_TOKENS } from "../storage/keys";
import {
  addRefreshToken,
  getAccountForMsisdn,
  getActiveUserDisplay,
  listAccounts,
  loadRefreshTokens,
  removeRefreshToken,
  setActiveUser,
} from "./accounts";

function mockClients(): { ciam: CiamClient; engsel: EngselClient } {
  const ciam = {
    refreshToken: vi.fn(async () => ({
      access_token: "at",
      refresh_token: "rt-new",
      id_token: "it",
    })),
  } as unknown as CiamClient;

  const engsel = {
    getProfile: vi.fn(async () => ({
      profile: { subscriber_id: "sub-1", subscription_type: "PREPAID" },
    })),
  } as unknown as EngselClient;

  return { ciam, engsel };
}

describe("myxl accounts", () => {
  it("persists refresh tokens and active number", async () => {
    const storage = new MemoryStorageBackend();
    const clients = mockClients();

    await addRefreshToken(storage, "alice", 6281234567890, "rt-initial", clients);
    const accounts = await listAccounts(storage, "alice");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].number).toBe(6281234567890);
    expect(accounts[0].refresh_token).toBe("rt-new");
    expect(await storage.getBlob("alice", USER_ACTIVE_NUMBER)).toBe("6281234567890");
  });

  it("getActiveUserDisplay returns active entry", async () => {
    const storage = new MemoryStorageBackend();
    await storage.putBlob(
      "alice",
      USER_REFRESH_TOKENS,
      JSON.stringify([{ number: 628111, subscriber_id: "s", subscription_type: "PREPAID", refresh_token: "r" }]),
    );
    await storage.putBlob("alice", USER_ACTIVE_NUMBER, "628111");
    const active = await getActiveUserDisplay(storage, "alice");
    expect(active?.number).toBe(628111);
  });

  it("getAccountForMsisdn returns user without changing active", async () => {
    const storage = new MemoryStorageBackend();
    const clients = mockClients();
    await storage.putBlob(
      "alice",
      USER_REFRESH_TOKENS,
      JSON.stringify([
        { number: 628111, subscriber_id: "s1", subscription_type: "PREPAID", refresh_token: "r1" },
        { number: 628222, subscriber_id: "s2", subscription_type: "PREPAID", refresh_token: "r2" },
      ]),
    );
    await storage.putBlob("alice", USER_ACTIVE_NUMBER, "628111");

    const user = await getAccountForMsisdn(storage, "alice", 628222, clients);
    expect(user?.number).toBe(628222);
    expect(await storage.getBlob("alice", USER_ACTIVE_NUMBER)).toBe("628111");
  });

  it("setActiveUser switches active number", async () => {
    const storage = new MemoryStorageBackend();
    const clients = mockClients();
    await storage.putBlob(
      "alice",
      USER_REFRESH_TOKENS,
      JSON.stringify([
        { number: 628111, subscriber_id: "s1", subscription_type: "PREPAID", refresh_token: "r1" },
        { number: 628222, subscriber_id: "s2", subscription_type: "PREPAID", refresh_token: "r2" },
      ]),
    );

    const ok = await setActiveUser(storage, "alice", 628222, clients);
    expect(ok).toBe(true);
    expect(await storage.getBlob("alice", USER_ACTIVE_NUMBER)).toBe("628222");
    const saved = await loadRefreshTokens(storage, "alice");
    expect(saved.find((x) => x.number === 628222)?.refresh_token).toBe("rt-new");
  });

  it("removeRefreshToken drops account", async () => {
    const storage = new MemoryStorageBackend();
    const clients = mockClients();
    await storage.putBlob(
      "alice",
      USER_REFRESH_TOKENS,
      JSON.stringify([{ number: 628111, subscriber_id: "s", subscription_type: "PREPAID", refresh_token: "r" }]),
    );
    await storage.putBlob("alice", USER_ACTIVE_NUMBER, "628111");

    await removeRefreshToken(storage, "alice", 628111, clients);
    expect(await listAccounts(storage, "alice")).toHaveLength(0);
    expect(await storage.getBlob("alice", USER_ACTIVE_NUMBER)).toBeNull();
  });
});