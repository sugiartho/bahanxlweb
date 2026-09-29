import { USER_OTP_PENDING } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "./blob";

const OTP_TTL_SEC = 300;

export interface OtpPendingState {
  phone: string;
  subscriberId: string;
  createdAt: number;
}

export async function loadOtpPending(storage: StorageBackend, username: string): Promise<OtpPendingState | null> {
  const raw = await getTextBlob(storage, username, USER_OTP_PENDING);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OtpPendingState;
    if (!parsed.phone || !parsed.subscriberId || !parsed.createdAt) return null;
    if (Date.now() / 1000 - parsed.createdAt > OTP_TTL_SEC) {
      await clearOtpPending(storage, username);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveOtpPending(
  storage: StorageBackend,
  username: string,
  phone: string,
  subscriberId: string,
): Promise<void> {
  const state: OtpPendingState = { phone, subscriberId, createdAt: Math.floor(Date.now() / 1000) };
  await storage.putBlob(username, USER_OTP_PENDING, JSON.stringify(state));
}

export async function clearOtpPending(storage: StorageBackend, username: string): Promise<void> {
  await storage.deleteBlob(username, USER_OTP_PENDING);
}

export function isOtpPendingForPhone(state: OtpPendingState | null, phone: string | undefined): boolean {
  return Boolean(state && phone && state.phone === phone.trim());
}