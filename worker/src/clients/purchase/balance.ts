import type { PaymentItem, SettlementOptions } from "./types";
import {
  buildBalanceEncryptedFields,
  postSignedSettlement,
  prepareSettlement,
  resolveAmount,
  resolvePaymentFor,
  type PurchaseRuntime,
} from "./common";

export async function settlementBalance(
  rt: PurchaseRuntime,
  items: PaymentItem[],
  options: SettlementOptions,
): Promise<Record<string, unknown> | string | null> {
  const askOverwrite = options.askOverwrite ?? false;
  const overwriteAmount = options.overwriteAmount ?? -1;
  if (overwriteAmount === -1 && !askOverwrite) return null;

  const tokenIdx = options.tokenConfirmationIdx ?? 0;
  const amountIdx = options.amountIdx ?? -1;
  const amount = resolveAmount(items, overwriteAmount, amountIdx);

  const prep = await prepareSettlement(rt, items, tokenIdx);
  if (!prep.ok) return prep.error;

  const paymentFor = resolvePaymentFor(options.paymentFor);
  const settlementItems = prep.items;
  const encrypted = await buildBalanceEncryptedFields(rt);
  const path = "payments/api/v8/settlement-multipayment";
  const payload: Record<string, unknown> = {
    total_discount: 0,
    is_enterprise: false,
    payment_token: "",
    token_payment: prep.tokenPayment,
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
    timestamp: prep.tsToSign,
    points_gained: 0,
    can_trigger_rating: false,
    akrab_members: [],
    akrab_parent_alias: "",
    referral_unique_code: "",
    coupon: "",
    payment_for: paymentFor,
    with_upsell: false,
    topup_number: options.topupNumber ?? "",
    stage_token: options.stageToken ?? "",
    authentication_id: "",
    encrypted_payment_token: encrypted.encrypted_payment_token,
    token: "",
    token_confirmation: "",
    access_token: rt.tokens.access_token,
    wallet_number: "",
    encrypted_authentication_id: encrypted.encrypted_authentication_id,
    additional_data: {
      original_price: settlementItems[settlementItems.length - 1].item_price,
      is_spend_limit_temporary: false,
      migration_type: "",
      akrab_m2m_group_id: "false",
      spend_limit_amount: 0,
      is_spend_limit: false,
      mission_id: "",
      tax: 0,
      quota_bonus: 0,
      cashtag: "",
      is_family_plan: false,
      combo_details: [],
      is_switch_plan: false,
      discount_recurring: 0,
      is_akrab_m2m: false,
      balance_type: "PREPAID_BALANCE",
      has_bonus: false,
      discount_promo: 0,
    },
    total_amount: Math.trunc(amount),
    is_using_autobuy: false,
    items: settlementItems,
  };

  return postSignedSettlement(rt, {
    path,
    payload,
    paymentTargets: prep.paymentTargets,
    tokenPayment: prep.tokenPayment,
    tsToSign: prep.tsToSign,
    paymentMethod: "BALANCE",
    paymentFor,
  });
}

export async function settlementBalanceWithRetry(
  rt: PurchaseRuntime,
  items: PaymentItem[],
  options: SettlementOptions,
): Promise<Record<string, unknown> | string | null> {
  let res = await settlementBalance(rt, items, options);
  if (res == null || typeof res !== "object" || res.status === "SUCCESS") return res;
  const errMsg = String(res.message ?? "");
  if (!errMsg.includes("Bizz-err.Amount.Total") || !errMsg.includes("=")) return res;
  try {
    const validAmount = Number.parseInt(errMsg.split("=")[1].trim(), 10);
    const retryOpts = { ...options, overwriteAmount: validAmount };
    if (options.tokenConfirmationIdx === 1) {
      retryOpts.tokenConfirmationIdx = -1;
    }
    return settlementBalance(rt, items, retryOpts);
  } catch {
    return res;
  }
}