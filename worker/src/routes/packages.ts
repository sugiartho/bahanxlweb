import { Hono } from "hono";
import { formatCustomDecoysForPurchase, listCustomDecoys } from "../myxl/decoy-settings";
import { formatFamilyDetail, formatPackageDetail } from "../myxl/packages";
import { activeExpiryForQuota, formatMyPackages } from "../myxl/quota";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const packages = new Hono<AppEnv>();

packages.get("/packages/by-option", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const code = c.req.query("code")?.trim();
  if (!code) {
    return renderActivePage(c, session, "packages_input_code", {
      page_title: "Cari paket · WebUI-XL",
      mode: "option",
      mode_option: true,
      form_action: "/packages/by-option",
      label: "Option Code",
    });
  }

  try {
    const idToken = session.activeUser.tokens.id_token;
    const pkg = await session.clients.engsel.getPackage(idToken, code);
    if (!pkg) {
      return renderAppErrorPage(c, { title: "Tidak ditemukan", message: `Option code ${code} tidak ditemukan.` }, 404);
    }

    let activeExpiry = { has_active_expiry: false, active_expiry_display: "" };
    try {
      const quotaRes = await session.clients.engsel.getQuotaDetailsRaw(idToken);
      if (quotaRes?.status === "SUCCESS") {
        const quotas =
          ((quotaRes.data as Record<string, unknown>)?.quotas as Record<string, unknown>[]) ?? [];
        activeExpiry = activeExpiryForQuota(quotas, code);
      }
    } catch {
      /* optional — catalog detail still renders */
    }

    const customs = await listCustomDecoys(c.get("storage"), session.webuiUser.username);
    const customDecoys = formatCustomDecoysForPurchase(customs);

    let tierPoints = 0;
    let hasTierPoints = false;
    try {
      const tier = await session.clients.engsel.getTieringInfo(session.activeUser.tokens.id_token);
      if (tier) {
        tierPoints = Math.trunc(Number(tier.current_point ?? 0));
        hasTierPoints = true;
      }
    } catch {
      /* optional */
    }

    const detail = formatPackageDetail(pkg, code);
    return renderActivePage(c, session, "package_detail", {
      page_title: `${detail.opt_name} · WebUI-XL`,
      ...detail,
      ...activeExpiry,
      custom_decoys: customDecoys,
      has_custom_decoys: customDecoys.length > 0,
      current_points: tierPoints,
      current_points_fmt: tierPoints.toLocaleString("id-ID"),
      has_tier_points: hasTierPoints,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

packages.get("/packages/by-family", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const code = c.req.query("code")?.trim();
  if (!code) {
    return renderActivePage(c, session, "packages_input_code", {
      page_title: "Cari paket · WebUI-XL",
      mode: "family",
      mode_family: true,
      form_action: "/packages/by-family",
      label: "Family Code",
    });
  }

  try {
    const family = await session.clients.engsel.getFamily(session.activeUser.tokens.id_token, code);
    if (!family) {
      return renderAppErrorPage(c, { title: "Tidak ditemukan", message: `Family code ${code} tidak ditemukan.` }, 404);
    }
    const ctx = formatFamilyDetail(family, code);
    return renderActivePage(c, session, "family_detail", {
      page_title: `${ctx.fam_name} · WebUI-XL`,
      ...ctx,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

packages.get("/packages/my", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const msg = c.req.query("msg");
  try {
    const res = await session.clients.engsel.getQuotaDetailsRaw(session.activeUser.tokens.id_token);
    const quotas =
      res?.status === "SUCCESS"
        ? formatMyPackages(((res.data as Record<string, unknown>)?.quotas as Record<string, unknown>[]) ?? [])
        : [];

    return renderActivePage(c, session, "my_packages", {
      page_title: "Paket Saya · WebUI-XL",
      has_quotas: quotas.length > 0,
      quotas,
      msg_ok: msg === "ok",
      msg_fail: msg === "fail",
      show_raw: quotas.length === 0,
      raw_json: JSON.stringify(res, null, 2),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

packages.post("/packages/my/unsubscribe", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const quotaCode = String(body.quota_code ?? "");
  const productDomain = String(body.product_domain ?? "");
  const productSubscriptionType = String(body.product_subscription_type ?? "");

  try {
    const ok = await session.clients.engsel.unsubscribePackage(
      session.activeUser.tokens.id_token,
      quotaCode,
      productDomain,
      productSubscriptionType,
    );
    return c.redirect(`/packages/my?msg=${ok ? "ok" : "fail"}`, 303);
  } catch (e) {
    return renderAppErrorPage(c, { title: "Unsubscribe gagal", message: String(e) }, 500);
  }
});