export interface WebUIUser {
  username: string;
  password_hash: string;
  created_at: number;
  theme?: string;
  telegram_chat_id?: number | null;
  email?: string | null;
  google_sub?: string | null;
  google_email?: string | null;
}

export interface StorageBindings {
  DB: D1Database;
  DATA?: R2Bucket;
  STORAGE_ENCRYPTION_KEY?: string;
  SESSION_SECRET?: string;
}

export interface StorageBackend {
  loadUsers(): Promise<WebUIUser[]>;
  findUserByTelegramChatId(chatId: number): Promise<WebUIUser | null>;
  findUserByGoogleSub(googleSub: string): Promise<WebUIUser | null>;
  saveUsers(users: WebUIUser[]): Promise<void>;
  createTelegramLinkCode(username: string, ttlSec?: number): Promise<string>;
  consumeTelegramLinkCode(code: string): Promise<string | null>;
  getSessionSecret(): Promise<Uint8Array>;
  ensureUserDir(username: string): Promise<void>;
  getBlob(
    username: string | null,
    key: string,
    options?: { binary?: boolean },
  ): Promise<string | Uint8Array | null>;
  putBlob(
    username: string | null,
    key: string,
    data: string | Uint8Array,
    options?: { binary?: boolean },
  ): Promise<void>;
  deleteBlob(username: string | null, key: string): Promise<void>;
  blobExists(username: string | null, key: string): Promise<boolean>;
  listBlobs(username: string | null, prefix?: string): Promise<string[]>;
}