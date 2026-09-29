import type { CryptoSecrets } from "../crypto/crypto-helper";
import { decryptXdata, encryptXdata, makeXSignature } from "../crypto/crypto-helper";

export interface EncryptedApiBody {
  xdata: string;
  xtime: number;
}

export interface EncryptSignResult {
  x_signature: string;
  encrypted_body: EncryptedApiBody;
}

export async function encryptSignXdata(
  secrets: CryptoSecrets,
  method: string,
  path: string,
  idToken: string,
  payload: Record<string, unknown>,
  nowMs?: number,
): Promise<EncryptSignResult> {
  const plainBody = JSON.stringify(payload);
  const xtime = nowMs ?? Date.now();
  const xdata = await encryptXdata(secrets, plainBody, xtime);
  const sigTimeSec = Math.floor(xtime / 1000);
  const x_signature = await makeXSignature(secrets, idToken, method, path, sigTimeSec);
  return { x_signature, encrypted_body: { xdata, xtime } };
}

export async function decryptXdataPayload(
  secrets: CryptoSecrets,
  body: EncryptedApiBody,
): Promise<Record<string, unknown>> {
  const plaintext = await decryptXdata(secrets, body.xdata, body.xtime);
  return JSON.parse(plaintext) as Record<string, unknown>;
}

export async function decryptApiResponse(
  secrets: CryptoSecrets,
  raw: string,
): Promise<Record<string, unknown> | string> {
  try {
    const parsed = JSON.parse(raw) as EncryptedApiBody;
    if (parsed?.xdata != null && parsed?.xtime != null) {
      return decryptXdataPayload(secrets, parsed);
    }
    return parsed as unknown as Record<string, unknown>;
  } catch {
    return raw;
  }
}