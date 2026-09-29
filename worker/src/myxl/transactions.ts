const STATUS_STYLES: Record<string, { color: string; emoji: string }> = {
  SUCCESS: { color: "emerald", emoji: "" },
  DONE: { color: "emerald", emoji: "" },
  COMPLETED: { color: "emerald", emoji: "" },
  READY: { color: "emerald", emoji: "" },
  PAID: { color: "emerald", emoji: "" },
  PENDING: { color: "amber", emoji: "⏳" },
  PROCESSING: { color: "amber", emoji: "⏳" },
  WAITING: { color: "amber", emoji: "⏳" },
  FAILED: { color: "red", emoji: "" },
  CANCELLED: { color: "slate", emoji: "" },
  EXPIRED: { color: "slate", emoji: "⌛" },
};

function statusStyle(status: string): { color: string; emoji: string } {
  return STATUS_STYLES[status] ?? { color: "slate", emoji: "•" };
}

function badgeClasses(color: string): { bg: string; text: string; border: string } {
  return {
    bg: `bg-${color}-500/15`,
    text: `text-${color}-300`,
    border: `border-${color}-500/30`,
  };
}

function formatDt(ts: unknown): string {
  if (!ts) return "";
  try {
    const d = new Date(Number.parseInt(String(ts), 10) * 1000 + 7 * 60 * 60 * 1000);
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  } catch {
    return String(ts);
  }
}

export interface TransactionRow {
  title: string;
  price: string;
  validity: string;
  dt: string;
  payment_method: string;
  status: string;
  status_bg_class: string;
  status_text_class: string;
  status_border_class: string;
  status_emoji: string;
  payment_status: string;
  payment_status_bg_class: string;
  payment_status_text_class: string;
  payment_status_border_class: string;
  payment_status_emoji: string;
  show_payment_status: boolean;
  target: string;
  trx_code: string;
  icon_data_uri: string;
  pm_icon_data_uri: string;
  has_icon: boolean;
}

export function formatTransactions(raw: Record<string, unknown> | null): TransactionRow[] {
  if (!raw) return [];
  const data = raw.data;
  const list = Array.isArray((data as Record<string, unknown> | undefined)?.list)
    ? (data as Record<string, unknown>).list
    : Array.isArray(raw.list)
      ? raw.list
      : null;
  if (!Array.isArray(list)) return [];

  return list.map((t) => {
    const row = t as Record<string, unknown>;
    const status = String(row.status ?? "").toUpperCase();
    const ps = String(row.payment_status ?? "").toUpperCase();
    const sStyle = statusStyle(status);
    const pStyle = statusStyle(ps);
    const sBadge = badgeClasses(sStyle.color);
    const pBadge = badgeClasses(pStyle.color);
    const icon = String(row.icon ?? "");
    const pmIcon = String(row.payment_method_icon ?? "");

    return {
      title: String(row.title ?? "—"),
      price: String(row.price ?? `IDR ${row.raw_price ?? 0}`),
      validity: String(row.validity ?? ""),
      dt: formatDt(row.timestamp) || String(row.formated_date ?? ""),
      payment_method: String(row.payment_method_label ?? row.payment_method ?? "—"),
      status,
      status_bg_class: sBadge.bg,
      status_text_class: sBadge.text,
      status_border_class: sBadge.border,
      status_emoji: sStyle.emoji,
      payment_status: ps,
      payment_status_bg_class: pBadge.bg,
      payment_status_text_class: pBadge.text,
      payment_status_border_class: pBadge.border,
      payment_status_emoji: pStyle.emoji,
      show_payment_status: !!ps && ps !== status,
      target: String(row.target_msisdn ?? row.customer_number ?? ""),
      trx_code: String(row.trx_code ?? row.transaction_id ?? ""),
      icon_data_uri: icon ? `data:image/png;base64,${icon}` : "",
      pm_icon_data_uri: pmIcon ? `data:image/png;base64,${pmIcon}` : "",
      has_icon: !!icon,
    };
  });
}