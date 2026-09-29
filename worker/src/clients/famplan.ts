import type { EngselClient } from "./engsel";

export function createFamplanClient(engsel: EngselClient) {
  async function getFamilyData(idToken: string) {
    return engsel.sendApiRequest(
      "sharings/api/v8/family-plan/member-info",
      { group_id: 0, is_enterprise: false, lang: "en" },
      idToken,
    );
  }

  async function validateMsisdn(idToken: string, msisdn: string) {
    return engsel.sendApiRequest(
      "api/v8/auth/check-dukcapil",
      {
        with_bizon: true,
        with_family_plan: true,
        is_enterprise: false,
        with_optimus: true,
        lang: "en",
        msisdn,
        with_regist_status: true,
        with_enterprise: true,
      },
      idToken,
    );
  }

  async function changeMember(
    idToken: string,
    parentAlias: string,
    alias: string,
    slotId: number,
    familyMemberId: string,
    newMsisdn: string,
  ) {
    return engsel.sendApiRequest(
      "sharings/api/v8/family-plan/change-member",
      {
        parent_alias: parentAlias,
        is_enterprise: false,
        slot_id: slotId,
        alias,
        lang: "en",
        msisdn: newMsisdn,
        family_member_id: familyMemberId,
      },
      idToken,
    );
  }

  async function removeMember(idToken: string, familyMemberId: string) {
    return engsel.sendApiRequest(
      "sharings/api/v8/family-plan/remove-member",
      { is_enterprise: false, family_member_id: familyMemberId, lang: "en" },
      idToken,
    );
  }

  async function setQuotaLimit(
    idToken: string,
    originalAllocation: number,
    newAllocation: number,
    familyMemberId: string,
  ) {
    return engsel.sendApiRequest(
      "sharings/api/v8/family-plan/allocate-quota",
      {
        is_enterprise: false,
        member_allocations: [
          {
            new_text_allocation: 0,
            original_text_allocation: 0,
            original_voice_allocation: 0,
            original_allocation: originalAllocation,
            new_voice_allocation: 0,
            message: "",
            new_allocation: newAllocation,
            family_member_id: familyMemberId,
            status: "",
          },
        ],
        lang: "en",
      },
      idToken,
    );
  }

  return {
    getFamilyData,
    validateMsisdn,
    changeMember,
    removeMember,
    setQuotaLimit,
  };
}

export type FamplanClient = ReturnType<typeof createFamplanClient>;