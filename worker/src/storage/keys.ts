/** Blob key constants — mirrors webui/storage/backend.py */

export const GLOBAL_TELEGRAM_CONFIG = "telegram.json";
export const GLOBAL_SESSION_SECRET = "session.secret";
export const GLOBAL_USERS_REGISTRY = "users.json";
export const GLOBAL_MONITOR_DAILY_SUMMARY = "monitor-daily-summary.json";

export const GLOBAL_DATA_KEYS = new Set([
  GLOBAL_TELEGRAM_CONFIG,
  GLOBAL_SESSION_SECRET,
  GLOBAL_USERS_REGISTRY,
  GLOBAL_MONITOR_DAILY_SUMMARY,
]);

export const USER_REFRESH_TOKENS = "refresh-tokens.json";
export const USER_OTP_PENDING = "otp-pending.json";
export const USER_MYXL_META = "myxl-meta.json";
export const USER_ACTIVE_NUMBER = "active.number";
export const USER_AX_FP = "ax.fp";
export const USER_BOOKMARK = "bookmark.json";
export const USER_QUOTA_CACHE = "quota_cache.json";
export const USER_MONITORING = "monitoring.json";
export const USER_MONITOR_LOG = "monitor.log";
export const USER_TELEGRAM = "telegram.json";
export const USER_DECOY_DIR = "decoy_data";

export const ENCRYPTED_BLOB_KEYS = new Set([
  USER_REFRESH_TOKENS,
  USER_OTP_PENDING,
  USER_MYXL_META,
  USER_ACTIVE_NUMBER,
  USER_AX_FP,
  USER_BOOKMARK,
  USER_QUOTA_CACHE,
  USER_MONITORING,
  USER_MONITOR_LOG,
  USER_TELEGRAM,
  GLOBAL_TELEGRAM_CONFIG,
]);

export const SHARED_HOT = "shared/hot.json";
export const SHARED_HOT2 = "shared/hot2.json";

export function normalizeBlobKey(key: string): string {
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isEncryptedKey(key: string): boolean {
  const normalized = normalizeBlobKey(key);
  if (ENCRYPTED_BLOB_KEYS.has(normalized)) return true;
  if (normalized.startsWith(`${USER_DECOY_DIR}/`)) return true;
  return false;
}