import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  axFingerprint,
  buildEncryptedField,
  decryptCircleMsisdn,
  decryptXdata,
  encryptCircleMsisdn,
  encryptXdata,
  makeAxApiSignature,
  makeXSignature,
  makeXSignatureBasic,
  makeXSignatureBounty,
  makeXSignatureBountyAllotment,
  makeXSignatureLoyalty,
  makeXSignaturePayment,
  type CryptoSecrets,
  type DeviceInfo,
} from "./crypto-helper";

type VectorCase = {
  name: string;
  input: Record<string, unknown>;
  output: string;
};

type VectorFile = {
  secrets: Record<string, string>;
  cases: VectorCase[];
};

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = resolve(here, "../../../scripts/crypto-vectors/vectors.json");
const vectors: VectorFile = JSON.parse(readFileSync(vectorsPath, "utf-8"));

function secrets(): CryptoSecrets {
  return {
    xdataKey: vectors.secrets.XDATA_KEY,
    axApiSigKey: vectors.secrets.AX_API_SIG_KEY,
    xApiBaseSecret: vectors.secrets.X_API_BASE_SECRET,
    encryptedFieldKey: vectors.secrets.ENCRYPTED_FIELD_KEY,
    axFpKey: vectors.secrets.AX_FP_KEY,
  };
}

function byName(name: string): VectorCase {
  const found = vectors.cases.find((c) => c.name === name);
  if (!found) throw new Error(`missing vector: ${name}`);
  return found;
}

describe("crypto golden vectors", () => {
  it("encrypt_xdata", async () => {
    const v = byName("encrypt_xdata");
    const out = await encryptXdata(secrets(), v.input.plaintext as string, v.input.xtime_ms as number);
    expect(out).toBe(v.output);
  });

  it("decrypt_xdata", async () => {
    const v = byName("decrypt_xdata");
    const out = await decryptXdata(secrets(), v.input.xdata as string, v.input.xtime_ms as number);
    expect(out).toBe(v.output);
  });

  it("make_x_signature", async () => {
    const v = byName("make_x_signature");
    const i = v.input;
    const out = await makeXSignature(
      secrets(),
      i.id_token as string,
      i.method as string,
      i.path as string,
      i.sig_time_sec as number,
    );
    expect(out).toBe(v.output);
  });

  it("make_x_signature_payment", async () => {
    const v = byName("make_x_signature_payment");
    const i = v.input;
    const out = await makeXSignaturePayment(
      secrets(),
      i.access_token as string,
      i.sig_time_sec as number,
      i.package_code as string,
      i.token_payment as string,
      i.payment_method as string,
      i.payment_for as string,
      i.path as string,
    );
    expect(out).toBe(v.output);
  });

  it("make_ax_api_signature", async () => {
    const v = byName("make_ax_api_signature");
    const i = v.input;
    const out = await makeAxApiSignature(
      secrets(),
      i.ts_for_sign as string,
      i.contact as string,
      i.code as string,
      i.contact_type as string,
    );
    expect(out).toBe(v.output);
  });

  it("make_x_signature_bounty", async () => {
    const v = byName("make_x_signature_bounty");
    const i = v.input;
    const out = await makeXSignatureBounty(
      secrets(),
      i.access_token as string,
      i.sig_time_sec as number,
      i.package_code as string,
      i.token_payment as string,
    );
    expect(out).toBe(v.output);
  });

  it("make_x_signature_loyalty", async () => {
    const v = byName("make_x_signature_loyalty");
    const i = v.input;
    const out = await makeXSignatureLoyalty(
      secrets(),
      i.sig_time_sec as number,
      i.package_code as string,
      i.token_confirmation as string,
      i.path as string,
    );
    expect(out).toBe(v.output);
  });

  it("make_x_signature_bounty_allotment", async () => {
    const v = byName("make_x_signature_bounty_allotment");
    const i = v.input;
    const out = await makeXSignatureBountyAllotment(
      secrets(),
      i.sig_time_sec as number,
      i.package_code as string,
      i.token_confirmation as string,
      i.path as string,
      i.destination_msisdn as string,
    );
    expect(out).toBe(v.output);
  });

  it("make_x_signature_basic", async () => {
    const v = byName("make_x_signature_basic");
    const i = v.input;
    const out = await makeXSignatureBasic(secrets(), i.method as string, i.path as string, i.sig_time_sec as number);
    expect(out).toBe(v.output);
  });

  it("encrypt_circle_msisdn", async () => {
    const v = byName("encrypt_circle_msisdn");
    const i = v.input;
    const out = await encryptCircleMsisdn(secrets(), i.msisdn as string, i.iv_hex16 as string);
    expect(out).toBe(v.output);
  });

  it("decrypt_circle_msisdn", async () => {
    const v = byName("decrypt_circle_msisdn");
    const out = await decryptCircleMsisdn(secrets(), v.input.encrypted as string);
    expect(out).toBe(v.output);
  });

  it("ax_fingerprint", async () => {
    const v = byName("ax_fingerprint");
    const raw = v.input.device as Record<string, unknown>;
    const dev: DeviceInfo = {
      manufacturer: raw.manufacturer as string,
      model: raw.model as string,
      lang: raw.lang as string,
      resolution: raw.resolution as string,
      tzShort: raw.tz_short as string,
      ip: raw.ip as string,
      fontScale: raw.font_scale as number,
      androidRelease: raw.android_release as string,
      msisdn: raw.msisdn as string,
    };
    const out = await axFingerprint(secrets(), dev);
    expect(out).toBe(v.output);
  });

  it("build_encrypted_field", async () => {
    const v = byName("build_encrypted_field");
    const out = await buildEncryptedField(secrets(), v.input.iv_hex16 as string, false);
    expect(out).toBe(v.output);
  });

  it("build_encrypted_field_urlsafe", async () => {
    const v = byName("build_encrypted_field_urlsafe");
    const out = await buildEncryptedField(secrets(), v.input.iv_hex16 as string, true);
    expect(out).toBe(v.output);
  });
});