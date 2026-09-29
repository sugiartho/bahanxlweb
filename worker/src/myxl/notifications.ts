import { formatIsoDate } from "../ssr/filters";

export interface NotificationListItem {
  id: string;
  title: string;
  body: string;
  timestamp_iso: string;
  is_unread: boolean;
}

function pickNotificationId(item: Record<string, unknown>): string {
  return String(item.notification_id ?? item.id ?? "");
}

function pickTitle(item: Record<string, unknown>): string {
  return String(item.category_title ?? item.title ?? item.subject ?? item.name ?? "-");
}

function pickBody(item: Record<string, unknown>): string {
  return String(item.full_message ?? item.content ?? item.body ?? item.description ?? "");
}

export function parseNotificationList(raw: Record<string, unknown> | null): NotificationListItem[] {
  if (!raw) return [];

  let items: Record<string, unknown>[] = [];
  const data = raw.data;
  if (Array.isArray(data)) {
    items = data as Record<string, unknown>[];
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const inbox = d.inbox ?? d.notifications;
    if (Array.isArray(inbox)) items = inbox as Record<string, unknown>[];
  } else if (Array.isArray(raw)) {
    items = raw as unknown as Record<string, unknown>[];
  }

  return items.map((n) => ({
    id: pickNotificationId(n),
    title: pickTitle(n),
    body: pickBody(n),
    timestamp_iso: formatIsoDate(n.timestamp),
    is_unread: n.is_read === false,
  }));
}

export function parseNotificationDetail(raw: Record<string, unknown> | null): {
  title: string;
  body: string;
  timestamp_iso: string;
  category: string;
} {
  if (!raw) {
    return { title: "Pesan Baru", body: "Tidak ada konten pesan.", timestamp_iso: "-", category: "" };
  }

  let n: Record<string, unknown> = raw;
  const data = raw.data;
  if (data && typeof data === "object") {
    n = data as Record<string, unknown>;
    const inbox = n.inbox;
    if (Array.isArray(inbox) && inbox.length > 0) {
      n = inbox[0] as Record<string, unknown>;
    }
  }

  return {
    title: pickTitle(n),
    body: pickBody(n) || "Tidak ada konten pesan.",
    timestamp_iso: formatIsoDate(n.timestamp),
    category: String(n.category ?? ""),
  };
}