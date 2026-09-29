import { USER_DECOY_DIR } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";
import { formatRpLabel } from "./formatters";

export interface DecoyChoice {
  label: string;
  method: string;
  slot?: string;
}

function methodForBuiltinKind(kind: string): string | null {
  if (kind === "balance") return "decoy_balance";
  if (kind === "qris") return "decoy_qris";
  if (kind === "qris0") return "decoy_qris0";
  return null;
}

function payIcon(kind: string): string {
  if (kind === "balance") return "💳";
  if (kind === "qris" || kind === "qris0") return "📱";
  return "🎭";
}

async function loadDecoyJson(storage: StorageBackend, username: string, key: string) {
  const raw = await getTextBlob(storage, username, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listDefaultDecoyChoices(
  storage: StorageBackend,
  username: string,
): Promise<DecoyChoice[]> {
  const keys = await storage.listBlobs(username, `${USER_DECOY_DIR}/decoy-`);
  const choices: DecoyChoice[] = [];

  for (const objectKey of keys.sort()) {
    const slot = objectKey.split("/").pop()?.slice("decoy-".length, -".json".length) ?? "";
    const data = await loadDecoyJson(storage, username, objectKey);
    if (!data?.family_code || !data.variant_code) continue;
    const kind = slot.includes("-") ? slot.split("-").pop() ?? slot : slot;
    const method = methodForBuiltinKind(kind);
    if (!method) continue;
    const opt = String(data.option_name ?? data.variant_name ?? slot).trim();
    const price = formatRpLabel(data.price);
    const prefix = slot.includes("-") ? slot.slice(0, slot.lastIndexOf("-")) : slot;
    choices.push({
      label: `${payIcon(kind)} ${prefix} · ${opt} (${price})`,
      method,
      slot,
    });
  }
  return choices;
}