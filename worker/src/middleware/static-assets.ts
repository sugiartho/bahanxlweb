import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** Serve worker/static via ASSETS binding at /static/* (matches Python FastAPI mount). */
export const staticAssetsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  if (!path.startsWith("/static/")) {
    await next();
    return;
  }

  const assets = c.env.ASSETS;
  if (!assets) {
    await next();
    return;
  }

  const url = new URL(c.req.url);
  url.pathname = path.slice("/static".length) || "/";
  const response = await assets.fetch(new Request(url.toString(), c.req.raw));
  if (response.status === 404) {
    await next();
    return;
  }
  return response;
};