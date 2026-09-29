import { cbc } from "@noble/ciphers/aes";
import { pkcs7Pad } from "./padding";
import {
  base64Decode,
  base64Encode,
  bytesToHex,
  utf8Decode,
  utf8Encode,
  urlSafeBase64Decode,
  urlSafeBase64Encode,
} from "./encoding";
export interface CryptoSecrets {
  xdataKey: string;
  axApiSigKey: string;
  xApiBaseSecret: string;
  encryptedFieldKey: string;
  axFpKey: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(text));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacRaw(
  algorithm: "SHA-256" | "SHA-512",
  keyMaterial: string | Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const keyBytes = typeof keyMaterial === "string" ? utf8Encode(keyMaterial) : keyMaterial;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return new Uint8Array(sig);
}

async function hmacHex(algorithm: "SHA-256" | "SHA-512", keyText: string, message: Uint8Array): Promise<string> {
  return bytesToHex(await hmacRaw(algorithm, keyText, message));
}

function aesCbcEncrypt(keyBytes: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return cbc(keyBytes, iv).encrypt(plaintext);
}

function aesCbcDecrypt(keyBytes: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return cbc(keyBytes, iv).decrypt(ciphertext);
}

export async function deriveIv(xtimeMs: number): Promise<Uint8Array> {
  const hex = (await sha256Hex(String(xtimeMs))).slice(0, 16);
  return utf8Encode(hex);
}

export async function encryptXdata(secrets: CryptoSecrets, plaintext: string, xtimeMs: number): Promise<string> {
  const iv = await deriveIv(xtimeMs);
  const ct = aesCbcEncrypt(utf8Encode(secrets.xdataKey), iv, utf8Encode(plaintext));
  return urlSafeBase64Encode(ct);
}

export async function decryptXdata(secrets: CryptoSecrets, xdata: string, xtimeMs: number): Promise<string> {
  const iv = await deriveIv(xtimeMs);
  const ct = urlSafeBase64Decode(xdata);
  const pt = aesCbcDecrypt(utf8Encode(secrets.xdataKey), iv, ct);
  return utf8Decode(pt);
}

export async function makeXSignature(
  secrets: CryptoSecrets,
  idToken: string,
  method: string,
  path: string,
  sigTimeSec: number,
): Promise<string> {
  const keyStr = `${secrets.xApiBaseSecret};${idToken};${method};${path};${sigTimeSec}`;
  const msg = utf8Encode(`${idToken};${sigTimeSec};`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function makeXSignaturePayment(
  secrets: CryptoSecrets,
  accessToken: string,
  sigTimeSec: number,
  packageCode: string,
  tokenPayment: string,
  paymentMethod: string,
  paymentFor: string,
  path: string,
): Promise<string> {
  const keyStr = `${secrets.xApiBaseSecret};${sigTimeSec}#ae-hei_9Tee6he+Ik3Gais5=;POST;${path};${sigTimeSec}`;
  const msg = utf8Encode(`${accessToken};${tokenPayment};${sigTimeSec};${paymentFor};${paymentMethod};${packageCode};`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function makeAxApiSignature(
  secrets: CryptoSecrets,
  tsForSign: string,
  contact: string,
  code: string,
  contactType: string,
): Promise<string> {
  const preimage = `${tsForSign}password${contactType}${contact}${code}openid`;
  const digest = await hmacRaw("SHA-256", secrets.axApiSigKey, utf8Encode(preimage));
  return base64Encode(digest);
}

export async function makeXSignatureBounty(
  secrets: CryptoSecrets,
  accessToken: string,
  sigTimeSec: number,
  packageCode: string,
  tokenPayment: string,
): Promise<string> {
  const path = "api/v8/personalization/bounties-exchange";
  const keyStr = `${secrets.xApiBaseSecret};${accessToken};${sigTimeSec}#ae-hei_9Tee6he+Ik3Gais5=;POST;${path};${sigTimeSec}`;
  const msg = utf8Encode(`${accessToken};${tokenPayment};${sigTimeSec};${packageCode};`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function makeXSignatureLoyalty(
  secrets: CryptoSecrets,
  sigTimeSec: number,
  packageCode: string,
  tokenConfirmation: string,
  path: string,
): Promise<string> {
  const keyStr = `${secrets.xApiBaseSecret};${sigTimeSec}#ae-hei_9Tee6he+Ik3Gais5=;POST;${path};${sigTimeSec}`;
  const msg = utf8Encode(`${tokenConfirmation};${sigTimeSec};${packageCode};`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function makeXSignatureBountyAllotment(
  secrets: CryptoSecrets,
  sigTimeSec: number,
  packageCode: string,
  tokenConfirmation: string,
  path: string,
  destinationMsisdn: string,
): Promise<string> {
  const keyStr = `${secrets.xApiBaseSecret};${sigTimeSec}#ae-hei_9Tee6he+Ik3Gais5=;${destinationMsisdn};POST;${path};${sigTimeSec}`;
  const msg = utf8Encode(`${tokenConfirmation};${sigTimeSec};${destinationMsisdn};${packageCode};`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function makeXSignatureBasic(
  secrets: CryptoSecrets,
  method: string,
  path: string,
  sigTimeSec: number,
): Promise<string> {
  const keyStr = `${secrets.xApiBaseSecret};${method};${path};${sigTimeSec}`;
  const msg = utf8Encode(`${sigTimeSec};en;`);
  return hmacHex("SHA-512", keyStr, msg);
}

export async function encryptCircleMsisdn(secrets: CryptoSecrets, msisdn: string, ivHex16: string): Promise<string> {
  const key = utf8Encode(secrets.encryptedFieldKey);
  const iv = utf8Encode(ivHex16);
  const ct = aesCbcEncrypt(key, iv, utf8Encode(msisdn));
  return urlSafeBase64Encode(ct) + ivHex16;
}

export async function decryptCircleMsisdn(secrets: CryptoSecrets, encrypted: string): Promise<string> {
  const ivAscii = encrypted.slice(-16);
  const b64Part = encrypted.slice(0, -16);
  const key = utf8Encode(secrets.encryptedFieldKey);
  const iv = utf8Encode(ivAscii);
  try {
    const ct = urlSafeBase64Decode(b64Part);
    const pt = aesCbcDecrypt(key, iv, ct);
    return utf8Decode(pt);
  } catch {
    return "";
  }
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  lang: string;
  resolution: string;
  tzShort: string;
  ip: string;
  fontScale: number;
  androidRelease: string;
  msisdn: string;
}

function formatFontScale(scale: number): string {
  // JSON loses trailing ".0"; Python f"{1.0}" renders as "1.0".
  return Number.isInteger(scale) ? scale.toFixed(1) : String(scale);
}

export function buildFingerprintPlain(dev: DeviceInfo): string {
  return `${dev.manufacturer}|${dev.model}|${dev.lang}|${dev.resolution}|${dev.tzShort}|${dev.ip}|${formatFontScale(dev.fontScale)}|Android ${dev.androidRelease}|${dev.msisdn}`;
}

export async function axFingerprint(secrets: CryptoSecrets, dev: DeviceInfo): Promise<string> {
  const key = utf8Encode(secrets.axFpKey);
  const iv = new Uint8Array(16);
  const ct = aesCbcEncrypt(key, iv, utf8Encode(buildFingerprintPlain(dev)));
  return base64Encode(ct);
}

export function randomIvHex16(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildEncryptedField(
  secrets: CryptoSecrets,
  ivHex16: string,
  urlsafeB64 = false,
): Promise<string> {
  const key = utf8Encode(secrets.encryptedFieldKey);
  const iv = utf8Encode(ivHex16);
  const ct = aesCbcEncrypt(key, iv, pkcs7Pad(new Uint8Array(0)));
  const encoded = urlsafeB64 ? urlSafeBase64Encode(ct) : base64Encode(ct);
  return encoded + ivHex16;
}