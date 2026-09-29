import { makeAxApiSignature } from "../crypto/crypto-helper";
import type { MyXlClientConfig } from "./config";
import { hostFromUrl } from "./config";
import type { FingerprintPair } from "./fingerprint";
import { GMT7_OFFSET_MIN, javaLikeTimestamp, nowGmt7, refreshAxRequestAtGmt7, tsGmt7WithoutColon } from "./time";

export type FetchFn = typeof fetch;

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  subscriber_id?: string;
  session_state?: string;
  [key: string]: unknown;
}

export interface CiamClientOptions {
  config: MyXlClientConfig;
  fingerprint: () => Promise<FingerprintPair>;
  fetchFn?: FetchFn;
}

const DEVICE_HEADERS = {
  device: "samsung",
  model: "SM-N935F",
  substype: "PREPAID",
} as const;

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function axHeaders(fp: FingerprintPair, at: Date, requestId: string): Record<string, string> {
  return {
    "Accept-Encoding": "gzip, deflate, br",
    "Ax-Device-Id": fp.deviceId,
    "Ax-Fingerprint": fp.fingerprint,
    "Ax-Request-At": javaLikeTimestamp(at, { offsetMinutes: GMT7_OFFSET_MIN }),
    "Ax-Request-Device": DEVICE_HEADERS.device,
    "Ax-Request-Device-Model": DEVICE_HEADERS.model,
    "Ax-Request-Id": requestId,
    "Ax-Substype": DEVICE_HEADERS.substype,
    "Content-Type": "application/json",
  };
}

export function validateContact(contact: string): boolean {
  return contact.startsWith("628") && contact.length <= 14;
}

export function createCiamClient(options: CiamClientOptions) {
  const { config, fingerprint } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const ciamHost = hostFromUrl(config.baseCiamUrl);

  async function commonHeaders(at: Date, requestId: string) {
    const fp = await fingerprint();
    const headers = axHeaders(fp, at, requestId);
    headers.Authorization = `Basic ${config.basicAuth}`;
    headers.Host = ciamHost;
    headers["User-Agent"] = config.ua;
    return headers;
  }

  async function getOtp(contact: string): Promise<string | null> {
    const result = await getOtpResult(contact);
    return result.ok ? result.subscriberId : null;
  }

  async function getOtpResult(
    contact: string,
  ): Promise<
    | { ok: true; subscriberId: string }
    | { ok: false; error: string; status: number }
  > {
    if (!validateContact(contact)) {
      return { ok: false, error: "Nomor tidak valid.", status: 0 };
    }

    const url = new URL(`${config.baseCiamUrl}/realms/xl-ciam/auth/otp`);
    url.searchParams.set("contact", contact);
    url.searchParams.set("contactType", "SMS");
    url.searchParams.set("alternateContact", "false");

    const headers = await commonHeaders(nowGmt7(), crypto.randomUUID());
    const res = await fetchFn(url.toString(), { method: "GET", headers });
    const text = await res.text();
    try {
      const body = JSON.parse(text) as {
        subscriber_id?: string;
        error?: string;
        error_description?: string;
      };
      if (body.subscriber_id) {
        return { ok: true, subscriberId: body.subscriber_id };
      }
      const msg = body.error_description || body.error || `HTTP ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    } catch {
      return { ok: false, error: text.slice(0, 200) || `HTTP ${res.status}`, status: res.status };
    }
  }

  async function extendSession(subscriberId: string): Promise<string | null> {
    const url = new URL(`${config.baseCiamUrl}/realms/xl-ciam/auth/extend-session`);
    url.searchParams.set("contact", base64Encode(subscriberId));
    url.searchParams.set("contactType", "DEVICEID");

    const headers = await commonHeaders(nowGmt7(), crypto.randomUUID());
    const res = await fetchFn(url.toString(), { method: "GET", headers });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { exchange_code?: string } };
    return body.data?.exchange_code ?? null;
  }

  async function submitOtp(
    contactType: "SMS" | "DEVICEID",
    contact: string,
    code: string,
  ): Promise<TokenResponse | null> {
    let finalContact = "";
    let finalCode = code;

    if (contactType === "SMS") {
      if (!validateContact(contact) || code.length !== 6) return null;
      finalContact = contact;
    } else if (contactType === "DEVICEID") {
      finalContact = base64Encode(contact);
      finalCode = code;
    } else {
      return null;
    }

    const now = nowGmt7();
    const tsForSign = tsGmt7WithoutColon(now);
    const tsHeader = tsGmt7WithoutColon(new Date(now.getTime() - 5 * 60_000));
    const fp = await fingerprint();
    const signature = await makeAxApiSignature(config.crypto, tsForSign, finalContact, code, contactType);

    const payload = `contactType=${contactType}&code=${finalCode}&grant_type=password&contact=${finalContact}&scope=openid`;
    const headers: Record<string, string> = {
      "Accept-Encoding": "gzip, deflate, br",
      "Authorization": `Basic ${config.basicAuth}`,
      "Ax-Api-Signature": signature,
      "Ax-Device-Id": fp.deviceId,
      "Ax-Fingerprint": fp.fingerprint,
      "Ax-Request-At": tsHeader,
      "Ax-Request-Device": DEVICE_HEADERS.device,
      "Ax-Request-Device-Model": DEVICE_HEADERS.model,
      "Ax-Request-Id": crypto.randomUUID(),
      "Ax-Substype": DEVICE_HEADERS.substype,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.ua,
    };

    const res = await fetchFn(`${config.baseCiamUrl}/realms/xl-ciam/protocol/openid-connect/token`, {
      method: "POST",
      headers,
      body: payload,
    });
    const body = (await res.json()) as TokenResponse & { error?: string };
    if (body.error || !body.refresh_token) return null;
    return body;
  }

  async function refreshToken(refreshToken: string, subscriberId = ""): Promise<TokenResponse | null> {
    const now = nowGmt7();
    const fp = await fingerprint();
    const axRequestAt = refreshAxRequestAtGmt7(now);

    const headers: Record<string, string> = {
      Host: ciamHost,
      "ax-request-at": axRequestAt,
      "ax-device-id": fp.deviceId,
      "ax-request-id": crypto.randomUUID(),
      "ax-request-device": DEVICE_HEADERS.device,
      "ax-request-device-model": DEVICE_HEADERS.model,
      "ax-fingerprint": fp.fingerprint,
      authorization: `Basic ${config.basicAuth}`,
      "user-agent": config.ua,
      "ax-substype": DEVICE_HEADERS.substype,
      "content-type": "application/x-www-form-urlencoded",
    };

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetchFn(`${config.baseCiamUrl}/realms/xl-ciam/protocol/openid-connect/token`, {
      method: "POST",
      headers,
      body,
    });

    if (res.status === 400) {
      const errBody = (await res.json()) as { error_description?: string };
      if (errBody.error_description !== "Session not active") return null;
      if (!subscriberId) return null;
      const exchangeCode = await extendSession(subscriberId);
      if (!exchangeCode) return null;
      return submitOtp("DEVICEID", subscriberId, exchangeCode);
    }

    if (!res.ok) return null;
    const json = (await res.json()) as TokenResponse & { error?: string };
    if (json.error || !json.id_token) return null;
    return json;
  }

  return { validateContact, getOtp, getOtpResult, extendSession, submitOtp, refreshToken };
}

export type CiamClient = ReturnType<typeof createCiamClient>;