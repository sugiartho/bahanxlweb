import type { EngselClient } from "../clients/engsel";
import { USER_DECOY_DIR } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "./blob";

export const BUILTIN_SLOTS = [
  { key: "default-balance", label: "Default · Pulsa", subtype: "Reguler", method: "balance" },
  { key: "default-qris", label: "Default · QRIS (+1K)", subtype: "Reguler", method: "qris" },
  { key: "default-qris0", label: "Default · QRIS (Rp0)", subtype: "Reguler", method: "qris0" },
  { key: "prio-balance", label: "Prio · Pulsa", subtype: "PRIORITAS/PRIOHYBRID/GO", method: "balance" },
  { key: "prio-qris", label: "Prio · QRIS (+1K)", subtype: "PRIORITAS/PRIOHYBRID/GO", method: "qris" },
  { key: "prio-qris0", label: "Prio · QRIS (Rp0)", subtype: "PRIORITAS/PRIOHYBRID/GO", method: "qris0" },
] as const;

export const BUILTIN_KEYS = new Set<string>(BUILTIN_SLOTS.map((s) => s.key));
export const DECOY_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/;

/** Seeded when a builtin slot has no user blob yet (mirrors repo decoy_data/). */
export const BUNDLED_DECOY_DEFAULTS: Partial<Record<(typeof BUILTIN_SLOTS)[number]["key"], DecoyData>> = {
  "default-balance": {
    family_name: "XL PASS",
    family_code: "fff99b6b-5a5d-4ba4-a55b-38f6aca6f91d",
    is_enterprise: false,
    migration_type: "NONE",
    variant_code: "6986897d-9f09-4651-ac24-6efdf3dbcf3d",
    option_name: "XL PASS 20 Days",
    order: 1,
    price: 800000,
  },
};

const MIGRATION_TYPES = ["NONE", "PRE_TO_PRIOH", "PRIOH_TO_PRIO", "PRIO_TO_PRIOH"] as const;

export interface DecoyData {
  family_name?: string;
  family_code?: string;
  is_enterprise?: boolean;
  migration_type?: string;
  variant_name?: string;
  variant_code?: string;
  option_name?: string;
  order?: number;
  price?: number;
  base_method?: string;
}

export interface DecoyTemplateRow {
  key: string;
  label: string;
  subtype: string;
  kind: "builtin" | "custom";
  name: string;
  family_name: string;
  family_code: string;
  variant_name: string;
  variant_code: string;
  option_name: string;
  order: number;
  price: number;
  is_enterprise_checked: boolean;
  show_base_method: boolean;
  base_method: string;
  base_method_balance_selected: boolean;
  base_method_qris_selected: boolean;
  base_method_qris_class: string;
  has_family_code: boolean;
  family_code_short: string;
  raw_json: string;
  mt_NONE: boolean;
  mt_PRE_TO_PRIOH: boolean;
  mt_PRIOH_TO_PRIO: boolean;
  mt_PRIO_TO_PRIOH: boolean;
  show_delete: boolean;
}

function builtinObjectKey(key: string): string {
  return `${USER_DECOY_DIR}/decoy-${key}.json`;
}

function customObjectKey(name: string): string {
  return `${USER_DECOY_DIR}/custom-${name}.json`;
}

function parseBool(value: unknown): boolean {
  return ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

export async function loadDecoyJson(
  storage: StorageBackend,
  username: string,
  objectKey: string,
): Promise<DecoyData> {
  const raw = await getTextBlob(storage, username, objectKey);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as DecoyData;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function saveDecoyJson(
  storage: StorageBackend,
  username: string,
  objectKey: string,
  data: DecoyData,
): Promise<void> {
  await storage.putBlob(username, objectKey, JSON.stringify(data));
}

export function parseDecoyForm(body: Record<string, unknown>, includeBaseMethod = false): DecoyData {
  const data: DecoyData = {
    family_name: String(body.family_name ?? "").trim(),
    family_code: String(body.family_code ?? "").trim(),
    is_enterprise: parseBool(body.is_enterprise),
    migration_type: String(body.migration_type ?? "NONE").trim() || "NONE",
    variant_name: String(body.variant_name ?? "").trim(),
    variant_code: String(body.variant_code ?? "").trim(),
    option_name: String(body.option_name ?? "").trim(),
    order: Number.parseInt(String(body.order ?? "1"), 10) || 1,
    price: Number.parseInt(String(body.price ?? "0"), 10) || 0,
  };
  if (includeBaseMethod) {
    let bm = String(body.base_method ?? "balance").trim().toLowerCase();
    if (bm !== "balance" && bm !== "qris") bm = "balance";
    data.base_method = bm;
  }
  return data;
}

export async function ensureBuiltinDecoyDefaults(
  storage: StorageBackend,
  username: string,
): Promise<void> {
  for (const slot of BUILTIN_SLOTS) {
    const objectKey = builtinObjectKey(slot.key);
    if (await storage.blobExists(username, objectKey)) continue;
    const bundled = BUNDLED_DECOY_DEFAULTS[slot.key];
    if (bundled) await saveDecoyJson(storage, username, objectKey, bundled);
  }
}

export async function listBuiltinDecoys(
  storage: StorageBackend,
  username: string,
): Promise<Array<(typeof BUILTIN_SLOTS)[number] & { data: DecoyData }>> {
  await ensureBuiltinDecoyDefaults(storage, username);
  const out: Array<(typeof BUILTIN_SLOTS)[number] & { data: DecoyData }> = [];
  for (const slot of BUILTIN_SLOTS) {
    out.push({ ...slot, data: await loadDecoyJson(storage, username, builtinObjectKey(slot.key)) });
  }
  return out;
}

export function formatCustomDecoysForPurchase(
  customs: Array<{ name: string; base_method: string }>,
): Array<{ name: string; base_method: string; label: string; is_qris: boolean }> {
  return customs.map((c) => {
    const isQris = c.base_method === "qris";
    return {
      name: c.name,
      base_method: c.base_method,
      is_qris: isQris,
      label: `${isQris ? "QRIS" : "Pulsa"} + Decoy (${c.name})`,
    };
  });
}

export async function listCustomDecoys(
  storage: StorageBackend,
  username: string,
): Promise<Array<{ name: string; data: DecoyData; base_method: string }>> {
  const keys = await storage.listBlobs(username, `${USER_DECOY_DIR}/custom-`);
  const out: Array<{ name: string; data: DecoyData; base_method: string }> = [];
  for (const objectKey of keys.sort()) {
    const filename = objectKey.split("/").pop() ?? "";
    const name = filename.slice("custom-".length, -".json".length);
    const data = await loadDecoyJson(storage, username, objectKey);
    out.push({ name, data, base_method: data.base_method ?? "balance" });
  }
  return out;
}

function migrationFlags(mt: string): Pick<DecoyTemplateRow, "mt_NONE" | "mt_PRE_TO_PRIOH" | "mt_PRIOH_TO_PRIO" | "mt_PRIO_TO_PRIOH"> {
  const value = mt || "NONE";
  return {
    mt_NONE: value === "NONE",
    mt_PRE_TO_PRIOH: value === "PRE_TO_PRIOH",
    mt_PRIOH_TO_PRIO: value === "PRIOH_TO_PRIO",
    mt_PRIO_TO_PRIOH: value === "PRIO_TO_PRIOH",
  };
}

export function formatDecoyRow(
  data: DecoyData,
  kind: "builtin" | "custom",
  key: string,
  label: string,
  subtype = "",
): DecoyTemplateRow {
  const baseMethod = (data.base_method ?? "balance").toLowerCase();
  const familyCode = data.family_code ?? "";
  return {
    key,
    label,
    subtype,
    kind,
    name: kind === "custom" ? key : key,
    family_name: data.family_name ?? "",
    family_code: familyCode,
    variant_name: data.variant_name ?? "",
    variant_code: data.variant_code ?? "",
    option_name: data.option_name ?? "",
    order: data.order ?? 1,
    price: data.price ?? 0,
    is_enterprise_checked: !!data.is_enterprise,
    show_base_method: kind === "custom",
    base_method: baseMethod,
    base_method_balance_selected: baseMethod === "balance",
    base_method_qris_selected: baseMethod === "qris",
    base_method_qris_class: baseMethod === "qris" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
    has_family_code: !!familyCode,
    family_code_short: familyCode ? `${familyCode.slice(0, 8)}…` : "",
    raw_json: JSON.stringify(data, null, 2),
    show_delete: kind === "custom",
    ...migrationFlags(data.migration_type ?? "NONE"),
  };
}

export async function testDecoyFetch(
  engsel: EngselClient,
  idToken: string,
  data: DecoyData,
  subscriptionType: string,
): Promise<
  | { ok: true; option_code: string; option_name: string; price: number; validity: string; note?: string }
  | { ok: false; error: string }
> {
  if (!data.family_code || !data.variant_code) {
    return { ok: false, error: "family_code / variant_code belum diisi" };
  }

  const attempts: Array<[boolean | undefined, string | undefined, string]> = [
    [data.is_enterprise ?? false, data.migration_type ?? "NONE", "stored"],
    [undefined, undefined, "auto"],
  ];

  let pkg: Record<string, unknown> | null = null;
  let lastAttempt = "stored";
  for (const [ie, mt, label] of attempts) {
    try {
      pkg = await engsel.getPackageDetails(
        idToken,
        data.family_code,
        data.variant_code,
        data.order ?? 1,
        ie,
        mt,
      );
    } catch (e) {
      return { ok: false, error: `Exception: ${e}` };
    }
    lastAttempt = label;
    if (pkg) break;
  }

  if (!pkg) {
    return {
      ok: false,
      error:
        "Server MyXL nolak family_code/variant_code (semua kombo is_enterprise × migration_type gagal). " +
        "UUID mungkin expired, atau paket nggak available untuk subscription " +
        `${subscriptionType}. Cari family_code/variant_code lain dari /store/segments atau /store/packages.`,
    };
  }

  const opt = (pkg.package_option as Record<string, unknown>) ?? {};
  const result = {
    ok: true as const,
    option_code: String(opt.package_option_code ?? ""),
    option_name: String(opt.name ?? ""),
    price: Number(opt.price ?? 0),
    validity: String(opt.validity ?? ""),
  };
  if (lastAttempt !== "stored") {
    return {
      ...result,
      note:
        "Berhasil pakai mode AUTO (is_enterprise/migration_type stored ditolak server). Boleh saved as-is — sistem tetap retry saat beli.",
    };
  }
  return result;
}

export function builtinStorageKey(key: string): string {
  return builtinObjectKey(key);
}

export function customStorageKey(name: string): string {
  return customObjectKey(name);
}

export async function loadDecoyByKind(
  storage: StorageBackend,
  username: string,
  kind: string,
  key: string,
): Promise<DecoyData | null> {
  if (kind === "builtin") {
    if (!BUILTIN_KEYS.has(key)) return null;
    return loadDecoyJson(storage, username, builtinObjectKey(key));
  }
  if (kind === "custom") {
    if (!DECOY_NAME_RE.test(key)) return null;
    return loadDecoyJson(storage, username, customObjectKey(key));
  }
  return null;
}

export { MIGRATION_TYPES };