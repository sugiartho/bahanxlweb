import { encryptCircleMsisdn, randomIvHex16 } from "../crypto/crypto-helper";
import type { CryptoSecrets } from "../crypto/crypto-helper";
import type { EngselClient } from "./engsel";

export interface CircleClientOptions {
  engsel: EngselClient;
  crypto: CryptoSecrets;
}

export function createCircleClient(options: CircleClientOptions) {
  const { engsel, crypto } = options;

  async function encryptMsisdn(msisdn: string): Promise<string> {
    return encryptCircleMsisdn(crypto, msisdn, randomIvHex16());
  }

  async function getGroupData(idToken: string) {
    return engsel.sendApiRequest(
      "family-hub/api/v8/groups/status",
      { is_enterprise: false, lang: "en" },
      idToken,
    );
  }

  async function getGroupMembers(idToken: string, groupId: string) {
    return engsel.sendApiRequest(
      "family-hub/api/v8/members/info",
      { group_id: groupId, is_enterprise: false, lang: "en" },
      idToken,
    );
  }

  async function validateCircleMember(idToken: string, msisdn: string) {
    const encrypted = await encryptMsisdn(msisdn);
    return engsel.sendApiRequest(
      "family-hub/api/v8/members/validate",
      { msisdn: encrypted, is_enterprise: false, lang: "en" },
      idToken,
    );
  }

  async function inviteCircleMember(
    idToken: string,
    accessToken: string,
    msisdn: string,
    name: string,
    groupId: string,
    memberIdParent: string,
  ) {
    const encrypted = await encryptMsisdn(msisdn);
    return engsel.sendApiRequest(
      "family-hub/api/v8/members/invite",
      {
        access_token: accessToken,
        group_id: groupId,
        is_enterprise: false,
        members: [{ msisdn: encrypted, name }],
        lang: "en",
        member_id_parent: memberIdParent,
      },
      idToken,
    );
  }

  async function removeCircleMember(
    idToken: string,
    memberId: string,
    groupId: string,
    memberIdParent: string,
    isLastMember: boolean,
  ) {
    return engsel.sendApiRequest(
      "family-hub/api/v8/members/remove",
      {
        member_id: memberId,
        group_id: groupId,
        is_enterprise: false,
        is_last_member: isLastMember,
        lang: "en",
        member_id_parent: memberIdParent,
      },
      idToken,
    );
  }

  async function acceptCircleInvitation(
    idToken: string,
    accessToken: string,
    groupId: string,
    memberId: string,
  ) {
    return engsel.sendApiRequest(
      "family-hub/api/v8/groups/accept-invitation",
      {
        access_token: accessToken,
        group_id: groupId,
        member_id: memberId,
        is_enterprise: false,
        lang: "en",
      },
      idToken,
    );
  }

  async function createCircle(
    idToken: string,
    accessToken: string,
    parentName: string,
    groupName: string,
    memberMsisdn: string,
    memberName: string,
  ) {
    const encrypted = await encryptMsisdn(memberMsisdn);
    return engsel.sendApiRequest(
      "family-hub/api/v8/groups/create",
      {
        access_token: accessToken,
        parent_name: parentName,
        group_name: groupName,
        is_enterprise: false,
        members: [{ msisdn: encrypted, name: memberName }],
        lang: "en",
      },
      idToken,
    );
  }

  async function spendingTracker(
    idToken: string,
    parentSubsId: string,
    familyId: string,
  ) {
    return engsel.sendApiRequest(
      "gamification/api/v8/family-hub/spending-tracker",
      { is_enterprise: false, parent_subs_id: parentSubsId, family_id: familyId, lang: "en" },
      idToken,
    );
  }

  async function getBonusData(idToken: string, parentSubsId: string, familyId: string) {
    return engsel.sendApiRequest(
      "gamification/api/v8/family-hub/bonus/list",
      { is_enterprise: false, parent_subs_id: parentSubsId, family_id: familyId, lang: "en" },
      idToken,
    );
  }

  return {
    getGroupData,
    getGroupMembers,
    validateCircleMember,
    inviteCircleMember,
    removeCircleMember,
    acceptCircleInvitation,
    createCircle,
    spendingTracker,
    getBonusData,
  };
}

export type CircleClient = ReturnType<typeof createCircleClient>;