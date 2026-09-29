import { Hono, type Context } from "hono";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  makeSessionToken,
} from "../auth/session";
import {
  authenticate,
  changePassword,
  getTheme,
  hasGoogleLogin,
  hasPasswordLogin,
  setInitialPassword,
} from "../auth/users";
import { googleOAuthConfigured } from "../auth/google";
import { htmlResponse, renderWebuiLogin } from "../ssr";
import { renderWebuiPage, requireWebuiUser } from "../myxl/require";
import type { AppEnv } from "../types";
import { googleAuth, loginPageExtras } from "./google-auth";

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

function clearSessionCookie(c: { header: (name: string, value: string) => void }) {
  c.header("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

export const webuiAuth = new Hono<AppEnv>();

webuiAuth.route("/", googleAuth);

webuiAuth.get("/u/login", async (c) => {
  const url = new URL(c.req.url);
  const extras = await loginPageExtras(c, "login");
  const html = renderWebuiLogin(c.req.raw, {
    mode: "login",
    error: url.searchParams.get("error") ?? undefined,
    info: url.searchParams.get("info") ?? undefined,
    username: url.searchParams.get("username") ?? undefined,
    next: safeNext(url.searchParams.get("next") ?? "/"),
    ...extras,
    user_theme: getTheme(c.get("webuiUser")),
  });
  return htmlResponse(html);
});

webuiAuth.post("/u/login", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  const next = safeNext(String(body.next ?? "/"));
  const storage = c.get("storage");
  const extras = await loginPageExtras(c, "login");

  const user = await authenticate(storage, username, password);
  if (!user) {
    const html = renderWebuiLogin(c.req.raw, {
      mode: "login",
      error: "Username atau password salah.",
      username,
      next,
      ...extras,
      user_theme: getTheme(c.get("webuiUser")),
    });
    return htmlResponse(html, 401);
  }

  const token = await makeSessionToken(user.username, await storage.getSessionSecret());
  setSessionCookie(c, token);
  return c.redirect(next, 303);
});

webuiAuth.get("/u/register", async (c) => {
  const url = new URL(c.req.url);
  const extras = await loginPageExtras(c, "register");
  const html = renderWebuiLogin(c.req.raw, {
    mode: "register",
    error: url.searchParams.get("error") ?? undefined,
    info: url.searchParams.get("info") ?? undefined,
    ...extras,
    user_theme: getTheme(c.get("webuiUser")),
  });
  return htmlResponse(html);
});

webuiAuth.post("/u/register", (c) => {
  const next = safeNext(String(c.req.query("next") ?? "/"));
  return c.redirect(`/u/auth/google?intent=register&next=${encodeURIComponent(next)}`, 303);
});

const logoutHandler = (c: Context<AppEnv>) => {
  clearSessionCookie(c);
  return c.redirect("/u/login", 303);
};

webuiAuth.get("/u/logout", logoutHandler);
webuiAuth.post("/u/logout", logoutHandler);

webuiAuth.get("/u/account", (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const url = new URL(c.req.url);
  const msg = url.searchParams.get("msg") ?? "";
  let success: string | undefined;
  if (msg === "ok") success = "Password berhasil diubah.";
  else if (msg === "google_linked") success = "Akun Google berhasil dihubungkan.";
  else if (msg === "password_set") success = "Password berhasil di-set.";

  return renderWebuiPage(c, webuiUser, "webui_account", {
    page_title: "Akun WebUI · WebUI-XL",
    username: webuiUser.username,
    email: webuiUser.email ?? webuiUser.google_email ?? "",
    has_email: Boolean(webuiUser.email ?? webuiUser.google_email),
    has_telegram: webuiUser.telegram_chat_id != null,
    telegram_chat_id: webuiUser.telegram_chat_id ?? "",
    has_google: hasGoogleLogin(webuiUser),
    google_email: webuiUser.google_email ?? "",
    has_password: hasPasswordLogin(webuiUser),
    google_enabled: googleOAuthConfigured(c.env),
    success,
    error: url.searchParams.get("error") ?? undefined,
  });
});

webuiAuth.post("/u/account/password", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.new_password ?? "");
  const newPasswordConfirm = String(body.new_password_confirm ?? "");
  const storage = c.get("storage");

  if (newPassword !== newPasswordConfirm) {
    return renderWebuiPage(c, webuiUser, "webui_account", {
      page_title: "Akun WebUI · WebUI-XL",
      username: webuiUser.username,
      email: webuiUser.email ?? webuiUser.google_email ?? "",
      has_email: Boolean(webuiUser.email ?? webuiUser.google_email),
      has_telegram: webuiUser.telegram_chat_id != null,
      telegram_chat_id: webuiUser.telegram_chat_id ?? "",
      has_google: hasGoogleLogin(webuiUser),
      google_email: webuiUser.google_email ?? "",
      has_password: hasPasswordLogin(webuiUser),
      google_enabled: googleOAuthConfigured(c.env),
      error: "Password baru tidak cocok.",
    });
  }

  const result = hasPasswordLogin(webuiUser)
    ? await changePassword(storage, webuiUser.username, currentPassword, newPassword)
    : await setInitialPassword(storage, webuiUser.username, newPassword);

  if (!result.ok) {
    return renderWebuiPage(c, webuiUser, "webui_account", {
      page_title: "Akun WebUI · WebUI-XL",
      username: webuiUser.username,
      email: webuiUser.email ?? webuiUser.google_email ?? "",
      has_email: Boolean(webuiUser.email ?? webuiUser.google_email),
      has_telegram: webuiUser.telegram_chat_id != null,
      telegram_chat_id: webuiUser.telegram_chat_id ?? "",
      has_google: hasGoogleLogin(webuiUser),
      google_email: webuiUser.google_email ?? "",
      has_password: hasPasswordLogin(webuiUser),
      google_enabled: googleOAuthConfigured(c.env),
      error: result.error,
    });
  }

  return c.redirect(`/u/account?msg=${hasPasswordLogin(webuiUser) ? "ok" : "password_set"}`, 303);
});