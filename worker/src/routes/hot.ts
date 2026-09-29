import { Hono } from "hono";
import { SHARED_HOT, SHARED_HOT2 } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import { renderMyXlPage } from "../myxl/render";
import { htmlResponse } from "../ssr";
import type { AppEnv } from "../types";

async function readHotPackages(storage: StorageBackend, key: string): Promise<Record<string, unknown>[]> {
  const raw = await getTextBlob(storage, null, key);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

export const hot = new Hono<AppEnv>();

async function renderHotPage(c: import("hono").Context<AppEnv>, title: string, kind: string, key: string) {
  const webuiUser = c.get("webuiUser");
  if (!webuiUser) return c.redirect("/u/login", 303);

  const storage = c.get("storage");
  const packages = await readHotPackages(storage, key);
  const isHot2 = kind === "hot2";

  const formatted = packages.map((p, idx) => ({
    family_code: p.family_code,
    family_name: p.family_name,
    variant_name: p.variant_name,
    option_name: p.option_name,
    order: p.order,
    is_enterprise: p.is_enterprise,
    name: p.name,
    price: p.price,
    detail: p.detail,
    is_hot2: isHot2,
    is_hot: !isHot2,
    has_sub_packages: Boolean((p.packages as unknown[])?.length),
    hot2_idx: idx,
  }));

  const html = renderMyXlPage(c.req.raw, "hot", webuiUser, {
    page_title: `${title} · WebUI-XL`,
    title,
    kind,
    packages: formatted,
    has_packages: formatted.length > 0,
    is_hot2: isHot2,
    is_hot: !isHot2,
  });
  return htmlResponse(html);
}

hot.get("/hot", (c) => renderHotPage(c, " Hot", "hot", SHARED_HOT));
hot.get("/hot2", (c) => renderHotPage(c, " Hot-2", "hot2", SHARED_HOT2));