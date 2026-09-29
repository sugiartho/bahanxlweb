import { USER_MONITOR_LOG } from "../storage/keys";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";

const LOG_MAX_BYTES = 256 * 1024;

function formatLine(line: string): string {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  return `[${ts}] ${line}\n`;
}

export async function logLine(storage: StorageBackend, username: string, line: string): Promise<void> {
  try {
    const existing = (await getTextBlob(storage, username, USER_MONITOR_LOG)) ?? "";
    let combined = existing + formatLine(line);
    const encoded = new TextEncoder().encode(combined);
    if (encoded.length > LOG_MAX_BYTES) {
      const lines = combined.split("\n");
      combined = `${lines.slice(-200).join("\n")}\n`;
    }
    await storage.putBlob(username, USER_MONITOR_LOG, combined);
  } catch {
    // ignore log failures
  }
}

export async function tailLog(storage: StorageBackend, username: string, n = 100): Promise<string[]> {
  try {
    const text = await getTextBlob(storage, username, USER_MONITOR_LOG);
    if (!text) return [];
    return text.split("\n").filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}