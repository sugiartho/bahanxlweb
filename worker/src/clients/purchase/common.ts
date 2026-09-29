import type { FetchFn } from "../ciam";
import type { MyXlClientConfig } from "../config";
import { hostFromUrl } from "../config";
import type { EngselClient } from "../engsel";
import { GMT7_OFFSET_MIN, javaLikeTimestamp } from "../time";
import { decryptApiResponse, encryptSignXdata } from "../xdata";
import { buildEncryptedField, makeXSignaturePayment, randomIvHex16 } from "../../crypto/crypto-helper";
import type { MyXlTokens } from "../../myxl/accounts";
import { normalizePaymentItem } from "../../myxl/purchase";
import type { PaymentItem } from "./types";

export interface PurchaseRuntime {
  config: MyXlClientConfig;
  engsel: EngselClient;
  tokens: MyXlTokens;
  fetchFn?: FetchFn;
}

export interface PaymentMethodsData {
  token_payment: string;
  timestamp: number;
}

export function buildPaymentTargets(items: PaymentItem[]): string {
  return items.map((item) => item.item_code).join(";");
}

export function resolveItemIndex(items: PaymentItem[], idx: number): number {
  if (idx < 0) return items.length + idx;
  return idx;
}

export function resolveAmount(
  items: PaymentItem[],
  overwriteAmount: number,
  amountIdx: number,
): number {
  if (overwriteAmount !== -1) return Math.trunc(overwriteAmount);
  const idx = resolveItemIndex(items, amountIdx);
  return Math.trunc(items[idx]?.item_price ?? 0);
}

export function resolvePaymentFor(value: string | undefined): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "BUY_PACKAGE";
}

export function normalizeSettlementItems(items: PaymentItem[]): PaymentItem[] {
  return items.map((item) => normalizePaymentItem(item));
}

export async function getPaymentMethods(
  rt: PurchaseRuntime,
  tokenConfirmation: string,
  paymentTarget: string,
): Promise<PaymentMethodsData | Record<string, unknown>> {
  const res = await rt.engsel.sendApiRequest(
    "payments/api/v8/payment-methods-option",
    {
      payment_type: "PURCHASE",
      is_enterprise: false,
      payment_target: paymentTarget,
      lang: "en",
      is_referral: false,
      token_confirmation: tokenConfirmation,
    },
    rt.tokens.id_token,
  );
  if (typeof res === "string" || res.status !== "SUCCESS") return res as Record<string, unknown>;
  const data = res.data as Record<string, unknown>;
  return {
    token_payment: String(data.token_payment ?? ""),
    timestamp: Number(data.timestamp ?? 0),
  };
}

export interface SignedSettlementRequest {
  path: string;
  payload: Record<string, unknown>;
  paymentTargets: string;
  tokenPayment: string;
  tsToSign: number;
  paymentMethod: string;
  paymentFor: string;
}

export async function postSignedSettlement(
  rt: PurchaseRuntime,
  req: SignedSettlementRequest,
): Promise<Record<string, unknown> | string> {
  const fetchFn = rt.fetchFn ?? fetch;
  const apiHost = hostFromUrl(rt.config.baseApiUrl);
  const paymentFor = resolvePaymentFor(req.paymentFor);
  const payload = { ...req.payload, timestamp: req.tsToSign };
  const encrypted = await encryptSignXdata(
    rt.config.crypto,
    "POST",
    req.path,
    rt.tokens.id_token,
    payload,
  );
  const xtime = encrypted.encrypted_body.xtime;
  const sigTimeSec = Math.floor(xtime / 1000);
  const xSig = await makeXSignaturePayment(
    rt.config.crypto,
    rt.tokens.access_token,
    req.tsToSign,
    req.paymentTargets,
    req.tokenPayment,
    req.paymentMethod,
    paymentFor,
    req.path,
  );

  const headers: Record<string, string> = {
    host: apiHost,
    "content-type": "application/json; charset=utf-8",
    "user-agent": rt.config.ua,
    "x-api-key": rt.config.apiKey,
    authorization: `Bearer ${rt.tokens.id_token}`,
    "x-hv": "v3",
    "x-signature-time": String(sigTimeSec),
    "x-signature": xSig,
    "x-request-id": crypto.randomUUID(),
    "x-request-at": javaLikeTimestamp(new Date(sigTimeSec * 1000), { offsetMinutes: GMT7_OFFSET_MIN }),
    "x-version-app": "8.9.0",
  };

  const res = await fetchFn(`${rt.config.baseApiUrl}/${req.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(encrypted.encrypted_body),
  });
  return decryptApiResponse(rt.config.crypto, await res.text());
}

export async function prepareSettlement(
  rt: PurchaseRuntime,
  items: PaymentItem[],
  tokenConfirmationIdx: number,
): Promise<
  | { ok: true; tokenPayment: string; tsToSign: number; paymentTargets: string; items: PaymentItem[] }
  | { ok: false; error: Record<string, unknown> | string }
> {
  const normalizedItems = normalizeSettlementItems(items);
  if (!normalizedItems.length || !normalizedItems[0].item_code) {
    return { ok: false, error: { status: "FAILED", message: "Item pembayaran tidak valid." } };
  }

  await rt.engsel.interceptPage(rt.tokens.id_token, normalizedItems[0].item_code, false);
  const idx = resolveItemIndex(normalizedItems, tokenConfirmationIdx);
  const tokenConfirmation = normalizedItems[idx].token_confirmation;
  const paymentTarget = normalizedItems[idx].item_code;
  if (!tokenConfirmation) {
    return {
      ok: false,
      error: {
        status: "FAILED",
        message: "token_confirmation kosong. Muat ulang halaman paket lalu coba lagi.",
      },
    };
  }
  const methods = await getPaymentMethods(rt, tokenConfirmation, paymentTarget);
  if (!("token_payment" in methods)) {
    return { ok: false, error: methods };
  }
  return {
    ok: true,
    tokenPayment: String(methods.token_payment),
    tsToSign: Number(methods.timestamp),
    paymentTargets: buildPaymentTargets(normalizedItems),
    items: normalizedItems,
  };
}

export async function buildBalanceEncryptedFields(rt: PurchaseRuntime) {
  const iv = randomIvHex16();
  return {
    encrypted_payment_token: await buildEncryptedField(rt.config.crypto, iv, true),
    encrypted_authentication_id: await buildEncryptedField(rt.config.crypto, randomIvHex16(), true),
  };
}