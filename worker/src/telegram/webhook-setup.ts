export interface TelegramWebhookInfo {
  ok: boolean;
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date: number | null;
  last_error_message: string;
  max_connections: number | null;
  allowed_updates: string[] | null;
  error?: string;
}

type TelegramApiResult = {
  ok?: boolean;
  description?: string;
  result?: Record<string, unknown>;
};

function parseWebhookInfo(data: TelegramApiResult): TelegramWebhookInfo {
  const r = data.result ?? {};
  return {
    ok: Boolean(data.ok),
    url: String(r.url ?? ""),
    has_custom_certificate: Boolean(r.has_custom_certificate),
    pending_update_count: Number(r.pending_update_count ?? 0),
    last_error_date: r.last_error_date != null ? Number(r.last_error_date) : null,
    last_error_message: String(r.last_error_message ?? ""),
    max_connections: r.max_connections != null ? Number(r.max_connections) : null,
    allowed_updates: Array.isArray(r.allowed_updates) ? (r.allowed_updates as string[]) : null,
    error: data.ok ? undefined : String(data.description ?? "Telegram API error"),
  };
}

export async function registerTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; description: string }> {
  const token = botToken.trim();
  if (!token) return { ok: false, description: "Bot token kosong" };

  const body: Record<string, unknown> = { url: webhookUrl };
  if (secretToken?.trim()) body.secret_token = secretToken.trim();

  const res = await fetchFn(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  let data: TelegramApiResult = {};
  try {
    data = (await res.json()) as TelegramApiResult;
  } catch {
    return { ok: false, description: `HTTP ${res.status}` };
  }

  return {
    ok: Boolean(data.ok),
    description: String(data.description ?? (data.ok ? "Webhook terdaftar" : "Gagal daftar webhook")),
  };
}

export async function getTelegramWebhookInfo(
  botToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<TelegramWebhookInfo> {
  const token = botToken.trim();
  if (!token) {
    return {
      ok: false,
      url: "",
      has_custom_certificate: false,
      pending_update_count: 0,
      last_error_date: null,
      last_error_message: "",
      max_connections: null,
      allowed_updates: null,
      error: "Bot token kosong",
    };
  }

  const res = await fetchFn(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  let data: TelegramApiResult = {};
  try {
    data = (await res.json()) as TelegramApiResult;
  } catch {
    return {
      ok: false,
      url: "",
      has_custom_certificate: false,
      pending_update_count: 0,
      last_error_date: null,
      last_error_message: "",
      max_connections: null,
      allowed_updates: null,
      error: `HTTP ${res.status}`,
    };
  }

  return parseWebhookInfo(data);
}

export function webhookUrlForRequest(requestUrl: string): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}/telegram/webhook`;
}

export function ensureWebhookSecret(current: string, envSecret?: string): string {
  const fromEnv = String(envSecret ?? "").trim();
  if (fromEnv) return fromEnv;
  const existing = String(current ?? "").trim();
  if (existing) return existing;
  return crypto.randomUUID();
}