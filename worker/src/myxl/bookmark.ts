import { USER_BOOKMARK } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "./blob";

export interface BookmarkEntry {
  family_name: string;
  family_code: string;
  is_enterprise: boolean;
  variant_name: string;
  option_name: string;
  order: number;
  package_option_code?: string;
}

async function loadBookmarks(storage: StorageBackend, username: string): Promise<BookmarkEntry[]> {
  const raw = await getTextBlob(storage, username, USER_BOOKMARK);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as BookmarkEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveBookmarks(storage: StorageBackend, username: string, rows: BookmarkEntry[]): Promise<void> {
  await storage.putBlob(username, USER_BOOKMARK, JSON.stringify(rows));
}

function ensureSchema(rows: BookmarkEntry[]): BookmarkEntry[] {
  return rows.map((p) => ({
    family_name: p.family_name ?? "",
    family_code: p.family_code,
    is_enterprise: Boolean(p.is_enterprise),
    variant_name: p.variant_name ?? "",
    option_name: p.option_name ?? "",
    order: p.order ?? 0,
    package_option_code: p.package_option_code ?? "",
  }));
}

export async function getBookmarks(storage: StorageBackend, username: string): Promise<BookmarkEntry[]> {
  return ensureSchema(await loadBookmarks(storage, username));
}

export async function addBookmark(
  storage: StorageBackend,
  username: string,
  entry: Omit<BookmarkEntry, "family_name"> & { family_name?: string },
): Promise<boolean> {
  const rows = await loadBookmarks(storage, username);
  const code = (entry.package_option_code ?? "").trim();
  const key = `${entry.family_code}|${entry.variant_name}|${entry.order}`;
  if (rows.some((p) => `${p.family_code}|${p.variant_name}|${p.order}` === key)) return false;
  if (code && rows.some((p) => p.family_code === entry.family_code && (p.package_option_code ?? "").trim() === code)) {
    return false;
  }
  rows.push({
    family_name: entry.family_name ?? "",
    family_code: entry.family_code,
    is_enterprise: entry.is_enterprise,
    variant_name: entry.variant_name,
    option_name: entry.option_name,
    order: entry.order,
    ...(code ? { package_option_code: code } : {}),
  });
  await saveBookmarks(storage, username, rows);
  return true;
}

export function resolveBookmarkOptionCode(
  family: Record<string, unknown>,
  bookmark: BookmarkEntry,
): string | null {
  const direct = (bookmark.package_option_code ?? "").trim();
  if (direct) return direct;

  const variants = (family.package_variants as Record<string, unknown>[]) ?? [];
  for (const variant of variants) {
    if (bookmark.variant_name && variant.name !== bookmark.variant_name) continue;
    const options = (variant.package_options as Record<string, unknown>[]) ?? [];
    for (const opt of options) {
      if (bookmark.option_name && opt.name !== bookmark.option_name) continue;
      if (bookmark.order && opt.order !== bookmark.order) continue;
      const code = String(opt.package_option_code ?? "");
      if (code) return code;
    }
  }
  return null;
}

export async function removeBookmark(
  storage: StorageBackend,
  username: string,
  familyCode: string,
  isEnterprise: boolean,
  variantName: string,
  order: number,
): Promise<boolean> {
  const rows = await loadBookmarks(storage, username);
  const idx = rows.findIndex(
    (p) =>
      p.family_code === familyCode &&
      p.is_enterprise === isEnterprise &&
      p.variant_name === variantName &&
      p.order === order,
  );
  if (idx < 0) return false;
  rows.splice(idx, 1);
  await saveBookmarks(storage, username, rows);
  return true;
}