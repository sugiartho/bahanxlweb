/** In-memory StorageBackend for local dev when D1/R2 bindings are absent. */
import { utf8Decode, utf8Encode } from "../crypto/encoding";
import { decryptBytes, encryptBytes, resolveEncryptionKey } from "./crypto";
import { isEncryptedKey } from "./keys";
import type { StorageBackend, WebUIUser } from "./types";

type LinkCodeRow = { username: string; expires_at: number; created_at: number };

export class MemoryStorageBackend implements StorageBackend {
  users: WebUIUser[] = [];
  private sessionSecret: Uint8Array | null = null;
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly linkCodes = new Map<string, LinkCodeRow>();
  private readonly encryptAtRest = true;

  private blobKey(username: string | null, key: string): string {
    return `${username ?? ""}:${key}`;
  }

  private async encryptionKey(): Promise<Uint8Array> {
    return resolveEncryptionKey(undefined, await this.getSessionSecret());
  }

  private async maybeDecrypt(objectKey: string, raw: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptAtRest || !isEncryptedKey(objectKey)) return raw;
    try {
      return await decryptBytes(raw, await this.encryptionKey());
    } catch {
      return raw;
    }
  }

  private async maybeEncrypt(objectKey: string, raw: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptAtRest || !isEncryptedKey(objectKey)) return raw;
    return encryptBytes(raw, await this.encryptionKey());
  }

  async loadUsers(): Promise<WebUIUser[]> {
    return this.users.map((u) => ({ ...u }));
  }

  async findUserByTelegramChatId(chatId: number): Promise<WebUIUser | null> {
    const user = this.users.find((u) => u.telegram_chat_id === chatId);
    return user ? { ...user } : null;
  }

  async findUserByGoogleSub(googleSub: string): Promise<WebUIUser | null> {
    const user = this.users.find((u) => u.google_sub === googleSub);
    return user ? { ...user } : null;
  }

  async createTelegramLinkCode(username: string, ttlSec = 600): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    this.linkCodes.set(code, {
      username: username.toLowerCase().trim(),
      expires_at: now + ttlSec,
      created_at: now,
    });
    return code;
  }

  async consumeTelegramLinkCode(code: string): Promise<string | null> {
    const normalized = String(code ?? "").trim().toUpperCase();
    const row = this.linkCodes.get(normalized);
    if (!row) return null;
    this.linkCodes.delete(normalized);
    if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
    return row.username;
  }

  async saveUsers(users: WebUIUser[]): Promise<void> {
    this.users = users.map((u) => ({ ...u }));
  }

  async getSessionSecret(): Promise<Uint8Array> {
    if (this.sessionSecret) return this.sessionSecret;
    this.sessionSecret = crypto.getRandomValues(new Uint8Array(32));
    return this.sessionSecret;
  }

  async ensureUserDir(_username: string): Promise<void> {}

  async getBlob(
    username: string | null,
    key: string,
    options: { binary?: boolean } = {},
  ): Promise<string | Uint8Array | null> {
    const raw = this.blobs.get(this.blobKey(username, key));
    if (!raw) return null;
    const plain = await this.maybeDecrypt(key, raw);
    if (options.binary) return plain;
    return utf8Decode(plain);
  }

  async putBlob(
    username: string | null,
    key: string,
    data: string | Uint8Array,
    _options: { binary?: boolean } = {},
  ): Promise<void> {
    const payload = typeof data === "string" ? utf8Encode(data) : data;
    const stored = await this.maybeEncrypt(key, payload);
    this.blobs.set(this.blobKey(username, key), stored);
  }

  async deleteBlob(username: string | null, key: string): Promise<void> {
    this.blobs.delete(this.blobKey(username, key));
  }

  async blobExists(username: string | null, key: string): Promise<boolean> {
    return this.blobs.has(this.blobKey(username, key));
  }

  async listBlobs(username: string | null, prefix = ""): Promise<string[]> {
    const prefixKey = `${username ?? ""}:${prefix}`;
    const keys: string[] = [];
    for (const mapKey of this.blobs.keys()) {
      if (mapKey.startsWith(prefixKey)) {
        keys.push(mapKey.slice((username ?? "").length + 1));
      }
    }
    return keys.sort();
  }
}