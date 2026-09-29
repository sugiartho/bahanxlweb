import { Hono } from "hono";
import { createStoreClient } from "../clients/store";
import {
  categoryPageTitle,
  formatCategoryFamilies,
  formatRedeemables,
  formatRedeemablesCategoryCatalog,
  formatStoreFamilies,
  formatStorePackages,
  formatStoreSegments,
  formatTieringExchangeCatalog,
} from "../myxl/store";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const store = new Hono<AppEnv>();

function enterpriseFlag(c: { req: { query: (k: string) => string | undefined } }): boolean {
  return c.req.query("enterprise") === "true";
}

store.get("/store/segments", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;
  const enterprise = enterpriseFlag(c);
  const storeClient = createStoreClient(session.clients.engsel);
  try {
    const res = await storeClient.getSegments(session.activeUser.tokens.id_token, enterprise);
    const segments = formatStoreSegments(res);
    return renderActivePage(c, session, "store_segments", {
      page_title: "Store Segments · WebUI-XL",
      segments,
      has_segments: segments.length > 0,
      enterprise,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

store.get("/store/families", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;
  const enterprise = enterpriseFlag(c);
  const storeClient = createStoreClient(session.clients.engsel);
  const subsType = session.activeUser.subscription_type || "PREPAID";
  try {
    const res = await storeClient.getFamilyList(session.activeUser.tokens.id_token, subsType, enterprise);
    const families = formatStoreFamilies(res);
    return renderActivePage(c, session, "store_families", {
      page_title: "Store Families · WebUI-XL",
      families,
      has_families: families.length > 0,
      enterprise,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

store.get("/store/packages", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;
  const enterprise = enterpriseFlag(c);
  const q = c.req.query("q") ?? "";
  const storeClient = createStoreClient(session.clients.engsel);
  const subsType = session.activeUser.subscription_type || "PREPAID";
  try {
    const res = await storeClient.getStorePackages(session.activeUser.tokens.id_token, subsType, enterprise);
    let packages = formatStorePackages(res);
    if (q.trim()) {
      const ql = q.toLowerCase();
      packages = packages.filter(
        (p) =>
          String(p.title).toLowerCase().includes(ql) ||
          String(p.family_name).toLowerCase().includes(ql),
      );
    }
    return renderActivePage(c, session, "store_packages", {
      page_title: "Store Packages · WebUI-XL",
      packages,
      has_packages: packages.length > 0,
      package_count: packages.length,
      enterprise,
      q,
      has_query: Boolean(q.trim()),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

store.get("/store/redemables", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;
  const enterprise = enterpriseFlag(c);
  const storeClient = createStoreClient(session.clients.engsel);
  try {
    const res = await storeClient.getRedeemables(session.activeUser.tokens.id_token, enterprise);
    const categories = formatRedeemables(res, { enterprise });

    let currentPoints = 0;
    let hasPoints = false;
    try {
      const tier = await session.clients.engsel.getTieringInfo(session.activeUser.tokens.id_token);
      if (tier) {
        currentPoints = Math.trunc(Number(tier.current_point ?? 0));
        hasPoints = true;
      }
    } catch {
      /* optional */
    }

    return renderActivePage(c, session, "store_redemables", {
      page_title: "Redemables · WebUI-XL",
      categories,
      has_categories: categories.length > 0,
      enterprise,
      has_points: hasPoints,
      current_points: currentPoints,
      current_points_fmt: currentPoints.toLocaleString("id-ID"),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

store.get("/store/category", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const categoryCode = c.req.query("code")?.trim() ?? "";
  const source = c.req.query("source")?.trim() ?? "";
  const enterprise = enterpriseFlag(c);
  if (!categoryCode) {
    return renderAppErrorPage(c, { title: "Invalid", message: "Parameter code wajib diisi." }, 400);
  }

  const storeClient = createStoreClient(session.clients.engsel);
  const debug = c.req.query("debug") === "1";
  try {
    const idToken = session.activeUser.tokens.id_token;
    const res = await storeClient.getFamiliesByCategory(idToken, categoryCode, enterprise);
    const fromFamilies = formatCategoryFamilies(res, { enterprise });

    let tier: Record<string, unknown> | null = null;
    let currentPoints = 0;
    let hasPoints = false;
    try {
      tier = await session.clients.engsel.getTieringInfo(idToken);
      if (tier) {
        currentPoints = Math.trunc(Number(tier.current_point ?? 0));
        hasPoints = true;
      }
    } catch {
      /* optional */
    }

    let catalogSource = fromFamilies.length > 0 ? "xl-stores/families" : "";
    let families = fromFamilies;

    if (families.length === 0) {
      const redeemRes = await storeClient.getRedeemables(idToken, enterprise);
      const fromRedeemables = formatRedeemablesCategoryCatalog(redeemRes, categoryCode, { enterprise });
      if (fromRedeemables.length > 0) {
        families = fromRedeemables;
        catalogSource = "redeemables";
      }
    }

    if (families.length === 0 && (source === "MYPOINT_LANDING" || source === "LOYALTY") && tier) {
      const fromTiering = formatTieringExchangeCatalog(tier, { enterprise });
      if (fromTiering.length > 0) {
        families = fromTiering;
        catalogSource = "tiering";
      }
    }

    const title = categoryPageTitle(source);
    const entQ = enterprise ? "?enterprise=true" : "";
    const apiStatus = res && typeof res === "object" ? String(res.status ?? "unknown") : "no-response";
    return renderActivePage(c, session, "store_category", {
      page_title: `${title} · WebUI-XL`,
      category_title: title,
      category_code: categoryCode,
      source,
      families,
      has_families: families.length > 0,
      enterprise,
      has_points: hasPoints,
      current_points_fmt: currentPoints.toLocaleString("id-ID"),
      back_href: `/store/redemables${entQ}`,
      catalog_source: catalogSource,
      show_debug: debug && families.length === 0,
      debug_api_status: apiStatus,
      debug_res_keys:
        debug && res?.data && typeof res.data === "object" && !Array.isArray(res.data)
          ? Object.keys(res.data as object).join(", ")
          : Array.isArray(res?.data)
            ? `array[${(res.data as unknown[]).length}]`
            : "",
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});