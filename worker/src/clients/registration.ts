import type { EngselClient } from "./engsel";

/** Guest API calls — empty id_token, mirrors app/client/registration.py */
export function createRegistrationClient(engsel: EngselClient) {
  const guestToken = "";

  async function validatePuk(msisdn: string, puk: string) {
    return engsel.sendApiRequest(
      "api/v8/infos/validate-puk",
      { is_enterprise: false, puk, is_enc: false, msisdn, lang: "en" },
      guestToken,
    );
  }

  async function dukcapil(msisdn: string, kk: string, nik: string) {
    return engsel.sendApiRequest(
      "api/v8/auth/regist/dukcapil",
      { msisdn, kk, nik, lang: "en" },
      guestToken,
    );
  }

  return { validatePuk, dukcapil };
}

export type RegistrationClient = ReturnType<typeof createRegistrationClient>;