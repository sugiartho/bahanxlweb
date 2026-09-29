import type { Env } from "../env";
import { D1R2Backend } from "./d1r2-backend";
import { MemoryStorageBackend } from "./memory-backend";
import type { StorageBackend } from "./types";

let devSingleton: MemoryStorageBackend | null = null;

export function resolveStorage(env: Env): StorageBackend {
  if (env.DB) {
    return new D1R2Backend({
      DB: env.DB,
      DATA: env.DATA,
      STORAGE_ENCRYPTION_KEY: env.STORAGE_ENCRYPTION_KEY,
      SESSION_SECRET: env.SESSION_SECRET,
    });
  }

  if ((env.ENVIRONMENT ?? "development") === "development") {
    if (!devSingleton) devSingleton = new MemoryStorageBackend();
    return devSingleton;
  }

  throw new Error("Storage binding DB is required outside development");
}