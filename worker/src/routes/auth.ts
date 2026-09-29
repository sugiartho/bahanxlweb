import { renderAppErrorPage } from "../myxl/require";
import { htmlResponse } from "../ssr";
import { Hono } from "hono";
import { getTheme, type WebuiUserRecord } from "../auth/users";
import {
  addRefreshToken,
  getActiveUserDisplay,
  listAccounts,
  removeRefreshToken,
  setActiveUser,
} from "../myxl/accounts";
import { createMyXlClients } from "../myxl/clients";
import { clearOtpPending, isOtpPendingForPhone, loadOtpPending, saveOtpPending } from "../myxl/otp";
import {
  dashboardStats,
  loginTabs,
  mapAccountsForPage,
  mapSavedAccounts,
  renderMyXlPage,
} from "../myxl/render";
import type { AppEnv } from "../types";

function requireWebuiUser(c: { get: (k: "webuiUser") => WebuiUserRecord | null }): WebuiUserRecord {
  const user = c.get("webuiUser");
  if (!user) throw new Error("webui session required");
  return user;
}

function loginTab(url: URL, pending: boolean): string {
  const tab = url.searchParams.get("tab") ?? (pending ? "login" : "login");
  return tab;
}

export const myxlAuth = new Hono<AppEnv>();

myxlAuth.get("/login", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const url = new URL(c.req.url);
  const phone = url.searchParams.get("phone") ?? "";
  const otpState = await loadOtpPending(storage, webuiUser.username);
  const pending = isOtpPendingForPhone(otpState, phone || undefined);
  const tab = loginTab(url, pending);

  const saved = await listAccounts(storage, webuiUser.username);
  const currentActive = await getActiveUserDisplay(storage, webuiUser.username);

  const html = renderMyXlPage(c.req.raw, "login", webuiUser, {
    page_title: "Login · WebUI-XL",
    error: url.searchParams.get("error") ?? undefined,
    info: url.searchParams.get("info") ?? undefined,
    phone: phone || otpState?.phone || "",
    pending_otp: pending,
    show_tab_login: tab === "login",
    show_tab_register: tab === "register",
    show_tab_saved: tab === "saved",
    tabs: loginTabs(tab, phone || otpState?.phone),
    has_saved_accounts: saved.length > 0,
    saved_accounts: mapSavedAccounts(saved, currentActive?.number ?? null),
    active_user: currentActive ? { number: currentActive.number } : undefined,
    accounts: saved,
    user_theme: getTheme(webuiUser),
  });
  return htmlResponse(html);
});

myxlAuth.post("/login/request-otp", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const body = await c.req.parseBody();
  const phone = String(body.phone ?? "").trim();

  const renderLogin = (ctx: Record<string, unknown>) =>
    htmlResponse(
      renderMyXlPage(c.req.raw, "login", webuiUser, {
        page_title: "Login · WebUI-XL",
        phone,
        pending_otp: false,
        show_tab_login: true,
        show_tab_register: false,
        show_tab_saved: false,
        tabs: loginTabs("login", phone),
        has_saved_accounts: false,
        ...ctx,
      }),
    );

  if (!phone.startsWith("628") || phone.length < 10 || phone.length > 14) {
    return renderLogin({
      error: "Nomor tidak valid. Pastikan diawali 628 dan panjang 10-14 digit.",
    });
  }

  let clients;
  try {
    clients = createMyXlClients(c.env, storage, webuiUser.username);
  } catch (e) {
    return renderLogin({ error: `Konfigurasi MyXL belum lengkap: ${e}` });
  }

  const otpResult = await clients.ciam.getOtpResult(phone);
  if (!otpResult.ok) {
    const detail = otpResult.error;
    const hint =
      detail.toLowerCase().includes("user not found")
        ? "Nomor tidak terdaftar di MyXL atau bukan nomor XL prabayar aktif."
        : detail;
    return renderLogin({
      error: `Gagal kirim OTP: ${hint}`,
    });
  }
  const subscriberId = otpResult.subscriberId;

  await saveOtpPending(storage, webuiUser.username, phone, subscriberId);
  return htmlResponse(
    renderMyXlPage(c.req.raw, "login", webuiUser, {
      page_title: "Login · WebUI-XL",
      phone,
      pending_otp: true,
      info: "OTP terkirim via SMS.",
      show_tab_login: true,
      show_tab_register: false,
      show_tab_saved: false,
      tabs: loginTabs("login", phone),
      has_saved_accounts: (await listAccounts(storage, webuiUser.username)).length > 0,
    }),
  );
});

myxlAuth.post("/login/submit-otp", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const body = await c.req.parseBody();
  const phone = String(body.phone ?? "").trim();
  const otp = String(body.otp ?? "").trim();

  const renderLogin = (error: string, pending: boolean) =>
    htmlResponse(
      renderMyXlPage(c.req.raw, "login", webuiUser, {
        page_title: "Login · WebUI-XL",
        phone,
        error,
        pending_otp: pending,
        show_tab_login: true,
        tabs: loginTabs("login", phone),
      }),
    );

  const otpState = await loadOtpPending(storage, webuiUser.username);
  if (!isOtpPendingForPhone(otpState, phone)) {
    return renderLogin("Sesi OTP expired/tidak ditemukan. Kirim ulang.", false);
  }

  if (!/^\d{6}$/.test(otp)) {
    return renderLogin("OTP harus 6 digit angka.", true);
  }

  let clients;
  try {
    clients = createMyXlClients(c.env, storage, webuiUser.username);
  } catch (e) {
    return renderLogin(`Konfigurasi MyXL belum lengkap: ${e}`, true);
  }

  const tokens = await clients.ciam.submitOtp("SMS", phone, otp);
  if (!tokens?.refresh_token) {
    return renderLogin("OTP salah atau gagal login.", true);
  }

  try {
    await addRefreshToken(storage, webuiUser.username, Number.parseInt(phone, 10), tokens.refresh_token, clients);
  } catch (e) {
    return renderLogin(`Simpan akun gagal: ${e}`, true);
  }

  await clearOtpPending(storage, webuiUser.username);
  return c.redirect("/", 303);
});

myxlAuth.get("/accounts", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const accounts = await listAccounts(storage, webuiUser.username);
  const active = await getActiveUserDisplay(storage, webuiUser.username);

  const html = renderMyXlPage(c.req.raw, "accounts", webuiUser, {
    page_title: "Akun · WebUI-XL",
    has_accounts: accounts.length > 0,
    accounts: mapAccountsForPage(accounts, active?.number ?? null),
    active_user: active ? { number: active.number } : undefined,
  });
  return htmlResponse(html);
});

myxlAuth.post("/accounts/activate", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const body = await c.req.parseBody();
  const number = Number.parseInt(String(body.number ?? ""), 10);

  let clients;
  try {
    clients = createMyXlClients(c.env, storage, webuiUser.username);
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal aktifkan akun", message: String(e) }, 500);
  }

  const ok = await setActiveUser(storage, webuiUser.username, number, clients);
  if (!ok) {
    return renderAppErrorPage(c, { title: "Gagal aktifkan akun", message: "Token tidak valid atau sudah tidak aktif. Hapus akun ini dan login ulang dengan OTP." }, 400);
  }
  return c.redirect("/", 303);
});

myxlAuth.post("/accounts/remove", async (c) => {
  const webuiUser = requireWebuiUser(c);
  const storage = c.get("storage");
  const body = await c.req.parseBody();
  const number = Number.parseInt(String(body.number ?? ""), 10);

  let clients;
  try {
    clients = createMyXlClients(c.env, storage, webuiUser.username);
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal hapus akun", message: String(e) }, 500);
  }

  try {
    await removeRefreshToken(storage, webuiUser.username, number, clients);
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal hapus akun", message: String(e) }, 500);
  }
  return c.redirect("/accounts", 303);
});