import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { createUser } from "../src/auth/users";
import { resolveStorage } from "../src/storage/resolve";
import { LocalWorkerClient } from "./client";
import {
  MONITOR_POST_ROUTES,
  MYXL_ROUTES,
  PUBLIC_ROUTES,
  WEBUI_ROUTES,
} from "./routes";

const baseEnv: Env = { ENVIRONMENT: "development" };

function client(env: Env = baseEnv): LocalWorkerClient {
  return new LocalWorkerClient(worker.fetch.bind(worker), env);
}

async function createWebuiSession(c: LocalWorkerClient, env: Env = baseEnv): Promise<void> {
  const username = `e2e_${Date.now().toString(36)}`;
  const result = await createUser(resolveStorage(env), username, "secret12");
  if (!result.ok) throw new Error(result.error);
  await c.seedSession(username);
}

describe("e2e local smoke", () => {
  it("health returns ok", async () => {
    const res = await client().get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toContain('"ok":true');
    expect(res.body).toContain("webui-xl");
  });

  it("protected routes redirect anonymous users to login", async () => {
    const res = await client().get("/monitoring");
    expect(res.status).toBe(303);
    expect(res.location).toContain("/u/login");
  });

  it("webui login form sets session cookie and unlocks dashboard redirect", async () => {
    const env: Env = { ENVIRONMENT: "development" };
    const c = client(env);
    const username = `login_${Date.now().toString(36)}`;
    const password = "secret12";
    const created = await createUser(resolveStorage(env), username, password);
    expect(created.ok).toBe(true);

    const login = await c.postForm("/u/login", { username, password, next: "/" });
    expect(login.status).toBe(303);
    expect(login.location).toBe("/");

    const dash = await c.get("/");
    // WebUI session OK — new users without MyXL OTP go to /login, not back to /u/login
    expect(dash.status).toBe(303);
    expect(dash.location ?? "").toContain("/login");
    expect(dash.location ?? "").not.toContain("/u/login");
  });

  it("public pages render", async () => {
    const c = client();
    for (const route of PUBLIC_ROUTES) {
      if (route.path === "/health") continue;
      const res = await c.get(route.path);
      expect(res.status).toBe(route.expectStatus ?? 200);
      if (route.bodyIncludes) expect(res.body).toContain(route.bodyIncludes);
    }
  });

  it("webui session unlocks SSR pages", async () => {
    const c = client();
    await createWebuiSession(c);

    for (const route of WEBUI_ROUTES) {
      const res = await c.get(route.path);
      expect(res.status, route.path).toBe(route.expectStatus ?? 200);
      if (route.bodyIncludes) expect(res.body, route.path).toContain(route.bodyIncludes);
    }
  });

  it("myxl routes redirect or show login without active account", async () => {
    const c = client();
    await createWebuiSession(c);

    for (const route of MYXL_ROUTES) {
      const res = await c.get(route.path);
      expect(res.status, route.path).toBe(route.expectStatus ?? 200);
      if (route.bodyIncludes) expect(res.body, route.path).toContain(route.bodyIncludes);
      if (route.path === "/" && res.status === 303) {
        expect(res.location ?? "").toContain("/login");
      }
    }
  });

  it("monitor POST actions redirect back to dashboard", async () => {
    const c = client();
    await createWebuiSession(c);

    for (const route of MONITOR_POST_ROUTES) {
      const res = await c.postForm(route.path, {});
      expect(res.status, route.path).toBe(303);
      expect(res.location ?? "", route.path).toContain("/monitoring");
    }
  });

  it("telegram webhook rejects missing bot config", async () => {
    const res = await client().request("/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(res.status).toBe(503);
    expect(res.body).toContain("not configured");
  });

  it("telegram webhook enforces secret when configured", async () => {
    const env: Env = {
      ENVIRONMENT: "development",
      TELEGRAM_BOT_TOKEN: "123456:TEST",
      TELEGRAM_WEBHOOK_SECRET: "s3cret",
    };
    const c = client(env);

    const forbidden = await c.request("/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 2 }),
    });
    expect(forbidden.status).toBe(403);

    const ok = await c.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "s3cret",
      },
      body: JSON.stringify({ update_id: 3, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/start" } }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('"ok":true');
  });
});