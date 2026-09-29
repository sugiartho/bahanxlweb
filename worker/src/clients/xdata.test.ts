import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CryptoSecrets } from "../crypto/crypto-helper";
import {
  decryptApiResponse,
  decryptXdataPayload,
  encryptSignXdata,
} from "./xdata";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = resolve(here, "../../../scripts/crypto-vectors/vectors.json");
const vectors = JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
  secrets: Record<string, string>;
  cases: { name: string; input: Record<string, unknown>; output: string }[];
};

function secrets(): CryptoSecrets {
  return {
    xdataKey: vectors.secrets.XDATA_KEY,
    axApiSigKey: vectors.secrets.AX_API_SIG_KEY,
    xApiBaseSecret: vectors.secrets.X_API_BASE_SECRET,
    encryptedFieldKey: vectors.secrets.ENCRYPTED_FIELD_KEY,
    axFpKey: vectors.secrets.AX_FP_KEY,
  };
}

function byName(name: string) {
  const found = vectors.cases.find((c) => c.name === name);
  if (!found) throw new Error(`missing vector: ${name}`);
  return found;
}

describe("xdata client helpers", () => {
  it("encryptSignXdata matches golden encrypt_xdata + make_x_signature", async () => {
    const enc = byName("encrypt_xdata");
    const sig = byName("make_x_signature");
    const payload = JSON.parse(enc.input.plaintext as string) as Record<string, unknown>;
    const xtime = enc.input.xtime_ms as number;

    const out = await encryptSignXdata(
      secrets(),
      sig.input.method as string,
      sig.input.path as string,
      sig.input.id_token as string,
      payload,
      xtime,
    );

    expect(out.encrypted_body.xdata).toBe(enc.output);
    expect(out.encrypted_body.xtime).toBe(xtime);
    expect(out.x_signature).toBe(sig.output);
  });

  it("decryptXdataPayload roundtrips encrypted body", async () => {
    const enc = byName("encrypt_xdata");
    const decrypted = await decryptXdataPayload(secrets(), {
      xdata: enc.output,
      xtime: enc.input.xtime_ms as number,
    });
    expect(decrypted).toEqual(JSON.parse(enc.input.plaintext as string));
  });

  it("decryptApiResponse unwraps encrypted JSON", async () => {
    const enc = byName("encrypt_xdata");
    const raw = JSON.stringify({ xdata: enc.output, xtime: enc.input.xtime_ms });
    const out = await decryptApiResponse(secrets(), raw);
    expect(out).toEqual(JSON.parse(enc.input.plaintext as string));
  });

  it("decryptApiResponse passes through plaintext JSON", async () => {
    const out = await decryptApiResponse(secrets(), '{"status":"SUCCESS"}');
    expect(out).toEqual({ status: "SUCCESS" });
  });
});