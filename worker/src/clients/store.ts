import type { EngselClient } from "./engsel";

export function createStoreClient(engsel: EngselClient) {
  async function getSegments(idToken: string, isEnterprise = false) {
    const res = await engsel.sendApiRequest(
      "api/v8/configs/store/segments",
      { is_enterprise: isEnterprise, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || res.status !== "SUCCESS") return null;
    return res as Record<string, unknown>;
  }

  async function getFamilyList(idToken: string, subsType: string, isEnterprise = false) {
    const res = await engsel.sendApiRequest(
      "api/v8/xl-stores/options/search/family-list",
      { is_enterprise: isEnterprise, subs_type: subsType, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || res.status !== "SUCCESS") return null;
    return res as Record<string, unknown>;
  }

  async function getStorePackages(idToken: string, subsType: string, isEnterprise = false) {
    const res = await engsel.sendApiRequest(
      "api/v9/xl-stores/options/search",
      {
        is_enterprise: isEnterprise,
        filters: [
          { unit: "THOUSAND", id: "FIL_SEL_P", type: "PRICE", items: [] },
          { unit: "GB", id: "FIL_SEL_MQ", type: "DATA_TYPE", items: [] },
          { unit: "PACKAGE_NAME", id: "FIL_PKG_N", type: "PACKAGE_NAME", items: [{ id: "", label: "" }] },
          { unit: "DAY", id: "FIL_SEL_V", type: "VALIDITY", items: [] },
        ],
        substype: subsType,
        text_search: "",
        lang: "en",
      },
      idToken,
    );
    if (typeof res === "string" || res.status !== "SUCCESS") return null;
    return res as Record<string, unknown>;
  }

  async function getRedeemables(idToken: string, isEnterprise = false) {
    const res = await engsel.sendApiRequest(
      "api/v8/personalization/redeemables",
      { is_enterprise: isEnterprise, lang: "en" },
      idToken,
    );
    if (typeof res === "string" || res.status !== "SUCCESS") return null;
    return res as Record<string, unknown>;
  }

  async function getFamiliesByCategory(idToken: string, categoryCode: string, isEnterprise = false) {
    const migrationTypes = ["NONE", ""];
    const enterpriseFlags = isEnterprise ? [true] : [false, true];
    let lastSuccess: Record<string, unknown> | null = null;

    for (const migrationType of migrationTypes) {
      for (const ent of enterpriseFlags) {
        const res = await engsel.sendApiRequest(
          "api/v8/xl-stores/families",
          {
            migration_type: migrationType,
            is_enterprise: ent,
            is_shareable: false,
            package_category_code: categoryCode,
            with_icon_url: true,
            is_migration: false,
            lang: "en",
          },
          idToken,
        );
        if (typeof res === "string" || res.status !== "SUCCESS") continue;
        lastSuccess = res as Record<string, unknown>;
      }
    }

    return lastSuccess;
  }

  return { getSegments, getFamilyList, getStorePackages, getRedeemables, getFamiliesByCategory };
}

export type StoreClient = ReturnType<typeof createStoreClient>;