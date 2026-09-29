import { Hono } from "hono";
import { COOKIE_NAME, SESSION_MAX_AGE, makeSessionToken } from "../auth/session";
import {
  GOOGLE_OAUTH_COOKIE,
  GOOGLE_OAUTH_TTL_SEC,
  openGoogleOAuthState,
  randomOAuthState,
  sealGoogleOAuthState,
  type GoogleOAuthIntent,
} from "../auth/google-oauth-state";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOAuthConfigured,
  resolveGoogleAuthUser,
  verifyGoogleIdToken,
} from "../auth/google";
import { getTheme, loadUsers } from "../auth/users";
import { requireWebuiUser } from "../myxl/require";
import type { AppEnv } from "../types";

function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

function setSessionCookie(c: { req: { url: string }; header: (name: string, value: string) => void }, token: string) {
  const secure = new URL(c.req.url).protocol === "https:";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${SESSION_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

function setOAuthStateCookie(
  c: { req: { url: string }; header: (name: string, value: string) => void },
  token: string,
) {
  const secure = new URL(c.req.url).protocol === "https:";
  const parts = [
    `${GOOGLE_OAUTH_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${GOOGLE_OAUTH_TTL_SEC}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

function clearOAuthStateCookie(c: { header: (name: string, value: string) => void }) {
  c.header("Set-Cookie", `${GOOGLE_OAUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function parseIntent(raw: string | undefined): GoogleOAuthIntent {
  if (raw === "register" || raw === "link") return raw;
  return "login";
}

function authErrorRedirect(path: string, error: string, next = "/"): string {
  const url = new URL(path, "http://local");
  url.searchParams.set("error", error);
  if (path === "/u/login") url.searchParams.set("next", next);
  return `${url.pathname}${url.search}`;
}

export const googleAuth = new Hono<AppEnv>();

googleAuth.get("/u/auth/google", async (c) => {
  if (!googleOAuthConfigured(c.env)) {
    return c.redirect(authErrorRedirect("/u/login", "Google login belum dikonfigurasi."), 303);
  }

  const intent = parseIntent(c.req.query("intent"));
  const next = safeNext(c.req.query("next"));
  const storage = c.get("storage");

  let linkUsername: string | undefined;
  if (intent === "link") {
    const webuiUser = requireWebuiUser(c);
    if (webuiUser instanceof Response) return webuiUser;
    linkUsername = webuiUser.username;
  }

  const state = randomOAuthState();
  const secret = await storage.getSessionSecret();
  const sealed = await sealGoogleOAuthState(
    {
      state,
      intent,
      next,
      link_username: linkUsername,
      exp: Math.floor(Date.now() / 1000) + GOOGLE_OAUTH_TTL_SEC,
    },
    secret,
  );
  setOAuthStateCookie(c, sealed);
  return c.redirect(buildGoogleAuthUrl(c.env, c.req.url, state, intent), 303);
});

googleAuth.get("/u/auth/google/callback", async (c) => {
  const storage = c.get("storage");
  const url = new URL(c.req.url);
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const cookieRaw = c.req.header("Cookie")?.match(/(?:^|;\s*)google_oauth_state=([^;]+)/)?.[1];
  clearOAuthStateCookie(c);

  const fallbackPath = "/u/login";
  if (oauthError) {
    return c.redirect(authErrorRedirect(fallbackPath, "Login Google dibatalkan."), 303);
  }
  if (!code || !state || !cookieRaw) {
    return c.redirect(authErrorRedirect(fallbackPath, "Sesi Google tidak valid. Coba lagi."), 303);
  }

  const secret = await storage.getSessionSecret();
  const payload = await openGoogleOAuthState(decodeURIComponent(cookieRaw), secret);
  if (!payload || payload.state !== state) {
    return c.redirect(authErrorRedirect(fallbackPath, "State Google tidak cocok. Coba lagi."), 303);
  }

  const tokenRes = await exchangeGoogleCode(c.env, c.req.url, code);
  if (!tokenRes.id_token) {
    return c.redirect(
      authErrorRedirect(
        payload.intent === "register" ? "/u/register" : fallbackPath,
        tokenRes.error_description ?? "Gagal menukar kode Google.",
        payload.next ?? "/",
      ),
      303,
    );
  }

  const claims = await verifyGoogleIdToken(tokenRes.id_token, String(c.env.GOOGLE_CLIENT_ID ?? "").trim());
  if (!claims) {
    return c.redirect(authErrorRedirect(fallbackPath, "Token Google tidak valid."), 303);
  }

  const resolved = await resolveGoogleAuthUser(
    storage,
    payload.intent,
    claims,
    payload.link_username,
  );

  if (!resolved.ok) {
    const path = payload.intent === "register" ? "/u/register" : payload.intent === "link" ? "/u/account" : fallbackPath;
    const redirect = payload.intent === "link"
      ? "/u/account?error=" + encodeURIComponent(resolved.error)
      : authErrorRedirect(path, resolved.error, payload.next ?? "/");
    return c.redirect(redirect, 303);
  }

  if (payload.intent === "link") {
    return c.redirect("/u/account?msg=google_linked", 303);
  }

  const sessionToken = await makeSessionToken(resolved.user.username, secret);
  setSessionCookie(c, sessionToken);
  return c.redirect(safeNext(payload.next), 303);
});

export async function loginPageExtras(c: { env: AppEnv["Bindings"]; get: (key: "storage") => AppEnv["Variables"]["storage"] }, mode: "login" | "register") {
  const storage = c.get("storage");
  return {
    google_enabled: googleOAuthConfigured(c.env),
    google_auth_url: `/u/auth/google?intent=${mode === "register" ? "register" : "login"}`,
    users_count: (await loadUsers(storage)).length,
    user_theme: getTheme(null),
  };
}

