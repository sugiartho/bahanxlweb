import type { Env } from "../src/env";
import { COOKIE_NAME, makeSessionToken } from "../src/auth/session";
import { resolveStorage } from "../src/storage/resolve";
import type { SmokeRoute } from "./routes";

export interface FetchResult {
  status: number;
  headers: Headers;
  body: string;
  location?: string;
}

export class CookieJar {
  private cookies = new Map<string, string>();

  ingestFromResponse(headers: Headers): void {
    const typed = headers as Headers & { getSetCookie?: () => string[] };
    if (typeof typed.getSetCookie === "function") {
      for (const line of typed.getSetCookie()) this.ingest(line);
      return;
    }
    this.ingest(headers.get("Set-Cookie"));
  }

  ingest(setCookie: string | null): void {
    if (!setCookie) return;
    for (const part of setCookie.split(/,(?=\s*[^;,]+=)/)) {
      const [pair] = part.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | undefined {
    if (!this.cookies.size) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }
}

export class LocalWorkerClient {
  private readonly jar = new CookieJar();

  constructor(
    private readonly fetchFn: (
      req: Request,
      env: Env,
      ctx?: ExecutionContext,
    ) => Response | Promise<Response>,
    private readonly env: Env,
    private readonly origin = "http://e2e.local",
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<FetchResult> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "text/html,application/json");
    const cookie = this.jar.header();
    if (cookie) headers.set("Cookie", cookie);

    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil(promise) {
        pending.push(promise);
      },
      passThroughOnException() {},
    };

    const res = await this.fetchFn(new Request(`${this.origin}${path}`, { ...init, headers }), this.env, ctx);
    await Promise.all(pending);
    this.jar.ingestFromResponse(res.headers);

    return {
      status: res.status,
      headers: res.headers,
      body: await res.text(),
      location: res.headers.get("Location") ?? undefined,
    };
  }

  async get(path: string): Promise<FetchResult> {
    return this.request(path, { method: "GET" });
  }

  async postForm(path: string, fields: Record<string, string>): Promise<FetchResult> {
    const body = new URLSearchParams(fields);
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  /** Seed session cookie directly (Set-Cookie is opaque in worker.fetch tests). */
  async seedSession(username: string): Promise<void> {
    const storage = resolveStorage(this.env);
    const token = await makeSessionToken(username, await storage.getSessionSecret());
    this.jar.set(COOKIE_NAME, encodeURIComponent(token));
  }
}

export class HttpClient {
  private readonly jar = new CookieJar();

  constructor(private readonly baseUrl: string) {}

  async request(path: string, init: RequestInit = {}): Promise<FetchResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Accept", "text/html,application/json");
    const cookie = this.jar.header();
    if (cookie) headers.set("Cookie", cookie);

    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    this.jar.ingestFromResponse(res.headers);

    return {
      status: res.status,
      headers: res.headers,
      body: await res.text(),
      location: res.headers.get("Location") ?? undefined,
    };
  }

  async get(path: string): Promise<FetchResult> {
    return this.request(path, { method: "GET" });
  }

  async postForm(path: string, fields: Record<string, string>): Promise<FetchResult> {
    const body = new URLSearchParams(fields);
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  async postJson(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<FetchResult> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(payload),
    });
  }

  async login(username: string, password: string): Promise<void> {
    const res = await this.postForm("/u/login", { username, password, next: "/" });
    if (res.status !== 303 || !this.jar.get(COOKIE_NAME)) {
      throw new Error(`staging login failed: ${res.status}`);
    }
  }
}

export async function assertSmokeRoute(
  client: LocalWorkerClient | HttpClient,
  route: SmokeRoute,
): Promise<void> {
  const res =
    route.method === "GET"
      ? await client.get(route.path)
      : await client.postForm(route.path, {});

  const expected = route.expectStatus ?? 200;
  if (res.status !== expected) {
    throw new Error(`${route.method} ${route.path}: expected ${expected}, got ${res.status}`);
  }
  if (route.bodyIncludes && !res.body.includes(route.bodyIncludes)) {
    throw new Error(`${route.method} ${route.path}: body missing '${route.bodyIncludes}'`);
  }
}