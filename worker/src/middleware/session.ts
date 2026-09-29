import type { MiddlewareHandler } from "hono";
import { parseSessionToken } from "../auth/session";
import { ensureUserBootstrap, getUser } from "../auth/users";
import type { AppEnv } from "../types";
import { resolveStorage } from "../storage/resolve";

const PUBLIC_PATHS = [
  "/u/login",
  "/u/register",
  "/u/auth/google",
  "/u/logout",
  "/static/",
  "/favicon",
  "/u/api/",
  "/health",
  "/demo/error",
  "/telegram/webhook",
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const storage = resolveStorage(c.env);
  c.set("storage", storage);

  const token = c.req.raw.headers.get("Cookie")?.match(/(?:^|;\s*)mecli_session=([^;]+)/)?.[1];
  let webuiUser = null;
  if (token) {
    try {
      const secret = await storage.getSessionSecret();
      const username = await parseSessionToken(decodeURIComponent(token), secret);
      if (username) {
        webuiUser = await getUser(storage, username);
        if (webuiUser) await ensureUserBootstrap(storage, webuiUser.username);
      }
    } catch {
      webuiUser = null;
    }
  }
  c.set("webuiUser", webuiUser);

  if (!webuiUser && !isPublicPath(c.req.path)) {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html") || accept === "" || accept === "*/*") {
      const nextPath = encodeURIComponent(c.req.path);
      return c.redirect(`/u/login?next=${nextPath}`, 303);
    }
    return c.text("Unauthorized", 401);
  }

  await next();
};