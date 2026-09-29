import { Hono } from "hono";
import { getActiveUserSafe, listAccounts } from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import { dashboardStats, renderMyXlPage } from "../myxl/render";
import { htmlResponse } from "../ssr";
import type { AppEnv } from "../types";

export const dashboard = new Hono<AppEnv>();

dashboard.get("/", async (c) => {
  const webuiUser = c.get("webuiUser");
  if (!webuiUser) return c.redirect("/u/login", 303);

  const storage = c.get("storage");
  let clients;
  try {
    clients = createMyXlClients(c.env, storage, webuiUser.username);
  } catch {
    return c.redirect("/login?error=MyXL+API+belum+dikonfigurasi", 303);
  }

  const activeUser = await getActiveUserSafe(storage, webuiUser.username, clients);
  if (!activeUser) return c.redirect("/login", 303);

  let balance: Record<string, unknown> | null = null;
  let balanceErr: string | undefined;
  try {
    balance = await clients.engsel.getBalance(activeUser.tokens.id_token);
  } catch (e) {
    balanceErr = String(e);
  }

  let tierInfo: Record<string, unknown> | null = null;
  if (activeUser.subscription_type === "PREPAID") {
    try {
      tierInfo = await clients.engsel.getTieringInfo(activeUser.tokens.id_token);
    } catch {
      tierInfo = { tier: 0, current_point: 0 };
    }
  }

  let activePackagesCount = 0;
  try {
    const qd = await clients.engsel.getQuotaDetails(activeUser.tokens.id_token);
    const quotas = (qd?.quotas as unknown[] | undefined) ?? [];
    activePackagesCount = quotas.length;
  } catch {
    activePackagesCount = 0;
  }

  const tier = Number(tierInfo?.tier ?? 0);
  const html = renderMyXlPage(c.req.raw, "dashboard", webuiUser, {
    page_title: "Beranda · WebUI-XL",
    active_user: {
      number: activeUser.number,
      subscription_type: activeUser.subscription_type,
    },
    dashboard_stats: dashboardStats(balance, tierInfo),
    balance_err: balanceErr,
    has_tier: tier > 0,
    tier,
    active_packages_count: activePackagesCount,
    accounts: await listAccounts(storage, webuiUser.username),
  });
  return htmlResponse(html);
});