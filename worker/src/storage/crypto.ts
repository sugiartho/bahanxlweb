/** AES-256-GCM encryption for sensitive storage blobs — mirrors webui/storage/crypto.py */
import { base64Decode, hexToBytes, utf8Decode, utf8Encode } from "../crypto/encoding";

const MAGIC = utf8Encode("ENC1");
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(text));
  return new Uint8Array(digest);
}

function decodeKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty key");
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return hexToBytes(trimmed);
  }
  try {
    const decoded = base64Decode(trimmed);
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through to sha256
  }
  throw new Error("use resolveEncryptionKey for non-hex/base64 keys");
}

export async function resolveEncryptionKey(
  explicit?: string,
  sessionSecret?: Uint8Array,
): Promise<Uint8Array> {
  const envKey = (explicit ?? "").trim();
  if (envKey) {
    try {
      return decodeKey(envKey);
    } catch {
      return sha256Bytes(envKey);
    }
  }
  if (sessionSecret?.length) {
    const digest = await crypto.subtle.digest("SHA-256", sessionSecret);
    return new Uint8Array(digest);
  }
  throw new Error(
    "STORAGE_ENCRYPTION_KEY is required for encrypted storage (or provide sessionSecret for dev fallback)",
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function startsWithMagic(data: Uint8Array): boolean {
  if (data.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) return false;
  }
  return true;
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function isEncrypted(data: Uint8Array): boolean {
  return startsWithMagic(data);
}

export async function encryptBytes(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const aesKey = await importAesKey(key);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: TAG_SIZE * 8 }, aesKey, plaintext),
  );
  const tag = encrypted.slice(-TAG_SIZE);
  const ciphertext = encrypted.slice(0, -TAG_SIZE);
  return concat(MAGIC, nonce, tag, ciphertext);
}

export async function decryptBytes(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (!startsWithMagic(data)) return data;
  const aesKey = await importAesKey(key);
  const offset = MAGIC.length;
  const nonce = data.slice(offset, offset + NONCE_SIZE);
  const tag = data.slice(offset + NONCE_SIZE, offset + NONCE_SIZE + TAG_SIZE);
  const ciphertext = data.slice(offset + NONCE_SIZE + TAG_SIZE);
  const ctWithTag = concat(ciphertext, tag);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_SIZE * 8 },
    aesKey,
    ctWithTag,
  );
  return new Uint8Array(plain);
}

export async function encryptText(plaintext: string, key: Uint8Array): Promise<Uint8Array> {
  return encryptBytes(utf8Encode(plaintext), key);
}

export async function decryptText(data: Uint8Array, key: Uint8Array): Promise<string> {
  return utf8Decode(await decryptBytes(data, key));
}