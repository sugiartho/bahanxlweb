import type { PaymentItem } from "../clients/purchase/types";
import { extractApiErr } from "./family-loop-sse";
import { formatRp } from "../ssr/filters";

export function paymentForFromPackage(pkg: Record<string, unknown>, fallback = "BUY_PACKAGE"): string {
  const fam = (pkg.package_family as Record<string, unknown> | undefined) ?? {};
  const raw = String(fam.payment_for ?? "").trim();
  const fb = fallback.trim() || "BUY_PACKAGE";
  return raw || fb;
}

export function normalizePaymentItem(item: PaymentItem): PaymentItem {
  const price = Math.trunc(Number(item.item_price));
  return {
    item_code: String(item.item_code ?? "").trim(),
    product_type: String(item.product_type ?? ""),
    item_price: Number.isFinite(price) && price >= 0 ? price : 0,
    item_name: String(item.item_name ?? ""),
    tax: Math.trunc(Number(item.tax ?? 0)),
    token_confirmation: String(item.token_confirmation ?? "").trim(),
  };
}

export function buildPaymentItem(pkg: Record<string, unknown>): PaymentItem {
  const opt = (pkg.package_option as Record<string, unknown>) ?? {};
  return normalizePaymentItem({
    item_code: String(opt.package_option_code ?? ""),
    product_type: "",
    item_price: Number(opt.price ?? 0),
    item_name: String(opt.name ?? ""),
    tax: 0,
    token_confirmation: String(pkg.token_confirmation ?? ""),
  });
}

export function qrisImageUrl(qrisCode: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrisCode)}`;
}

export interface PurchaseResultContext {
  title: string;
  result_success: boolean;
  result_has_qr: boolean;
  has_qris_img: boolean;
  qris_img?: string;
  result?: Record<string, unknown>;
  result_json: string;
  has_result_data: boolean;
  transaction_code?: string;
  payment_method?: string;
  total_amount_rp?: string;
  result_details: Array<{
    name: string;
    amount_rp: string;
    code_short: string;
    status: string;
    status_success: boolean;
  }>;
  has_result_details: boolean;
  raw_qr_code?: string;
  job_pending?: boolean;
  job_id?: string;
  error_message?: string;
  has_error_message: boolean;
}

function truncateCode(code: string, max = 15): string {
  if (code.length <= max) return code;
  return `${code.slice(0, max)}...`;
}

export function formatPurchaseResult(
  title: string,
  result: unknown,
  qrisCode?: string | null,
  extras: { jobPending?: boolean; jobId?: string } = {},
): PurchaseResultContext {
  const obj = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const data = (obj?.data as Record<string, unknown> | undefined) ?? undefined;
  const hasQr = Boolean(qrisCode ?? obj?.qr_code);
  const qr = qrisCode ?? (obj?.qr_code ? String(obj.qr_code) : undefined);
  const success = obj?.status === "SUCCESS" || hasQr;
  const errorMessage = success ? undefined : extractApiErr(result);

  const details = (data?.details as Record<string, unknown>[] | undefined) ?? [];
  const formattedDetails = details.map((item) => {
    const status = String(item.status ?? "");
    return {
      name: String(item.name ?? ""),
      amount_rp: formatRp(item.amount),
      code_short: truncateCode(String(item.code ?? "")),
      status,
      status_success: status === "SUCCESS",
    };
  });

  return {
    title,
    result_success: success,
    result_has_qr: hasQr,
    has_qris_img: Boolean(qr),
    qris_img: qr ? qrisImageUrl(qr) : undefined,
    result: obj ?? undefined,
    result_json: JSON.stringify(result ?? null, null, 2),
    has_result_data: Boolean(data),
    transaction_code: data?.transaction_code ? String(data.transaction_code) : undefined,
    payment_method: data?.payment_method ? String(data.payment_method) : undefined,
    total_amount_rp: data ? formatRp(data.total_amount ?? 0) : undefined,
    result_details: formattedDetails,
    has_result_details: formattedDetails.length > 0,
    raw_qr_code: qr,
    job_pending: extras.jobPending,
    job_id: extras.jobId,
    error_message: errorMessage,
    has_error_message: Boolean(errorMessage),
  };
}