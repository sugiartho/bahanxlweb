import type { CircleClient } from "../clients/circle";
import type { MyXlClientConfig } from "../clients/config";
import type { CiamClient, TokenResponse } from "../clients/ciam";
import type { EngselClient } from "../clients/engsel";
import type { FamplanClient } from "../clients/famplan";
import type { RegistrationClient } from "../clients/registration";
import { USER_ACTIVE_NUMBER, USER_MYXL_META, USER_REFRESH_TOKENS } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "./blob";

const RENEW_INTERVAL_SEC = 300;

export interface RefreshTokenEntry {
  number: number;
  subscriber_id: string;
  subscription_type: string;
  refresh_token: string;
}

export interface MyXlTokens {
  refresh_token: string;
  access_token: string;
  id_token: string;
}

export interface ActiveUser {
  number: number;
  subscriber_id: string;
  subscription_type: string;
  tokens: MyXlTokens;
}

interface MyXlMeta {
  lastRefresh: number;
}

export interface MyXlClients {
  config: MyXlClientConfig;
  ciam: CiamClient;
  engsel: EngselClient;
  famplan: FamplanClient;
  circle: CircleClient;
  registration: RegistrationClient;
}

async function readJson<T>(storage: StorageBackend, username: string, key: string, fallback: T): Promise<T> {
  const raw = await getTextBlob(storage, username, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(storage: StorageBackend, username: string, key: string, data: unknown): Promise<void> {
  await storage.putBlob(username, key, JSON.stringify(data));
}

function toTokens(res: TokenResponse): MyXlTokens {
  return {
    refresh_token: res.refresh_token,
    access_token: res.access_token,
    id_token: res.id_token,
  };
}

async function profileMeta(
  engsel: EngselClient,
  tokens: MyXlTokens,
): Promise<{ subscriber_id: string; subscription_type: string }> {
  const data = await engsel.getProfile(tokens.access_token, tokens.id_token);
  const profile = (data?.profile as Record<string, unknown> | undefined) ?? {};
  return {
    subscriber_id: String(profile.subscriber_id ?? ""),
    subscription_type: String(profile.subscription_type ?? "PREPAID"),
  };
}

export async function loadRefreshTokens(
  storage: StorageBackend,
  username: string,
): Promise<RefreshTokenEntry[]> {
  const list = await readJson<RefreshTokenEntry[]>(storage, username, USER_REFRESH_TOKENS, []);
  if (!Array.isArray(list)) return [];
  return list.filter((rt) => rt?.number != null && rt.refresh_token);
}

export async function saveRefreshTokens(
  storage: StorageBackend,
  username: string,
  tokens: RefreshTokenEntry[],
): Promise<void> {
  await writeJson(storage, username, USER_REFRESH_TOKENS, tokens);
}

export async function listAccounts(storage: StorageBackend, username: string): Promise<RefreshTokenEntry[]> {
  return loadRefreshTokens(storage, username);
}

async function loadMeta(storage: StorageBackend, username: string): Promise<MyXlMeta> {
  return readJson<MyXlMeta>(storage, username, USER_MYXL_META, { lastRefresh: 0 });
}

async function touchMeta(storage: StorageBackend, username: string): Promise<void> {
  await writeJson(storage, username, USER_MYXL_META, { lastRefresh: Math.floor(Date.now() / 1000) });
}

async function refreshTokens(
  ciam: CiamClient,
  refreshToken: string,
  subscriberId: string,
): Promise<MyXlTokens | null> {
  const res = await ciam.refreshToken(refreshToken, subscriberId);
  return res ? toTokens(res) : null;
}

export async function setActiveUser(
  storage: StorageBackend,
  username: string,
  number: number,
  clients: MyXlClients,
): Promise<boolean> {
  const entries = await loadRefreshTokens(storage, username);
  const entry = entries.find((rt) => rt.number === number);
  if (!entry) return false;

  const tokens = await refreshTokens(clients.ciam, entry.refresh_token, entry.subscriber_id ?? "");
  if (!tokens) {
    await removeRefreshToken(storage, username, number, clients);
    return false;
  }

  const meta = await profileMeta(clients.engsel, tokens);
  entry.subscriber_id = meta.subscriber_id || entry.subscriber_id;
  entry.subscription_type = meta.subscription_type || entry.subscription_type;
  entry.refresh_token = tokens.refresh_token;
  await saveRefreshTokens(storage, username, entries);
  await storage.putBlob(username, USER_ACTIVE_NUMBER, String(number));
  await touchMeta(storage, username);
  return true;
}

export async function addRefreshToken(
  storage: StorageBackend,
  username: string,
  number: number,
  refreshToken: string,
  clients: MyXlClients,
): Promise<void> {
  const entries = await loadRefreshTokens(storage, username);
  const existing = entries.find((rt) => rt.number === number);
  if (existing) {
    existing.refresh_token = refreshToken;
    await saveRefreshTokens(storage, username, entries);
    await setActiveUser(storage, username, number, clients);
    return;
  }

  const tokens = await refreshTokens(clients.ciam, refreshToken, "");
  if (!tokens) throw new Error("Failed to exchange refresh token");

  const meta = await profileMeta(clients.engsel, tokens);
  entries.push({
    number,
    subscriber_id: meta.subscriber_id,
    subscription_type: meta.subscription_type,
    refresh_token: tokens.refresh_token,
  });
  await saveRefreshTokens(storage, username, entries);
  await setActiveUser(storage, username, number, clients);
}

export async function removeRefreshToken(
  storage: StorageBackend,
  username: string,
  number: number,
  clients: MyXlClients,
): Promise<void> {
  const entries = (await loadRefreshTokens(storage, username)).filter((rt) => rt.number !== number);
  await saveRefreshTokens(storage, username, entries);

  const activeRaw = await getTextBlob(storage, username, USER_ACTIVE_NUMBER);
  const activeNum = activeRaw?.trim() ? Number.parseInt(activeRaw.trim(), 10) : null;

  if (activeNum === number) {
    await storage.deleteBlob(username, USER_ACTIVE_NUMBER);
    if (entries.length > 0) {
      await setActiveUser(storage, username, entries[0].number, clients);
    }
  }
}

async function buildActiveUser(
  storage: StorageBackend,
  username: string,
  number: number,
  entry: RefreshTokenEntry,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  const tokens = await refreshTokens(clients.ciam, entry.refresh_token, entry.subscriber_id ?? "");
  if (!tokens) {
    await removeRefreshToken(storage, username, number, clients);
    return null;
  }

  const meta = await profileMeta(clients.engsel, tokens);
  entry.subscriber_id = meta.subscriber_id || entry.subscriber_id;
  entry.subscription_type = meta.subscription_type || entry.subscription_type;
  entry.refresh_token = tokens.refresh_token;
  const entries = await loadRefreshTokens(storage, username);
  const idx = entries.findIndex((rt) => rt.number === number);
  if (idx >= 0) entries[idx] = entry;
  await saveRefreshTokens(storage, username, entries);

  await touchMeta(storage, username);
  return {
    number,
    subscriber_id: entry.subscriber_id,
    subscription_type: entry.subscription_type,
    tokens,
  };
}

async function renewActiveIfStale(
  storage: StorageBackend,
  username: string,
  active: ActiveUser,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  const meta = await loadMeta(storage, username);
  const now = Math.floor(Date.now() / 1000);
  if (meta.lastRefresh && now - meta.lastRefresh < RENEW_INTERVAL_SEC) return active;

  const entries = await loadRefreshTokens(storage, username);
  const entry = entries.find((rt) => rt.number === active.number);
  if (!entry) return null;
  return buildActiveUser(storage, username, active.number, entry, clients);
}

export async function getActiveUser(
  storage: StorageBackend,
  username: string,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  const entries = await loadRefreshTokens(storage, username);
  if (entries.length === 0) return null;

  let number: number | null = null;
  const activeRaw = await getTextBlob(storage, username, USER_ACTIVE_NUMBER);
  if (activeRaw?.trim() && /^\d+$/.test(activeRaw.trim())) {
    number = Number.parseInt(activeRaw.trim(), 10);
  }

  let entry = number != null ? entries.find((rt) => rt.number === number) : undefined;
  if (!entry) entry = entries[0];

  let active = await buildActiveUser(storage, username, entry.number, entry, clients);
  if (!active) return null;

  if (number !== entry.number) {
    await storage.putBlob(username, USER_ACTIVE_NUMBER, String(entry.number));
  }

  active = (await renewActiveIfStale(storage, username, active, clients)) ?? active;
  return active;
}

/** Active account metadata without token refresh — for login/accounts list UI. */
export async function getActiveUserDisplay(
  storage: StorageBackend,
  username: string,
): Promise<RefreshTokenEntry | null> {
  const accounts = await listAccounts(storage, username);
  const activeRaw = await getTextBlob(storage, username, USER_ACTIVE_NUMBER);
  if (!activeRaw?.trim() || !/^\d+$/.test(activeRaw.trim())) return null;
  const num = Number.parseInt(activeRaw.trim(), 10);
  return accounts.find((a) => a.number === num) ?? null;
}

export async function getActiveUserSafe(
  storage: StorageBackend,
  username: string,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  try {
    return await getActiveUser(storage, username, clients);
  } catch {
    return null;
  }
}

/** Always refresh CIAM tokens — required before payment signatures. */
export async function refreshActiveUserForPurchase(
  storage: StorageBackend,
  username: string,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  const entries = await loadRefreshTokens(storage, username);
  if (!entries.length) return null;

  let number: number | null = null;
  const activeRaw = await getTextBlob(storage, username, USER_ACTIVE_NUMBER);
  if (activeRaw?.trim() && /^\d+$/.test(activeRaw.trim())) {
    number = Number.parseInt(activeRaw.trim(), 10);
  }

  const entry = (number != null ? entries.find((rt) => rt.number === number) : undefined) ?? entries[0];
  try {
    return await buildActiveUser(storage, username, entry.number, entry, clients);
  } catch {
    return null;
  }
}

/** Load tokens for a specific MSISDN without changing the active account. */
export async function getAccountForMsisdn(
  storage: StorageBackend,
  username: string,
  msisdn: number,
  clients: MyXlClients,
): Promise<ActiveUser | null> {
  const entries = await loadRefreshTokens(storage, username);
  const entry = entries.find((rt) => rt.number === msisdn);
  if (!entry) return null;
  try {
    return await buildActiveUser(storage, username, msisdn, entry, clients);
  } catch {
    return null;
  }
}