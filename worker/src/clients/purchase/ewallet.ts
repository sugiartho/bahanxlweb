import type { EwalletMethod, PaymentItem, SettlementOptions } from "./types";
import {
  postSignedSettlement,
  prepareSettlement,
  resolveAmount,
  resolvePaymentFor,
  type PurchaseRuntime,
} from "./common";

export async function settlementMultipayment(
  rt: PurchaseRuntime,
  items: PaymentItem[],
  walletNumber: string,
  paymentMethod: EwalletMethod,
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
  const path = "payments/api/v8/settlement-multipayment/ewallet";
  const payload: Record<string, unknown> = {
    akrab: { akrab_members: [], akrab_parent_alias: "", members: [] },
    can_trigger_rating: false,
    total_discount: 0,
    coupon: "",
    payment_for: paymentFor,
    topup_number: "",
    is_enterprise: false,
    autobuy: {
      is_using_autobuy: false,
      activated_autobuy_code: "",
      autobuy_threshold_setting: { label: "", type: "", value: 0 },
    },
    cc_payment_type: "",
    access_token: rt.tokens.access_token,
    is_myxl_wallet: false,
    wallet_number: walletNumber,
    additional_data: {},
    total_amount: Math.trunc(amount),
    total_fee: 0,
    is_use_point: false,
    lang: "en",
    items: settlementItems,
    verification_token: prep.tokenPayment,
    payment_method: paymentMethod,
    timestamp: prep.tsToSign,
  };

  return postSignedSettlement(rt, {
    path,
    payload,
    paymentTargets: prep.paymentTargets,
    tokenPayment: prep.tokenPayment,
    tsToSign: prep.tsToSign,
    paymentMethod,
    paymentFor,
  });
}