import { USER_QUOTA_CACHE } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import type { QuotaCache, QuotaCacheEntry } from "./types";

async function readCache(storage: StorageBackend, username: string): Promise<QuotaCache> {
  const raw = await getTextBlob(storage, username, USER_QUOTA_CACHE);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as QuotaCache;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function loadQuotaCache(storage: StorageBackend, username: string): Promise<QuotaCache> {
  return readCache(storage, username);
}

export async function saveQuotaCache(
  storage: StorageBackend,
  username: string,
  cache: QuotaCache,
): Promise<void> {
  await storage.putBlob(username, USER_QUOTA_CACHE, JSON.stringify(cache, null, 2));
}

export async function updateAccountCache(
  storage: StorageBackend,
  username: string,
  msisdn: number,
  balance: Record<string, unknown> | null,
  quotas: Record<string, unknown>[] | null,
): Promise<void> {
  const cache = await readCache(storage, username);
  cache[String(msisdn)] = {
    updated_at: Math.floor(Date.now() / 1000),
    balance,
    quotas,
  };
  await saveQuotaCache(storage, username, cache);
}

export function cacheEntries(cache: QuotaCache): Array<{ msisdn: string; data: QuotaCacheEntry }> {
  return Object.entries(cache).map(([msisdn, data]) => ({ msisdn, data }));
}