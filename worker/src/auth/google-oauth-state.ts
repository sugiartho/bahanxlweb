import { utf8Decode, utf8Encode } from "../crypto/encoding";
import { deriveSigningKey, hmacSha1, timingSafeEqual, urlSafeB64Decode, urlSafeB64Encode } from "./google-oauth-crypto";

export type GoogleOAuthIntent = "login" | "register" | "link";

export interface GoogleOAuthState {
  state: string;
  intent: GoogleOAuthIntent;
  next?: string;
  link_username?: string;
  exp: number;
}

export const GOOGLE_OAUTH_COOKIE = "google_oauth_state";
export const GOOGLE_OAUTH_TTL_SEC = 600;

export async function sealGoogleOAuthState(payload: GoogleOAuthState, secretKey: Uint8Array): Promise<string> {
  const body = urlSafeB64Encode(utf8Encode(JSON.stringify(payload)));
  const signingKey = await deriveSigningKey(secretKey, "google-oauth-state");
  const sig = await hmacSha1(signingKey, utf8Encode(body));
  return `${body}.${urlSafeB64Encode(sig)}`;
}

export async function openGoogleOAuthState(token: string, secretKey: Uint8Array): Promise<GoogleOAuthState | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigB64] = parts;
  const signingKey = await deriveSigningKey(secretKey, "google-oauth-state");
  const expected = await hmacSha1(signingKey, utf8Encode(body));
  let actual: Uint8Array;
  try {
    actual = urlSafeB64Decode(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(utf8Decode(urlSafeB64Decode(body))) as GoogleOAuthState;
    if (!payload?.state || !payload.intent || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}