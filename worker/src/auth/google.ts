import type { Env } from "../env";
import type { StorageBackend } from "../storage/types";
import {
  createGoogleUser,
  getUserByGoogleSub,
  linkGoogleAccount,
  type GoogleProfile,
  type WebuiUserRecord,
} from "./users";

export interface GoogleTokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export function googleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function googleRedirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/u/auth/google/callback`;
}

export function buildGoogleAuthUrl(
  env: Env,
  requestUrl: string,
  state: string,
  intent: "login" | "register" | "link",
): string {
  const clientId = String(env.GOOGLE_CLIENT_ID ?? "").trim();
  const redirectUri = googleRedirectUri(requestUrl);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: intent === "link" ? "consent select_account" : "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  env: Env,
  requestUrl: string,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: String(env.GOOGLE_CLIENT_ID ?? "").trim(),
    client_secret: String(env.GOOGLE_CLIENT_SECRET ?? "").trim(),
    redirect_uri: googleRedirectUri(requestUrl),
    grant_type: "authorization_code",
  });
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await res.json()) as GoogleTokenResponse;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleIdTokenClaims | null> {
  const res = await fetchFn(`${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, string>;
  if (data.aud !== clientId) return null;
  if (data.iss !== "accounts.google.com" && data.iss !== "https://accounts.google.com") return null;
  if (!data.sub) return null;
  return {
    sub: data.sub,
    email: data.email,
    email_verified: data.email_verified === "true",
    name: data.name,
    picture: data.picture,
  };
}

function toProfile(claims: GoogleIdTokenClaims): GoogleProfile {
  return {
    sub: claims.sub,
    email: String(claims.email ?? "").trim().toLowerCase(),
    email_verified: Boolean(claims.email_verified),
    name: claims.name,
  };
}

export async function resolveGoogleAuthUser(
  storage: StorageBackend,
  intent: "login" | "register" | "link",
  claims: GoogleIdTokenClaims,
  linkUsername?: string,
): Promise<{ ok: true; user: WebuiUserRecord } | { ok: false; error: string }> {
  const profile = toProfile(claims);
  if (!profile.email_verified || !profile.email) {
    return { ok: false, error: "Email Google belum terverifikasi." };
  }

  const existing = await getUserByGoogleSub(storage, profile.sub);

  if (intent === "register") {
    if (existing) return { ok: true, user: existing };
    const created = await createGoogleUser(storage, profile);
    if (!created.ok) return created;
    return { ok: true, user: created.user };
  }

  if (intent === "login") {
    if (!existing) {
      return { ok: false, error: "Akun Google belum terdaftar. Daftar dulu lewat halaman Register." };
    }
    return { ok: true, user: existing };
  }

  if (!linkUsername) {
    return { ok: false, error: "Sesi link Google tidak valid. Coba lagi dari halaman Akun." };
  }
  if (existing && existing.username !== linkUsername.toLowerCase()) {
    return { ok: false, error: "Akun Google ini sudah terhubung ke user lain." };
  }
  const linked = await linkGoogleAccount(storage, linkUsername, profile);
  if (!linked.ok) return linked;
  return { ok: true, user: linked.user };
}