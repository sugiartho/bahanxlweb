import type { PaymentItem, SettlementOptions } from "./types";
import {
  postSignedSettlement,
  prepareSettlement,
  resolveAmount,
  resolvePaymentFor,
  type PurchaseRuntime,
} from "./common";

export async function settlementQris(
  rt: PurchaseRuntime,
  items: PaymentItem[],
  options: SettlementOptions,
): Promise<string | Record<string, unknown> | null> {
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
  const path = "payments/api/v8/settlement-multipayment/qris";
  const payload: Record<string, unknown> = {
    akrab: { akrab_members: [], akrab_parent_alias: "", members: [] },
    can_trigger_rating: false,
    total_discount: 0,
    coupon: "",
    payment_for: paymentFor,
    topup_number: options.topupNumber ?? "",
    stage_token: options.stageToken ?? "",
    is_enterprise: false,
    autobuy: {
      is_using_autobuy: false,
      activated_autobuy_code: "",
      autobuy_threshold_setting: { label: "", type: "", value: 0 },
    },
    access_token: rt.tokens.access_token,
    is_myxl_wallet: false,
    additional_data: {
      original_price: settlementItems[0].item_price,
      is_spend_limit_temporary: false,
      migration_type: "",
      spend_limit_amount: 0,
      is_spend_limit: false,
      tax: 0,
      benefit_type: "",
      quota_bonus: 0,
      cashtag: "",
      is_family_plan: false,
      combo_details: [],
      is_switch_plan: false,
      discount_recurring: 0,
      has_bonus: false,
      discount_promo: 0,
    },
    total_amount: Math.trunc(amount),
    total_fee: 0,
    is_use_point: false,
    lang: "en",
    items: settlementItems,
    verification_token: prep.tokenPayment,
    payment_method: "QRIS",
    timestamp: prep.tsToSign,
  };

  const res = await postSignedSettlement(rt, {
    path,
    payload,
    paymentTargets: prep.paymentTargets,
    tokenPayment: prep.tokenPayment,
    tsToSign: prep.tsToSign,
    paymentMethod: "QRIS",
    paymentFor,
  });

  if (typeof res !== "object" || res.status !== "SUCCESS") return res;
  const data = res.data as Record<string, unknown> | undefined;
  return String(data?.transaction_code ?? "");
}

export async function getQrisCode(
  rt: PurchaseRuntime,
  transactionId: string,
): Promise<string | null> {
  const res = await rt.engsel.sendApiRequest(
    "payments/api/v8/pending-detail",
    { transaction_id: transactionId, is_enterprise: false, lang: "en", status: "" },
    rt.tokens.id_token,
  );
  if (typeof res === "string" || res.status !== "SUCCESS") return null;
  const data = res.data as Record<string, unknown> | undefined;
  return data?.qr_code ? String(data.qr_code) : null;
}