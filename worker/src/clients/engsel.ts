import type { MyXlClientConfig } from "./config";
import { hostFromUrl } from "./config";
import { decryptApiResponse, encryptSignXdata } from "./xdata";
import { GMT7_OFFSET_MIN, javaLikeTimestamp } from "./time";

import type { FetchFn } from "./ciam";

export interface EngselTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
}

export interface EngselClientOptions {
  config: MyXlClientConfig;
  fetchFn?: FetchFn;
}

export function createEngselClient(options: EngselClientOptions) {
  const { config } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const apiHost = hostFromUrl(config.baseApiUrl);

  async function sendApiRequest(
    path: string,
    payload: Record<string, unknown>,
    idToken: string,
    method = "POST",
    nowMs?: number,
  ): Promise<Record<string, unknown> | string> {
    const signed = await encryptSignXdata(config.crypto, method, path, idToken, payload, nowMs);
    const xtime = signed.encrypted_body.xtime;
    const sigTimeSec = Math.floor(xtime / 1000);
    const body = signed.encrypted_body;
    const now = new Date();

    const headers: Record<string, string> = {
      host: apiHost,
      "content-type": "application/json; charset=utf-8",
      "user-agent": config.ua,
      "x-api-key": config.apiKey,
      authorization: `Bearer ${idToken}`,
      "x-hv": "v3",
      "x-signature-time": String(sigTimeSec),
      "x-signature": signed.x_signature,
      "x-request-id": crypto.randomUUID(),
      "x-request-at": javaLikeTimestamp(now, { offsetMinutes: GMT7_OFFSET_MIN }),
      "x-version-app": "8.9.0",
    };

    const res = await fetchFn(`${config.baseApiUrl}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    return decryptApiResponse(config.crypto, await res.text());
  }

  async function getProfile(accessToken: string, idToken: string) {
    const res = await sendApiRequest(
      "api/v8/profile",
      { access_token: accessToken, app_version: "8.9.0", is_enterprise: false, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || !res.data) return null;
    return res.data as Record<string, unknown>;
  }

  async function getBalance(idToken: string) {
    const res = await sendApiRequest(
      "api/v8/packages/balance-and-credit",
      { is_enterprise: false, lang: "en" },
      idToken,
    );
    if (typeof res === "string") return null;
    const data = res.data as Record<string, unknown> | undefined;
    return (data?.balance as Record<string, unknown>) ?? null;
  }

  async function getQuotaDetails(idToken: string, familyMemberId = "") {
    const res = await sendApiRequest(
      "api/v8/packages/quota-details",
      { is_enterprise: false, lang: "en", family_member_id: familyMemberId },
      idToken,
    );
    if (typeof res === "string" || res.status !== "SUCCESS") return null;
    return res.data as Record<string, unknown>;
  }

  async function getTieringInfo(idToken: string) {
    const res = await sendApiRequest(
      "gamification/api/v8/loyalties/tiering/info",
      { is_enterprise: false, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || !res.data) return null;
    return res.data as Record<string, unknown>;
  }

  async function getFamily(
    idToken: string,
    familyCode: string,
    isEnterprise?: boolean,
    migrationType?: string,
  ): Promise<Record<string, unknown> | null> {
    const migrationTypes = migrationType
      ? [migrationType]
      : ["NONE", "PRE_TO_PRIOH", "PRIOH_TO_PRIO", "PRIO_TO_PRIOH"];
    const enterpriseFlags = isEnterprise !== undefined ? [isEnterprise] : [false, true];

    for (const mt of migrationTypes) {
      for (const ie of enterpriseFlags) {
        const res = await sendApiRequest(
          "api/v8/xl-stores/options/list",
          {
            is_show_tagging_tab: true,
            is_dedicated_event: true,
            is_transaction_routine: false,
            migration_type: mt,
            package_family_code: familyCode,
            is_autobuy: false,
            is_enterprise: ie,
            is_pdlp: true,
            referral_code: "",
            is_migration: false,
            lang: "en",
          },
          idToken,
        );
        if (typeof res === "string" || res.status !== "SUCCESS") continue;
        const data = res.data as Record<string, unknown> | undefined;
        const family = (data?.package_family as Record<string, unknown>) ?? {};
        if (family.name) return data ?? null;
      }
    }
    return null;
  }

  async function getPackage(
    idToken: string,
    packageOptionCode: string,
    packageFamilyCode = "",
    packageVariantCode = "",
  ): Promise<Record<string, unknown> | null> {
    const res = await sendApiRequest(
      "api/v8/xl-stores/options/detail",
      {
        is_transaction_routine: false,
        migration_type: "NONE",
        package_family_code: packageFamilyCode,
        family_role_hub: "",
        is_autobuy: false,
        is_enterprise: false,
        is_shareable: false,
        is_migration: false,
        lang: "en",
        package_option_code: packageOptionCode,
        is_upsell_pdp: false,
        package_variant_code: packageVariantCode,
      },
      idToken,
    );
    if (typeof res === "string" || !res.data) return null;
    return res.data as Record<string, unknown>;
  }

  async function unsubscribePackage(
    idToken: string,
    quotaCode: string,
    productDomain: string,
    productSubscriptionType: string,
  ): Promise<boolean> {
    const res = await sendApiRequest(
      "api/v8/packages/unsubscribe",
      {
        product_subscription_type: productSubscriptionType,
        quota_code: quotaCode,
        product_domain: productDomain,
        is_enterprise: false,
        unsubscribe_reason_code: "",
        lang: "en",
        family_member_id: "",
      },
      idToken,
    );
    return typeof res !== "string" && res?.code === "000";
  }

  async function getQuotaDetailsRaw(idToken: string, familyMemberId = "") {
    const res = await sendApiRequest(
      "api/v8/packages/quota-details",
      { is_enterprise: false, lang: "en", family_member_id: familyMemberId },
      idToken,
    );
    if (typeof res === "string") return null;
    return res as Record<string, unknown>;
  }

  async function loginInfo(tokens: EngselTokens, isEnterprise = false) {
    const res = await sendApiRequest(
      "api/v8/auth/login",
      { access_token: tokens.access_token, is_enterprise: isEnterprise, lang: "en" },
      tokens.id_token,
    );
    if (typeof res === "string" || !res.data) return null;
    return res.data as Record<string, unknown>;
  }

  async function interceptPage(idToken: string, optionCode: string, isEnterprise = false): Promise<void> {
    await sendApiRequest(
      "misc/api/v8/utility/intercept-page",
      { is_enterprise: isEnterprise, lang: "en", package_option_code: optionCode },
      idToken,
    );
  }

  async function getNotifications(idToken: string): Promise<Record<string, unknown> | null> {
    const res = await sendApiRequest(
      "api/v8/notification-non-grouping",
      { is_enterprise: false, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || (typeof res === "object" && res.status !== "SUCCESS")) return null;
    return res as Record<string, unknown>;
  }

  async function getNotificationDetail(
    idToken: string,
    notificationId: string,
  ): Promise<Record<string, unknown> | null> {
    const res = await sendApiRequest(
      "api/v8/notification/detail",
      { is_enterprise: false, lang: "en", notification_id: notificationId },
      idToken,
    );
    if (typeof res === "string" || (typeof res === "object" && res.status !== "SUCCESS")) return null;
    return res as Record<string, unknown>;
  }

  async function getTransactionHistory(idToken: string): Promise<Record<string, unknown> | null> {
    const res = await sendApiRequest(
      "payments/api/v8/transaction-history",
      { is_enterprise: false, lang: "en" },
      idToken,
    );
    if (typeof res === "string") return null;
    return res as Record<string, unknown>;
  }

  async function getPackageDetails(
    idToken: string,
    familyCode: string,
    variantCode: string,
    optionOrder: number,
    isEnterprise?: boolean,
    migrationType?: string,
  ): Promise<Record<string, unknown> | null> {
    const familyData = await getFamily(idToken, familyCode, isEnterprise, migrationType);
    if (!familyData) return null;

    const variants = (familyData.package_variants as Record<string, unknown>[]) ?? [];
    let optionCode: string | null = null;
    for (const variant of variants) {
      if (variant.package_variant_code !== variantCode) continue;
      const options = (variant.package_options as Record<string, unknown>[]) ?? [];
      for (const option of options) {
        if (option.order === optionOrder) {
          optionCode = String(option.package_option_code ?? "");
          break;
        }
      }
      break;
    }
    if (!optionCode) return null;
    return getPackage(idToken, optionCode);
  }

  return {
    sendApiRequest,
    getProfile,
    getBalance,
    getQuotaDetails,
    getQuotaDetailsRaw,
    getFamily,
    getPackage,
    getPackageDetails,
    interceptPage,
    unsubscribePackage,
    getTieringInfo,
    loginInfo,
    getNotifications,
    getNotificationDetail,
    getTransactionHistory,
  };
}

export type EngselClient = ReturnType<typeof createEngselClient>;