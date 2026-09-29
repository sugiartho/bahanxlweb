import { GLOBAL_DATA_KEYS, GLOBAL_USERS_REGISTRY, normalizeBlobKey } from "./keys";

export type BlobScope = "user" | "global" | "cli" | "shared";

export interface BlobLocation {
  scope: BlobScope;
  username: string;
  objectKey: string;
  r2Path: string;
}

export function userR2Path(username: string, objectKey: string): string {
  return `users/${username}/${normalizeBlobKey(objectKey)}`;
}

export function globalR2Path(objectKey: string): string {
  return `global/${normalizeBlobKey(objectKey)}`;
}

export function cliR2Path(objectKey: string): string {
  return `cli/${normalizeBlobKey(objectKey)}`;
}

export function sharedR2Path(key: string): string {
  const normalized = normalizeBlobKey(key);
  return normalized.startsWith("shared/") ? normalized : `shared/${normalized}`;
}

/** Map logical blob key to R2 path + D1 index row — mirrors SQLiteBackend._blob_location. */
export function resolveBlobLocation(username: string | null, key: string): BlobLocation | null {
  const normalized = normalizeBlobKey(key);

  if (normalized.startsWith("shared/")) {
    return {
      scope: "shared",
      username: "",
      objectKey: normalized,
      r2Path: sharedR2Path(normalized),
    };
  }

  if (normalized === GLOBAL_USERS_REGISTRY) {
    return null;
  }

  if (username) {
    return {
      scope: "user",
      username,
      objectKey: normalized,
      r2Path: userR2Path(username, normalized),
    };
  }

  if (GLOBAL_DATA_KEYS.has(normalized)) {
    return {
      scope: "global",
      username: "",
      objectKey: normalized,
      r2Path: globalR2Path(normalized),
    };
  }

  return {
    scope: "cli",
    username: "",
    objectKey: normalized,
    r2Path: cliR2Path(normalized),
  };
}