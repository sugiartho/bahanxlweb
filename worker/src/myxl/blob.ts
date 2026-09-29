import type { StorageBackend } from "../storage/types";

export async function getTextBlob(
  storage: StorageBackend,
  username: string | null,
  key: string,
): Promise<string | null> {
  const raw = await storage.getBlob(username, key);
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  return new TextDecoder().decode(raw);
}