import { base64Decode, base64Encode, utf8Encode } from "../crypto/encoding";

export function urlSafeB64Encode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function urlSafeB64Decode(text: string): Uint8Array {
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  return base64Decode(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-1", data);
  return new Uint8Array(digest);
}

export async function deriveSigningKey(secretKey: Uint8Array, salt: string): Promise<Uint8Array> {
  const saltBytes = utf8Encode(salt);
  const signerBytes = utf8Encode("signer");
  const material = new Uint8Array(saltBytes.length + signerBytes.length + secretKey.length);
  material.set(saltBytes, 0);
  material.set(signerBytes, saltBytes.length);
  material.set(secretKey, saltBytes.length + signerBytes.length);
  return sha1(material);
}

export async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
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

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}