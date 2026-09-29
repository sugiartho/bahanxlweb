import { describe, expect, it } from "vitest";
import { hexToBytes } from "../crypto/encoding";
import { makeSessionToken, parseSessionToken } from "./session";

const SECRET = hexToBytes("a".repeat(64));
const GOLDEN_TOKEN = "eyJ1IjoiYWxpY2UifQ.ZeyHgA.9mBEu8ITLCoJGHr0kBEdsxPJctE";

describe("session tokens (itsdangerous compat)", () => {
  it("parses Python golden token", async () => {
    const username = await parseSessionToken(GOLDEN_TOKEN, SECRET, 999_999_999);
    expect(username).toBe("alice");
  });

  it("roundtrips at fixed timestamp", async () => {
    const token = await makeSessionToken("alice", SECRET, 1_710_000_000);
    expect(token).toBe(GOLDEN_TOKEN);
    expect(await parseSessionToken(token, SECRET, 999_999_999)).toBe("alice");
  });

  it("rejects tampered signature", async () => {
    const bad = GOLDEN_TOKEN.replace(/.$/, "X");
    expect(await parseSessionToken(bad, SECRET)).toBeNull();
  });
});