import type { EngselClient } from "../clients/engsel";
import type { PaymentItem } from "../clients/purchase/types";
import { ensureBuiltinDecoyDefaults } from "./decoy-settings";
import { USER_DECOY_DIR } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "./blob";

const NEED_PRIO_DECOYS = new Set(["PRIORITAS", "PRIOHYBRID", "GO"]);

interface DecoyFileData {
  family_code?: string;
  variant_code?: string;
  order?: number;
  is_enterprise?: boolean;
  migration_type?: string;
  base_method?: string;
}

const BUILTIN_DECOYS: Record<string, { option_code: string }> = {
  "default-balance": { option_code: "" },
  "default-qris": { option_code: "" },
  "default-qris0": { option_code: "" },
  "prio-balance": { option_code: "" },
  "prio-qris": { option_code: "" },
  "prio-qris0": { option_code: "" },
};

function decoyPrefix(subscriptionType: string): string {
  return NEED_PRIO_DECOYS.has(subscriptionType) ? "prio-" : "default-";
}

async function readDecoyJson(
  storage: StorageBackend,
  username: string,
  objectKey: string,
): Promise<DecoyFileData | null> {
  const raw = await getTextBlob(storage, username, objectKey);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as DecoyFileData;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function fetchDecoyPackage(
  engsel: EngselClient,
  idToken: string,
  raw: DecoyFileData,
): Promise<Record<string, unknown> | null> {
  if (!raw.family_code || !raw.variant_code) return null;
  const combos: Array<[boolean | undefined, string | undefined]> = [
    [raw.is_enterprise ?? false, raw.migration_type ?? "NONE"],
    [undefined, undefined],
  ];
  for (const [ie, mt] of combos) {
    const pkg = await engsel.getPackageDetails(
      idToken,
      raw.family_code,
      raw.variant_code,
      raw.order ?? 1,
      ie,
      mt,
    );
    if (pkg) return pkg;
  }
  return null;
}

function paymentItemFromPackage(pkg: Record<string, unknown>): PaymentItem {
  const opt = (pkg.package_option as Record<string, unknown>) ?? {};
  return {
    item_code: String(opt.package_option_code ?? ""),
    product_type: "",
    item_price: Number(opt.price ?? 0),
    item_name: String(opt.name ?? ""),
    tax: 0,
    token_confirmation: String(pkg.token_confirmation ?? ""),
  };
}

export async function makeDecoyItemFromSlot(
  storage: StorageBackend,
  username: string,
  engsel: EngselClient,
  idToken: string,
  slotKey: string,
): Promise<{ item: PaymentItem; pkg: Record<string, unknown> } | { error: string }> {
  const objectKey = `${USER_DECOY_DIR}/decoy-${slotKey}.json`;
  const raw = await readDecoyJson(storage, username, objectKey);
  if (!raw) {
    return {
      error: `Decoy '${slotKey}' belum bisa dipakai — file tidak ada atau invalid. Buka /settings/decoy untuk set up.`,
    };
  }
  if (!raw.family_code || !raw.variant_code) {
    return {
      error: `Decoy '${slotKey}' belum di-set (family_code/variant_code kosong). Edit di /settings/decoy.`,
    };
  }
  const pkg = await fetchDecoyPackage(engsel, idToken, raw);
  if (!pkg) {
    return {
      error: `Decoy '${slotKey}': server MyXL nolak family_code. Ganti di /settings/decoy dengan family/variant yang valid.`,
    };
  }
  return { item: paymentItemFromPackage(pkg), pkg };
}

export async function makeDecoyItem(
  storage: StorageBackend,
  username: string,
  engsel: EngselClient,
  idToken: string,
  decoyKind: string,
  subscriptionType: string,
  slotKey?: string,
): Promise<{ item: PaymentItem; pkg: Record<string, unknown> } | { error: string }> {
  if (slotKey) return makeDecoyItemFromSlot(storage, username, engsel, idToken, slotKey);

  await ensureBuiltinDecoyDefaults(storage, username);

  const prefix = decoyPrefix(subscriptionType);
  const decoyName = `${prefix}${decoyKind}`;
  const builtin = BUILTIN_DECOYS[decoyName];
  if (!builtin?.option_code) {
    const objectKey = `${USER_DECOY_DIR}/decoy-${decoyName}.json`;
    const raw = await readDecoyJson(storage, username, objectKey);
    if (!raw) {
      return {
        error: `Decoy '${decoyName}' belum bisa dipakai — file ${objectKey} tidak ada atau invalid. Buka /settings/decoy untuk set up.`,
      };
    }
    if (!raw.family_code || !raw.variant_code) {
      return {
        error: `Decoy '${decoyName}' belum di-set (file ada, tapi family_code/variant_code kosong). Edit di /settings/decoy.`,
      };
    }
    const pkg = await fetchDecoyPackage(engsel, idToken, raw);
    if (!pkg) {
      return {
        error: `Decoy '${decoyName}': server MyXL nolak family_code <code>${raw.family_code}</code>. Ganti di /settings/decoy.`,
      };
    }
    return { item: paymentItemFromPackage(pkg), pkg };
  }

  const pkg = await engsel.getPackage(idToken, builtin.option_code);
  if (!pkg) {
    return { error: "Gagal fetch detail paket decoy (option_code mungkin nggak available lagi)." };
  }
  return { item: paymentItemFromPackage(pkg), pkg };
}

export async function makeCustomDecoyItem(
  storage: StorageBackend,
  username: string,
  engsel: EngselClient,
  idToken: string,
  name: string,
): Promise<{ item: PaymentItem; base: "balance" | "qris" } | { error: string }> {
  const objectKey = `${USER_DECOY_DIR}/custom-${name}.json`;
  const data = await readDecoyJson(storage, username, objectKey);
  if (!data) return { error: `Custom decoy '${name}' tidak ditemukan.` };
  let base = (data.base_method ?? "balance").toLowerCase();
  if (base !== "balance" && base !== "qris") base = "balance";
  if (!data.family_code || !data.variant_code) {
    return { error: `Custom decoy '${name}' belum diisi family_code / variant_code.` };
  }
  const pkg = await fetchDecoyPackage(engsel, idToken, data);
  if (!pkg) return { error: "Gagal fetch detail paket custom decoy (server tolak semua kombo)." };
  return { item: paymentItemFromPackage(pkg), base: base as "balance" | "qris" };
}