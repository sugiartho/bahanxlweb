import type { CryptoSecrets } from "../crypto/crypto-helper";
import type { Env } from "../env";

export interface MyXlClientConfig {
  baseApiUrl: string;
  baseCiamUrl: string;
  basicAuth: string;
  ua: string;
  apiKey: string;
  crypto: CryptoSecrets;
  axFpOverride?: string;
}

export function cryptoSecretsFromEnv(env: Env): CryptoSecrets {
  return {
    xdataKey: env.XDATA_KEY ?? "",
    axApiSigKey: env.AX_API_SIG_KEY ?? "",
    xApiBaseSecret: env.X_API_BASE_SECRET ?? "",
    encryptedFieldKey: env.ENCRYPTED_FIELD_KEY ?? "",
    axFpKey: env.AX_FP_KEY ?? "",
  };
}

export function myXlConfigFromEnv(env: Env): MyXlClientConfig {
  const baseApiUrl = (env.BASE_API_URL ?? "").replace(/\/$/, "");
  const baseCiamUrl = (env.BASE_CIAM_URL ?? "").replace(/\/$/, "");
  if (!baseApiUrl || !baseCiamUrl) {
    throw new Error("BASE_API_URL and BASE_CIAM_URL are required for MyXL clients");
  }
  return {
    baseApiUrl,
    baseCiamUrl,
    basicAuth: env.BASIC_AUTH ?? "",
    ua: env.UA ?? "WebUI-XL/2.0",
    apiKey: env.API_KEY ?? "",
    crypto: cryptoSecretsFromEnv(env),
    axFpOverride: env.AX_FP,
  };
}

export function hostFromUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "");
  }
}