/** Jinja filter ports — mirrors webui/helpers.py */

const WIB_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];

const ID_MONTHS_LONG = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function formatRp(value: unknown): string {
  try {
    const n = Number.parseInt(String(value), 10);
    if (Number.isNaN(n)) return String(value ?? "-");
    return `Rp ${n.toLocaleString("id-ID")}`;
  } catch {
    return String(value ?? "-");
  }
}

export function formatTs(ts: unknown): string {
  if (!ts) return "-";
  try {
    const d = new Date(Number.parseInt(String(ts), 10) * 1000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return String(ts);
  }
}

export function formatDate(ts: unknown): string {
  if (!ts) return "-";
  try {
    const d = new Date(Number.parseInt(String(ts), 10) * 1000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const monthIdx = Number.parseInt(get("month"), 10) - 1;
    const month = ID_MONTHS_LONG[monthIdx] ?? get("month");
    return `${get("day")} ${month} ${get("year")}`;
  } catch {
    return String(ts);
  }
}

export function formatIsoDate(iso: unknown): string {
  if (!iso) return "-";
  try {
    const dt = new Date(String(iso).replace("Z", "+00:00"));
    if (Number.isNaN(dt.getTime())) return String(iso);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const monthIdx = Number.parseInt(get("month"), 10) - 1;
    const month = WIB_MONTHS[monthIdx] ?? get("month");
    return `${get("day")} ${month} ${get("year")}, ${get("hour")}:${get("minute")} WIB`;
  } catch {
    return String(iso);
  }
}

export function humanizeBytes(n: unknown): string {
  try {
    let f = Number.parseInt(String(n), 10);
    if (Number.isNaN(f)) return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (f >= 1024 && i < units.length - 1) {
      f /= 1024;
      i++;
    }
    return `${f.toFixed(2)} ${units[i]}`;
  } catch {
    return "-";
  }
}

export function safeHtml(text: unknown): string {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type FilterName = "rp" | "ts" | "date" | "iso_date" | "bytes" | "safe_html";

export const templateFilters: Record<FilterName, (value: unknown) => string> = {
  rp: formatRp,
  ts: formatTs,
  date: formatDate,
  iso_date: formatIsoDate,
  bytes: humanizeBytes,
  safe_html: safeHtml,
};

export function applyFilter(name: string, value: unknown): string {
  const fn = templateFilters[name as FilterName];
  if (!fn) return String(value ?? "");
  return fn(value);
}