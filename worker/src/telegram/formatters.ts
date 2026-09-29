import { formatQuotaByte } from "../myxl/quota";
import { formatDate, formatRp } from "../ssr/filters";

export function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function tgErr(exc: unknown): string {
  if (exc instanceof Error && (exc.name === "ValueError" || exc.message)) {
    return `⚠️ ${esc(exc.message)}`;
  }
  return "⚠️ Terjadi kesalahan. Silakan coba lagi.";
}

export function formatDateDmY(ts: unknown): string {
  return formatDate(ts);
}

export function formatDateIso(ts: unknown): string {
  return formatDate(ts);
}

export function cardAgeFromDob(dobStr: string): string {
  if (!dobStr) return "-";
  const m = dobStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "-";
  const start = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) months = 0;
  return `${Math.floor(months / 12)} Year ${months % 12} Month`;
}

function formatBenefitQuota(b: Record<string, unknown>): [string, string] {
  const dt = String(b.data_type ?? "");
  const rem = Number(b.remaining ?? 0);
  const tot = Number(b.total ?? 0);
  if (dt === "DATA") return [formatQuotaByte(tot), formatQuotaByte(rem)];
  if (dt === "VOICE") return [`${Math.round(tot / 60)} menit`, `${Math.round(rem / 60)} menit`];
  if (dt === "TEXT") return [`${tot} SMS`, `${rem} SMS`];
  return [String(tot), String(rem)];
}

export function formatPaketBlock(q: Record<string, unknown>): string[] {
  const lines = [
    `📦Nama Paket : ${esc(q.name ?? "-")}`,
    `📅Expired : ${formatDateDmY(q.expired_at)}`,
    "===========================",
  ];
  for (const b of (q.benefits as Record<string, unknown>[]) ?? []) {
    const [tot, rem] = formatBenefitQuota(b);
    lines.push(`⭐️Benefit : ${esc(b.name ?? "-")}`);
    lines.push(`💙Quota : ${tot}`);
    lines.push(`✅Sisa Quota : ${rem}`);
    lines.push("");
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function chunkLines(lines: string[], maxLen = 3900): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const line of lines) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > maxLen && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [""];
}

export function formatHistoryLines(msisdn: number, txs: Record<string, unknown>[]): string {
  const lines = [`<b>🧾 Riwayat — ${msisdn}</b>\n`];
  if (!txs.length) {
    lines.push("(tidak ada transaksi)");
    return lines.join("\n");
  }
  for (const tx of txs.slice(0, 10)) {
    const status = String(tx.status ?? "-");
    const emoji = status === "SUCCESS" ? "✅" : status === "FAILED" ? "❌" : "⏳";
    lines.push(`${emoji} ${esc(tx.title ?? "-")} · ${esc(tx.price ?? "-")}`);
    const date = tx.formated_date ?? "";
    const method = tx.payment_method_label ?? "";
    if (date || method) lines.push(`    ${esc(date)} · ${esc(method)}`);
  }
  return lines.join("\n");
}

export function formatRpLabel(price: unknown): string {
  try {
    const n = Number.parseInt(String(price ?? 0), 10);
    return `Rp ${n.toLocaleString("id-ID")}`;
  } catch {
    return "Rp ?";
  }
}