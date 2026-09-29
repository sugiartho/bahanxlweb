import Mustache from "mustache";
import { getTheme, type WebuiUserRecord } from "../auth/users";
import { applyFilter } from "./filters";
import { buildBottomNav, buildNavSections } from "./nav";
import { TEMPLATES } from "./templates";

export type RenderContext = Record<string, unknown>;

function getByPath(ctx: RenderContext, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, ctx);
}

const FILTER_RE = /\{\{\{?\s*([^#^}/|]+?)\s*\|\s*(\w+)\s*\}?\}\}/g;

/** Expand `{{ value | rp }}` before Mustache render (Jinja filter compat). */
export function preprocessFilters(template: string, ctx: RenderContext): string {
  return template.replace(FILTER_RE, (match, varPath: string, filterName: string) => {
    const value = getByPath(ctx, varPath.trim());
    const result = applyFilter(filterName, value);
    if (match.startsWith("{{{")) return result;
    return Mustache.escape(result);
  });
}

export function themeClass(userTheme?: string): string {
  return userTheme === "light" ? "theme-light" : "";
}

export function buildLayoutContext(request: Request, extra: RenderContext = {}): RenderContext {
  const path = new URL(request.url).pathname;
  const bottom = buildBottomNav(path);
  const webuiUser = extra.webui_user as { username?: string } | undefined;
  return {
    path,
    page_title: "WebUI-XL",
    theme_class: themeClass(extra.user_theme as string | undefined),
    sections: buildNavSections(path),
    bottom_packages: bottom.packages,
    bottom_hot: bottom.hot,
    bottom_home: bottom.home,
    bottom_transactions: bottom.transactions,
    bottom_account: bottom.account,
    webui_user: webuiUser?.username ? { username: webuiUser.username } : undefined,
    ...extra,
  };
}

export function renderTemplate(name: string, ctx: RenderContext): string {
  const tpl = TEMPLATES[name];
  if (!tpl) throw new Error(`unknown template: ${name}`);
  return Mustache.render(preprocessFilters(tpl, ctx), ctx);
}

export function renderLayout(bodyTemplate: string, request: Request, ctx: RenderContext = {}): string {
  const layoutCtx = buildLayoutContext(request, ctx);
  const body = renderTemplate(bodyTemplate, layoutCtx);
  const pageTitle = (ctx.page_title as string) ?? (ctx.title as string) ?? "WebUI-XL";
  return renderTemplate("base", { ...layoutCtx, content: body, page_title: pageTitle });
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export interface WebuiLoginContext {
  mode: "login" | "register";
  username?: string;
  error?: string;
  info?: string;
  next?: string;
  users_count: number;
  user_theme?: string;
  google_enabled?: boolean;
  google_auth_url?: string;
}

export function renderWebuiLogin(_request: Request, ctx: WebuiLoginContext): string {
  const isRegister = ctx.mode === "register";
  const googleUrl = ctx.google_auth_url ?? `/u/auth/google?intent=${isRegister ? "register" : "login"}`;
  const loginGoogleUrl = isRegister ? googleUrl : `${googleUrl}${ctx.next && ctx.next !== "/" ? `&next=${encodeURIComponent(ctx.next)}` : ""}`;
  return renderTemplate("webui_login", {
    theme_class: themeClass(ctx.user_theme),
    page_title: isRegister ? "Register Webui-XL" : "Login Webui-XL",
    is_register: isRegister,
    is_login: !isRegister,
    username_qs: Boolean(ctx.username),
    username: ctx.username ?? "",
    next: ctx.next ?? "/",
    users_count: ctx.users_count,
    error: ctx.error,
    info: ctx.info,
    google_enabled: Boolean(ctx.google_enabled),
    google_auth_url: loginGoogleUrl,
  });
}

export interface ErrorPageContext {
  title?: string;
  message: string;
  user_theme?: string;
  webui_user?: { username: string };
}

export function layoutExtrasForUser(
  webuiUser?: WebuiUserRecord | null,
): Pick<ErrorPageContext, "user_theme" | "webui_user"> {
  return {
    user_theme: getTheme(webuiUser),
    webui_user: webuiUser ? { username: webuiUser.username } : undefined,
  };
}

export function renderErrorPage(request: Request, ctx: ErrorPageContext): string {
  const title = ctx.title ?? "Error";
  const message_pre = ctx.message.includes("\n") || ctx.message.includes("Traceback");
  return renderLayout("error_body", request, {
    title,
    message: ctx.message,
    message_pre,
    page_title: title,
    user_theme: ctx.user_theme,
    webui_user: ctx.webui_user,
  });
}