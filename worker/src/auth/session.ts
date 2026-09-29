/** Cookie session tokens — compatible with Python itsdangerous URLSafeTimedSerializer. */
import { base64Decode, base64Encode, hexToBytes, utf8Decode, utf8Encode } from "../crypto/encoding";

export const COOKIE_NAME = "mecli_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SESSION_SALT = "webui-session";

function intToBytes(num: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(num / 0x1_0000_0000));
  view.setUint32(4, num >>> 0);
  let bytes = new Uint8Array(buf);
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  return bytes.slice(start);
}

function bytesToInt(bytes: Uint8Array): number {
  const padded = new Uint8Array(8);
  padded.set(bytes, 8 - bytes.length);
  const view = new DataView(padded.buffer);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  return hi * 0x1_0000_0000 + lo;
}

function urlSafeB64Encode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/=+$/g, "");
}

function urlSafeB64Decode(text: string): Uint8Array {
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  return base64Decode(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-1", data);
  return new Uint8Array(digest);
}

async function deriveSigningKey(secretKey: Uint8Array): Promise<Uint8Array> {
  const saltBytes = utf8Encode(SESSION_SALT);
  const signerBytes = utf8Encode("signer");
  const material = new Uint8Array(saltBytes.length + signerBytes.length + secretKey.length);
  material.set(saltBytes, 0);
  material.set(signerBytes, saltBytes.length);
  material.set(secretKey, saltBytes.length + signerBytes.length);
  return sha1(material);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function makeSessionToken(username: string, secretKey: Uint8Array, nowSec?: number): Promise<string> {
  const payloadJson = utf8Encode(JSON.stringify({ u: username.toLowerCase() }));
  const payloadB64 = urlSafeB64Encode(payloadJson);
  const ts = nowSec ?? Math.floor(Date.now() / 1000);
  const tsB64 = urlSafeB64Encode(intToBytes(ts));
  const signed = utf8Encode(`${payloadB64}.${tsB64}`);
  const signingKey = await deriveSigningKey(secretKey);
  const sig = await hmacSha1(signingKey, signed);
  return `${payloadB64}.${tsB64}.${urlSafeB64Encode(sig)}`;
}

export async function parseSessionToken(
  token: string,
  secretKey: Uint8Array,
  maxAgeSec = SESSION_MAX_AGE,
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [payloadB64, tsB64, sigB64] = parts;
  const signed = utf8Encode(`${payloadB64}.${tsB64}`);
  const signingKey = await deriveSigningKey(secretKey);
  const expected = await hmacSha1(signingKey, signed);
  let actual: Uint8Array;
  try {
    actual = urlSafeB64Decode(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, actual)) return null;

  let ts: number;
  try {
    ts = bytesToInt(urlSafeB64Decode(tsB64));
  } catch {
    return null;
  }
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age < 0 || age > maxAgeSec) return null;

  try {
    const payload = JSON.parse(utf8Decode(urlSafeB64Decode(payloadB64))) as { u?: string };
    return payload.u?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function secretKeyFromEnv(env: {
  SESSION_SECRET?: string;
  STORAGE_ENCRYPTION_KEY?: string;
}): Uint8Array {
  const raw = (env.SESSION_SECRET ?? env.STORAGE_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new Error("SESSION_SECRET or STORAGE_ENCRYPTION_KEY required for sessions");
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) return hexToBytes(raw);
  return utf8Encode(raw);
}