import { hostFromUrl } from "../config";
import { GMT7_OFFSET_MIN, javaLikeTimestamp } from "../time";
import { decryptApiResponse, encryptSignXdata } from "../xdata";
import {
  buildEncryptedField,
  makeXSignatureBounty,
  makeXSignatureBountyAllotment,
  makeXSignatureLoyalty,
  randomIvHex16,
} from "../../crypto/crypto-helper";
import type { PurchaseRuntime } from "./common";

const BOUNTY_PATH = "api/v8/personalization/bounties-exchange";
const LOYALTY_PATH = "gamification/api/v8/loyalties/tiering/exchange";
const ALLOTMENT_PATH = "gamification/api/v8/loyalties/tiering/bounties-allotment";

async function postSignedRedeem(
  rt: PurchaseRuntime,
  path: string,
  payload: Record<string, unknown>,
  tsToSign: number,
  xSignature: string,
): Promise<Record<string, unknown> | string> {
  const fetchFn = rt.fetchFn ?? fetch;
  const apiHost = hostFromUrl(rt.config.baseApiUrl);
  const encrypted = await encryptSignXdata(
    rt.config.crypto,
    "POST",
    path,
    rt.tokens.id_token,
    { ...payload, timestamp: tsToSign },
  );
  const sigTimeSec = Math.floor(encrypted.encrypted_body.xtime / 1000);
  const headers: Record<string, string> = {
    host: apiHost,
    "content-type": "application/json; charset=utf-8",
    "user-agent": rt.config.ua,
    "x-api-key": rt.config.apiKey,
    authorization: `Bearer ${rt.tokens.id_token}`,
    "x-hv": "v3",
    "x-signature-time": String(sigTimeSec),
    "x-signature": xSignature,
    "x-request-id": crypto.randomUUID(),
    "x-request-at": javaLikeTimestamp(new Date(sigTimeSec * 1000), { offsetMinutes: GMT7_OFFSET_MIN }),
    "x-version-app": "8.9.0",
  };

  const res = await fetchFn(`${rt.config.baseApiUrl}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(encrypted.encrypted_body),
  });
  return decryptApiResponse(rt.config.crypto, await res.text());
}

export async function settlementBounty(
  rt: PurchaseRuntime,
  args: {
    tokenConfirmation: string;
    tsToSign: number;
    paymentTarget: string;
    price: number;
    itemName?: string;
  },
): Promise<Record<string, unknown> | string> {
  const encryptedPayment = await buildEncryptedField(rt.config.crypto, randomIvHex16(), true);
  const encryptedAuth = await buildEncryptedField(rt.config.crypto, randomIvHex16(), true);
  const payload: Record<string, unknown> = {
    total_discount: 0,
    is_enterprise: false,
    payment_token: "",
    token_payment: "",
    activated_autobuy_code: "",
    cc_payment_type: "",
    is_myxl_wallet: false,
    pin: "",
    ewallet_promo_id: "",
    members: [],
    total_fee: 0,
    fingerprint: "",
    autobuy_threshold_setting: { label: "", type: "", value: 0 },
    is_use_point: false,
    lang: "en",
    payment_method: "BALANCE",
    points_gained: 0,
    can_trigger_rating: false,
    akrab_members: [],
    akrab_parent_alias: "",
    referral_unique_code: "",
    coupon: "",
    payment_for: "REDEEM_VOUCHER",
    with_upsell: false,
    topup_number: "",
    stage_token: "",
    authentication_id: "",
    encrypted_payment_token: encryptedPayment,
    token: "",
    token_confirmation: args.tokenConfirmation,
    access_token: rt.tokens.access_token,
    wallet_number: "",
    encrypted_authentication_id: encryptedAuth,
    additional_data: {
      original_price: 0,
      is_spend_limit_temporary: false,
      migration_type: "",
      akrab_m2m_group_id: "",
      spend_limit_amount: 0,
      is_spend_limit: false,
      mission_id: "",
      tax: 0,
      benefit_type: "",
      quota_bonus: 0,
      cashtag: "",
      is_family_plan: false,
      combo_details: [],
      is_switch_plan: false,
      discount_recurring: 0,
      is_akrab_m2m: false,
      balance_type: "",
      has_bonus: false,
      discount_promo: 0,
    },
    total_amount: 0,
    is_using_autobuy: false,
    items: [
      {
        item_code: args.paymentTarget,
        product_type: "",
        item_price: args.price,
        item_name: args.itemName ?? "",
        tax: 0,
      },
    ],
  };

  const xSig = await makeXSignatureBounty(
    rt.config.crypto,
    rt.tokens.access_token,
    args.tsToSign,
    args.paymentTarget,
    args.tokenConfirmation,
  );
  return postSignedRedeem(rt, BOUNTY_PATH, payload, args.tsToSign, xSig);
}

export async function settlementLoyalty(
  rt: PurchaseRuntime,
  args: {
    tokenConfirmation: string;
    tsToSign: number;
    paymentTarget: string;
    points: number;
  },
): Promise<Record<string, unknown> | string> {
  const payload: Record<string, unknown> = {
    item_code: args.paymentTarget,
    amount: 0,
    partner: "",
    is_enterprise: false,
    item_name: "",
    lang: "en",
    points: args.points,
    token_confirmation: args.tokenConfirmation,
  };

  const xSig = await makeXSignatureLoyalty(
    rt.config.crypto,
    args.tsToSign,
    args.paymentTarget,
    args.tokenConfirmation,
    LOYALTY_PATH,
  );
  return postSignedRedeem(rt, LOYALTY_PATH, payload, args.tsToSign, xSig);
}

export async function bountyAllotment(
  rt: PurchaseRuntime,
  args: {
    tokenConfirmation: string;
    tsToSign: number;
    destinationMsisdn: string;
    itemCode: string;
    itemName: string;
  },
): Promise<Record<string, unknown> | string> {
  const payload: Record<string, unknown> = {
    destination_msisdn: args.destinationMsisdn,
    item_code: args.itemCode,
    is_enterprise: false,
    item_name: args.itemName,
    lang: "en",
    token_confirmation: args.tokenConfirmation,
  };

  const xSig = await makeXSignatureBountyAllotment(
    rt.config.crypto,
    args.tsToSign,
    args.itemCode,
    args.tokenConfirmation,
    ALLOTMENT_PATH,
    args.destinationMsisdn,
  );
  return postSignedRedeem(rt, ALLOTMENT_PATH, payload, args.tsToSign, xSig);
}