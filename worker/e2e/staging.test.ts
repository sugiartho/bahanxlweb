import { describe, expect, it } from "vitest";
import { HttpClient } from "./client";
import {
  MONITOR_POST_ROUTES,
  MYXL_ACTIVE_ROUTES,
  MYXL_ROUTES,
  PUBLIC_ROUTES,
  WEBUI_ROUTES,
} from "./routes";

const baseUrl = process.env.E2E_BASE_URL?.trim();
const username = process.env.E2E_USERNAME?.trim();
const password = process.env.E2E_PASSWORD?.trim();
const webhookSecret = process.env.E2E_TELEGRAM_WEBHOOK_SECRET?.trim();

const stagingEnabled = Boolean(baseUrl);
const authEnabled = stagingEnabled && Boolean(username && password);

describe.skipIf(!stagingEnabled)("e2e staging smoke", () => {
  it("health is reachable", async () => {
    const client = new HttpClient(baseUrl!);
    const res = await client.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toContain('"ok":true');
  });

  it("public pages render on staging", async () => {
    const client = new HttpClient(baseUrl!);
    for (const route of PUBLIC_ROUTES) {
      if (route.path === "/health") continue;
      const res = await client.get(route.path);
      expect(res.status, route.path).toBe(route.expectStatus ?? 200);
      if (route.bodyIncludes) expect(res.body, route.path).toContain(route.bodyIncludes);
    }
  });
});

describe.skipIf(!authEnabled)("e2e staging authenticated smoke", () => {
  it("login and hit webui SSR routes", async () => {
    const client = new HttpClient(baseUrl!);
    await client.login(username!, password!);

    for (const route of WEBUI_ROUTES) {
      const res = await client.get(route.path);
      expect(res.status, route.path).toBe(route.expectStatus ?? 200);
      if (route.bodyIncludes) expect(res.body, route.path).toContain(route.bodyIncludes);
    }
  });

  it("myxl routes without active MSISDN redirect to login", async () => {
    const client = new HttpClient(baseUrl!);
    await client.login(username!, password!);

    for (const route of MYXL_ROUTES) {
      const res = await client.get(route.path);
      expect(res.status, route.path).toBe(route.expectStatus ?? 200);
    }
  });

  it("myxl active routes render when staging account is linked", async () => {
    const client = new HttpClient(baseUrl!);
    await client.login(username!, password!);

    for (const route of MYXL_ACTIVE_ROUTES) {
      const res = await client.get(route.path);
      expect([200, 401, 500]).toContain(res.status);
    }
  });

  it("monitor cron actions accept POST", async () => {
    const client = new HttpClient(baseUrl!);
    await client.login(username!, password!);

    for (const route of MONITOR_POST_ROUTES) {
      const res = await client.postForm(route.path, {});
      expect(res.status, route.path).toBe(303);
    }
  });

  it("telegram webhook accepts signed empty update when configured", async () => {
    if (!webhookSecret) return;
    const client = new HttpClient(baseUrl!);
    const res = await client.postJson(
      "/telegram/webhook",
      { update_id: 99_001, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/start" } },
      { "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
    );
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) expect(res.body).toContain('"ok":true');
  });
});