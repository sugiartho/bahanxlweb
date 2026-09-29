import { describe, expect, it, vi } from "vitest";
import type { MyXlClientConfig } from "./config";
import { createCiamClient, validateContact } from "./ciam";
import type { FingerprintPair } from "./fingerprint";

const FP: FingerprintPair = {
  deviceId: "abc123device",
  fingerprint: "fp-value",
};

function testConfig(): MyXlClientConfig {
  return {
    baseApiUrl: "https://api.example.com",
    baseCiamUrl: "https://ciam.example.com",
    basicAuth: "dGVzdDpzZWNyZXQ=",
    ua: "TestAgent/1.0",
    apiKey: "api-key",
    crypto: {
      xdataKey: "0123456789abcdef0123456789abcdef",
      axApiSigKey: "0123456789abcdef0123456789abcdef",
      xApiBaseSecret: "secret",
      encryptedFieldKey: "0123456789abcdef0123456789abcdef",
      axFpKey: "0123456789abcdef0123456789abcdef",
    },
  };
}

describe("validateContact", () => {
  it("accepts Indonesian MSISDN prefix 628", () => {
    expect(validateContact("6281234567890")).toBe(true);
  });

  it("rejects non-628 numbers", () => {
    expect(validateContact("081234567890")).toBe(false);
  });

  it("rejects numbers longer than 14 digits", () => {
    expect(validateContact("628123456789012")).toBe(false);
  });
});

describe("createCiamClient", () => {
  it("getOtp sends CIAM headers with Basic auth and GMT+7 Ax-Request-At", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ subscriber_id: "sub-1" }),
    );
    const client = createCiamClient({
      config: testConfig(),
      fingerprint: async () => FP,
      fetchFn,
    });

    const sub = await client.getOtp("6281234567890");
    expect(sub).toBe("sub-1");
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/realms/xl-ciam/auth/otp");
    expect(url).toContain("contact=6281234567890");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Basic dGVzdDpzZWNyZXQ=");
    expect(headers.Host).toBe("ciam.example.com");
    expect(headers["User-Agent"]).toBe("TestAgent/1.0");
    expect(headers["Ax-Device-Id"]).toBe(FP.deviceId);
    expect(headers["Ax-Fingerprint"]).toBe(FP.fingerprint);
    expect(headers["Ax-Request-At"]).toMatch(/\+07:00$/);
  });

  it("getOtp returns null for invalid contact without calling fetch", async () => {
    const fetchFn = vi.fn();
    const client = createCiamClient({
      config: testConfig(),
      fingerprint: async () => FP,
      fetchFn,
    });
    expect(await client.getOtp("08123")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("submitOtp posts form body with Ax-Api-Signature header", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        access_token: "at",
        refresh_token: "rt",
        id_token: "it",
      }),
    );
    const client = createCiamClient({
      config: testConfig(),
      fingerprint: async () => FP,
      fetchFn,
    });

    const tokens = await client.submitOtp("SMS", "6281234567890", "123456");
    expect(tokens?.refresh_token).toBe("rt");

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toContain("contactType=SMS");
    expect(init.body).toContain("code=123456");
    const headers = init.headers as Record<string, string>;
    expect(headers["Ax-Api-Signature"]).toBeTruthy();
    expect(headers["Ax-Request-At"]).toMatch(/\+0700$/);
  });
});