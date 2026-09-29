import { formatRp, humanizeBytes } from "../ssr/filters";

export function formatPoints(value: unknown): string {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return String(value ?? "-");
  return `${n.toLocaleString("id-ID")} Poin`;
}

export function formatPackageDetail(pkg: Record<string, unknown>, code: string) {
  const opt = (pkg.package_option as Record<string, unknown>) ?? {};
  const fam = (pkg.package_family as Record<string, unknown>) ?? {};
  const variant = (pkg.package_detail_variant as Record<string, unknown>) ?? null;
  const pkgVariant = (pkg.package_variant as Record<string, unknown> | undefined) ?? null;
  const optionCode = String(opt.package_option_code ?? code);
  const familyCode = String(fam.package_family_code ?? "");
  const variantCode = String(
    pkgVariant?.package_variant_code ?? (variant as Record<string, unknown> | null)?.package_variant_code ?? "",
  );
  const benefits = ((opt.benefits as Record<string, unknown>[]) ?? []).map((b) => {
    const dt = String(b.data_type ?? "");
    const total = Number(b.total ?? 0);
    let totalDisp = "";
    if (dt === "DATA" && total) totalDisp = humanizeBytes(total);
    else if (dt === "VOICE" && total) totalDisp = `${Math.round(total / 60)} menit`;
    else if (dt === "TEXT" && total) totalDisp = `${total} SMS`;
    else if (total) totalDisp = `${total} (${dt})`;
    return {
      name: b.name ?? "",
      data_type: dt,
      is_data: dt === "DATA",
      is_voice: dt === "VOICE",
      is_text: dt === "TEXT",
      total_disp: totalDisp,
      has_total: Boolean(total),
      is_unlimited: Boolean(b.is_unlimited),
    };
  });

  const paymentFor = String(fam.payment_for ?? "BUY_PACKAGE");
  const rcBonusType = String(fam.rc_bonus_type ?? "");
  const usesPointsCurrency = rcBonusType === "MYREWARDS" || paymentFor === "REDEEM_VOUCHER";
  const optPrice = opt.price;

  return {
    code,
    option_code: optionCode,
    family_code: familyCode,
    variant_code: variantCode,
    opt_name: opt.name ?? "",
    opt_price: optPrice,
    opt_price_rp: usesPointsCurrency ? formatPoints(optPrice) : formatRp(optPrice),
    uses_points_currency: usesPointsCurrency,
    is_redeem_voucher: paymentFor === "REDEEM_VOUCHER",
    opt_validity: opt.validity ?? "",
    has_point: Boolean(opt.point),
    opt_point: opt.point,
    fam_name: fam.name ?? "",
    variant_name: variant ? String(variant.name ?? "") : "",
    has_variant: Boolean(variant),
    payment_for: paymentFor,
    plan_type: fam.plan_type ?? "",
    is_enterprise: Boolean(fam.is_enterprise),
    opt_order: opt.order ?? 0,
    has_benefits: benefits.length > 0,
    benefits,
    has_tnc: Boolean(opt.tnc),
    tnc_html: String(opt.tnc ?? ""),
    custom_decoys: [] as unknown[],
    has_custom_decoys: false,
  };
}

export function formatFamilyDetail(family: Record<string, unknown>, code: string) {
  const fam = (family.package_family as Record<string, unknown>) ?? {};
  const usesPointsCurrency =
    String(fam.rc_bonus_type ?? "") === "MYREWARDS" || String(fam.payment_for ?? "") === "REDEEM_VOUCHER";
  const variants = ((family.package_variants as Record<string, unknown>[]) ?? []).map((variant) => ({
    name: variant.name ?? "",
    options: ((variant.package_options as Record<string, unknown>[]) ?? []).map((opt) => ({
      name: opt.name ?? "",
      package_option_code: opt.package_option_code ?? "",
      price: opt.price,
      price_rp: usesPointsCurrency ? formatPoints(opt.price) : formatRp(opt.price),
      validity: opt.validity ?? "",
      has_point: Boolean(opt.point),
      point: opt.point,
    })),
    has_options: ((variant.package_options as unknown[]) ?? []).length > 0,
  }));
  return {
    code,
    fam_name: fam.name ?? "",
    payment_for: String(fam.payment_for ?? "BUY_PACKAGE"),
    plan_type: fam.plan_type ?? "",
    has_variants: variants.length > 0,
    variants,
  };
}