import { describe, expect, it } from "vitest";
import { renderLayout } from "./engine";

describe("MyXL templates", () => {
  it("renders login page with OTP form", () => {
    const html = renderLayout("login", new Request("http://localhost/login"), {
      page_title: "Login",
      show_tab_login: true,
      pending_otp: false,
      phone: "",
      tabs: [{ id: "login", icon: "fa-solid fa-key", label: "Login", active: true, href: "?tab=login" }],
    });
    expect(html).toContain("Login pakai OTP");
    expect(html).toContain("/login/request-otp");
  });

  it("renders bookmark page", () => {
    const html = renderLayout("bookmark", new Request("http://localhost/bookmark"), {
      page_title: "Bookmark",
      has_bookmarks: true,
      bookmarks: [{ family_name: "F", variant_name: "V", option_name: "O", order: 1, family_code: "FC", is_enterprise: false }],
    });
    expect(html).toContain("Bookmark");
    expect(html).toContain("/bookmark/remove");
  });

  it("renders circle page with forms", () => {
    const html = renderLayout("circle", new Request("http://localhost/circle"), {
      page_title: "Circle",
      group_json: "{}",
      has_members: false,
      has_spend: false,
      has_bonus: false,
      group_id: "G1",
    });
    expect(html).toContain("/circle/invite");
    expect(html).toContain("/circle/create");
  });

  it("renders register form", () => {
    const html = renderLayout("register", new Request("http://localhost/register"), {
      page_title: "Register",
      has_res: false,
      msisdn: "",
    });
    expect(html).toContain("Register (Dukcapil)");
    expect(html).toContain("/register/puk");
  });

  it("renders family loop form", () => {
    const html = renderLayout("family_loop", new Request("http://localhost/purchase/family-loop"), {
      page_title: "Loop Beli Family",
      family_code: "FAM-123",
    });
    expect(html).toContain("Loop Beli Family");
    expect(html).toContain("/purchase/family-loop/start");
    expect(html).toContain("FAM-123");
  });

  it("renders purchase result items with neumorphic styling", () => {
    const html = renderLayout("purchase_result", new Request("http://localhost/purchase/OPT1"), {
      page_title: "Pembelian Pulsa",
      title: "Pembelian Pulsa",
      result_json: "{}",
      result_success: true,
      result_has_qr: false,
      has_qris_img: false,
      has_result_data: true,
      has_result_details: true,
      transaction_code: "TRX-001",
      payment_method: "BALANCE",
      total_amount_rp: "Rp 100.000",
      result_details: [
        {
          name: "myPRIO Silver Talk+",
          amount_rp: "Rp 100.000",
          code_short: "U0NfXytz3XbzYxN...",
          status: "SUCCESS",
          status_success: true,
        },
      ],
    });
    expect(html).toContain("Item Dibeli");
    expect(html).toContain("neu-box-sm");
    expect(html).toContain("myPRIO Silver Talk+");
  });

  it("renders purchase result with pending job poll", () => {
    const html = renderLayout("purchase_result", new Request("http://localhost/purchase/OPT1"), {
      page_title: "Pembelian",
      title: "Memproses pembelian…",
      job_pending: true,
      job_id: "job-123",
      result_json: "{}",
      result_success: false,
      result_has_qr: false,
      has_qris_img: false,
      has_result_data: false,
      has_result_details: false,
      result_details: [],
    });
    expect(html).toContain("/internal/jobs/purchase/job-123");
    expect(html).toContain("Memproses pembelian");
  });

  it("renders my packages with Aktif s/d date", () => {
    const html = renderLayout("my_packages", new Request("http://localhost/packages/my"), {
      page_title: "Paket Saya",
      has_quotas: true,
      quotas: [
        {
          name: "Xtra Combo",
          quota_code: "OPT1",
          group_name: "Internet",
          has_expired_at: true,
          expired_at_display: "15 Juni 2026",
          has_benefits: false,
          benefits: [],
          product_domain: "",
          product_subscription_type: "",
        },
      ],
    });
    expect(html).toContain("Aktif s/d 15 Juni 2026");
  });

  it("renders dashboard with active user", () => {
    const html = renderLayout("dashboard", new Request("http://localhost/"), {
      page_title: "Beranda",
      active_user: { number: 6281234567890, subscription_type: "PREPAID" },
      dashboard_stats: [{ label: "Pulsa", value: "Rp 10.000" }],
      active_packages_count: 2,
      has_tier: false,
    });
    expect(html).toContain("6281234567890");
    expect(html).toContain("Paket Aktif");
  });

  it("renders package detail with decoy purchase methods", () => {
    const html = renderLayout("package_detail", new Request("http://localhost/packages/by-option"), {
      page_title: "XL PASS 20 Days",
      fam_name: "XL PASS",
      opt_name: "XL PASS 20 Days",
      opt_price: 800000,
      opt_price_rp: "Rp 800.000",
      opt_validity: "20 days",
      option_code: "OPT-1",
      family_code: "fff99b6b-5a5d-4ba4-a55b-38f6aca6f91d",
      variant_code: "6986897d-9f09-4651-ac24-6efdf3dbcf3d",
      payment_for: "BUY_PACKAGE",
      plan_type: "PREPAID",
      is_enterprise: false,
      opt_order: 1,
      has_variant: false,
      has_benefits: false,
      has_tnc: false,
      has_custom_decoys: true,
      custom_decoys: [{ name: "v1", label: "Pulsa + Decoy (v1)", is_qris: false }],
    });
    expect(html).toContain("Pulsa + Decoy V2");
    expect(html).toContain("QRIS + Decoy (+1K)");
    expect(html).toContain("decoy_custom_v1");
    expect(html).toContain('name="qris_amount"');
  });

  it("renders decoy settings with test endpoint", () => {
    const html = renderLayout("decoy_settings", new Request("http://localhost/settings/decoy"), {
      page_title: "Decoy",
      has_msg: false,
      builtins: [
        {
          key: "default-balance",
          label: "Default · Pulsa",
          subtype: "Reguler",
          kind: "builtin",
          name: "default-balance",
          family_name: "",
          family_code: "",
          variant_name: "",
          variant_code: "",
          option_name: "",
          order: 1,
          price: 0,
          is_enterprise_checked: false,
          show_base_method: false,
          base_method: "balance",
          base_method_balance_selected: true,
          base_method_qris_selected: false,
          base_method_qris_class: "",
          has_family_code: false,
          family_code_short: "",
          raw_json: "{}",
          mt_NONE: true,
          mt_PRE_TO_PRIOH: false,
          mt_PRIOH_TO_PRIO: false,
          mt_PRIO_TO_PRIOH: false,
          show_delete: false,
        },
      ],
      customs: [],
      customs_count: 0,
      has_customs: false,
    });
    expect(html).toContain('data-test="builtin/default-balance"');
    expect(html).toContain("/settings/decoy/builtin/default-balance");
    expect(html).toContain("Pengaturan Decoy");
  });

  it("renders theme settings form", () => {
    const html = renderLayout("theme_settings", new Request("http://localhost/settings/theme"), {
      page_title: "Tema",
      current_theme: "dark",
      is_dark: true,
      is_light: false,
      has_msg: false,
    });
    expect(html).toContain("/settings/theme");
    expect(html).toContain('value="light"');
  });

  it("renders transactions with badge classes", () => {
    const html = renderLayout("transactions", new Request("http://localhost/transactions"), {
      page_title: "Transaksi",
      has_items: true,
      items_count: 1,
      items: [
        {
          title: "Paket",
          price: "IDR 1000",
          validity: "",
          dt: "01 Jan 2026",
          payment_method: "QRIS",
          status: "SUCCESS",
          status_bg_class: "bg-emerald-500/15",
          status_text_class: "text-emerald-300",
          status_border_class: "border-emerald-500/30",
          status_emoji: "",
          payment_status: "",
          payment_status_bg_class: "",
          payment_status_text_class: "",
          payment_status_border_class: "",
          payment_status_emoji: "",
          show_payment_status: false,
          target: "",
          trx_code: "TRX1",
          icon_data_uri: "",
          pm_icon_data_uri: "",
          has_icon: false,
        },
      ],
      raw_json: "{}",
    });
    expect(html).toContain("bg-emerald-500/15");
    expect(html).toContain("TRX1");
  });
});