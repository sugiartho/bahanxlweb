/** Canonical route inventory for staging / local smoke tests. */

export type RouteAuth = "public" | "webui" | "myxl";

export interface SmokeRoute {
  method: "GET" | "POST";
  path: string;
  auth: RouteAuth;
  /** Substring expected in HTML/JSON body when authenticated appropriately. */
  bodyIncludes?: string;
  /** Status when preconditions are met (logged-in webui user, etc.). */
  expectStatus?: number;
}

export const PUBLIC_ROUTES: SmokeRoute[] = [
  { method: "GET", path: "/health", auth: "public", bodyIncludes: '"ok":true', expectStatus: 200 },
  { method: "GET", path: "/u/login", auth: "public", bodyIncludes: "Login", expectStatus: 200 },
  { method: "GET", path: "/u/register", auth: "public", bodyIncludes: "Register", expectStatus: 200 },
];

/** Pages that render with WebUI session only (no MyXL API / active MSISDN). */
export const WEBUI_ROUTES: SmokeRoute[] = [
  { method: "GET", path: "/monitoring", auth: "webui", bodyIncludes: "Monitoring", expectStatus: 200 },
  { method: "GET", path: "/monitoring/telegram", auth: "webui", bodyIncludes: "Telegram", expectStatus: 200 },
  { method: "GET", path: "/settings/theme", auth: "webui", bodyIncludes: "Tema", expectStatus: 200 },
  { method: "GET", path: "/settings/decoy", auth: "webui", bodyIncludes: "Decoy", expectStatus: 200 },
  { method: "GET", path: "/hot", auth: "webui", bodyIncludes: "Hot", expectStatus: 200 },
  { method: "GET", path: "/hot2", auth: "webui", bodyIncludes: "Hot", expectStatus: 200 },
  { method: "GET", path: "/donasi", auth: "webui", bodyIncludes: "Dukung", expectStatus: 200 },
];

/** Behaviour without a linked MyXL account (local dev has no API secrets). */
export const MYXL_ROUTES: SmokeRoute[] = [
  { method: "GET", path: "/", auth: "myxl", expectStatus: 303 },
  { method: "GET", path: "/login", auth: "myxl", bodyIncludes: "OTP", expectStatus: 200 },
];

/** Routes that require active MyXL — used on staging when account is linked. */
export const MYXL_ACTIVE_ROUTES: SmokeRoute[] = [
  { method: "GET", path: "/packages/my", auth: "myxl", expectStatus: 200 },
  { method: "GET", path: "/transactions", auth: "myxl", expectStatus: 200 },
  { method: "GET", path: "/bookmark", auth: "myxl", expectStatus: 200 },
];

export const MONITOR_POST_ROUTES: SmokeRoute[] = [
  { method: "POST", path: "/monitoring/run-once", auth: "webui", expectStatus: 303 },
  { method: "POST", path: "/monitoring/refresh", auth: "webui", expectStatus: 303 },
];

export const ALL_SMOKE_ROUTES: SmokeRoute[] = [
  ...PUBLIC_ROUTES,
  ...WEBUI_ROUTES,
  ...MYXL_ROUTES,
  ...MONITOR_POST_ROUTES,
];