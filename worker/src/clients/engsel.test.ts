import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { MyXlClientConfig } from "./config";
import { createEngselClient } from "./engsel";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = resolve(here, "../../../scripts/crypto-vectors/vectors.json");
const vectors = JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
  secrets: Record<string, string>;
  cases: { name: string; input: Record<string, unknown>; output: string }[];
};

function testConfig(): MyXlClientConfig {
  return {
    baseApiUrl: "https://api.example.com",
    baseCiamUrl: "https://ciam.example.com",
    basicAuth: "x",
    ua: "TestAgent/1.0",
    apiKey: "api-key-value",
    crypto: {
      xdataKey: vectors.secrets.XDATA_KEY,
      axApiSigKey: vectors.secrets.AX_API_SIG_KEY,
      xApiBaseSecret: vectors.secrets.X_API_BASE_SECRET,
      encryptedFieldKey: vectors.secrets.ENCRYPTED_FIELD_KEY,
      axFpKey: vectors.secrets.AX_FP_KEY,
    },
  };
}

describe("createEngselClient", () => {
  it("sendApiRequest posts encrypted body with x-signature headers", async () => {
    const enc = vectors.cases.find((c) => c.name === "encrypt_xdata")!;
    const sig = vectors.cases.find((c) => c.name === "make_x_signature")!;
    const xtime = enc.input.xtime_ms as number;

    const fetchFn = vi.fn(async () =>
      Response.json({ status: "SUCCESS", data: { balance: 100 } }),
    );

    const client = createEngselClient({ config: testConfig(), fetchFn });
    const payload = JSON.parse(enc.input.plaintext as string) as Record<string, unknown>;
    const out = await client.sendApiRequest(
      sig.input.path as string,
      payload,
      sig.input.id_token as string,
      "POST",
      xtime,
    );

    expect(out).toEqual({ status: "SUCCESS", data: { balance: 100 } });
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/v8/profile");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("api-key-value");
    expect(headers["x-signature"]).toBe(sig.output);
    expect(headers["x-signature-time"]).toBe(String(Math.floor(xtime / 1000)));
    expect(headers.authorization).toBe(`Bearer ${sig.input.id_token}`);

    const body = JSON.parse(init.body as string) as { xdata: string; xtime: number };
    expect(body.xdata).toBe(enc.output);
    expect(body.xtime).toBe(xtime);
  });
});