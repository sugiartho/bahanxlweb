import { utf8Encode } from "../crypto/encoding";

/** Legacy VPS/Python hashes use 200k; Worker free tier CPU budget ~10ms — use 10k for new hashes. */
export const PBKDF2_ITERS_LEGACY = 200_000;
export const PBKDF2_ITERS_WORKER = 10_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERS_WORKER,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${bytesToHex(salt)}$${bytesToHex(dk)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algo, itersStr, saltHex, hashHex] = encoded.split("$");
    if (algo !== "pbkdf2_sha256") return false;
    const iters = Number.parseInt(itersStr, 10);
    if (iters <= 0 || iters > PBKDF2_ITERS_LEGACY) return false;
    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(hashHex);
    const dk = await pbkdf2(password, salt, iters);
    return timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}