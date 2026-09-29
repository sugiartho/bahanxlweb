import { getTheme } from "../auth/users";
import type { WebuiUserRecord } from "../auth/users";
import { formatDate, formatRp } from "../ssr/filters";
import { renderLayout, type RenderContext } from "../ssr/engine";
import type { RefreshTokenEntry } from "./accounts";

export function loginTabs(activeTab: string, phone?: string) {
  const phoneQs = phone && activeTab === "login" ? `&phone=${encodeURIComponent(phone)}` : "";
  return [
    { id: "login", icon: "fa-solid fa-key", label: "Login", active: activeTab === "login", href: `?tab=login${phoneQs}` },
    { id: "register", icon: "fa-solid fa-id-card", label: "Register Kartu", active: activeTab === "register", href: "?tab=register" },
    { id: "saved", icon: "fa-solid fa-user-check", label: "Akun Tersimpan", active: activeTab === "saved", href: "?tab=saved" },
  ];
}

export function mapSavedAccounts(
  accounts: RefreshTokenEntry[],
  activeNumber: number | null,
): Array<RefreshTokenEntry & { is_active: boolean; subscription_type: string }> {
  return accounts.map((a) => ({
    ...a,
    subscription_type: a.subscription_type || "unknown",
    is_active: activeNumber != null && a.number === activeNumber,
  }));
}

export function mapAccountsForPage(
  accounts: RefreshTokenEntry[],
  activeNumber: number | null,
): Array<RefreshTokenEntry & { is_active: boolean; subscription_type: string; subscriber_id: string }> {
  return accounts.map((a) => ({
    ...a,
    subscription_type: a.subscription_type || "?",
    subscriber_id: a.subscriber_id || "-",
    is_active: activeNumber != null && a.number === activeNumber,
  }));
}

export function dashboardStats(balance: Record<string, unknown> | null, tierInfo: Record<string, unknown> | null) {
  return [
    {
      label: "Pulsa",
      value: balance?.remaining != null ? formatRp(balance.remaining) : "—",
    },
    {
      label: "Aktif s/d",
      value: balance?.expired_at != null ? formatDate(balance.expired_at) : "—",
    },
    {
      label: "Points",
      value: String(tierInfo?.current_point ?? 0),
    },
  ];
}

export function renderMyXlPage(
  request: Request,
  bodyTemplate: string,
  webuiUser: WebuiUserRecord,
  ctx: RenderContext = {},
): string {
  return renderLayout(bodyTemplate, request, {
    page_title: (ctx.page_title as string) ?? "WebUI-XL",
    user_theme: getTheme(webuiUser),
    webui_user: { username: webuiUser.username },
    ...ctx,
  });
}