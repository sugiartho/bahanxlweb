export interface PaymentItem {
  item_code: string;
  product_type: string;
  item_price: number;
  item_name: string;
  tax: number;
  token_confirmation: string;
}

export interface SettlementOptions {
  paymentFor: string;
  askOverwrite?: boolean;
  overwriteAmount?: number;
  tokenConfirmationIdx?: number;
  amountIdx?: number;
  topupNumber?: string;
  stageToken?: string;
}

export type EwalletMethod = "DANA" | "SHOPEEPAY" | "GOPAY" | "OVO";

export const EWALLET_FORM_METHODS: Record<string, EwalletMethod> = {
  ewallet_dana: "DANA",
  ewallet_shopeepay: "SHOPEEPAY",
  ewallet_gopay: "GOPAY",
  ewallet_ovo: "OVO",
};

export const ASYNC_PURCHASE_METHODS = new Set([
  "qris",
  "ewallet_dana",
  "ewallet_shopeepay",
  "ewallet_gopay",
  "ewallet_ovo",
  "decoy_balance",
  "decoy_balance_v2",
  "decoy_qris",
  "decoy_qris0",
]);

export function isAsyncPurchaseMethod(method: string): boolean {
  return ASYNC_PURCHASE_METHODS.has(method) || method.startsWith("decoy_custom_");
}