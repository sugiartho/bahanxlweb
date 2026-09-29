import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

const PYTHON_HASH =
  "pbkdf2_sha256$200000$0123456789abcdef0123456789abcdef$75f5241b008aeca09ff032fc7376e6bba2dd5ded085187fa9cc5881f9eb720cc";

describe("password hashing", () => {
  it("verifies Python-generated pbkdf2 hash", async () => {
    expect(await verifyPassword("secret12", PYTHON_HASH)).toBe(true);
    expect(await verifyPassword("wrong", PYTHON_HASH)).toBe(false);
  });

  it("roundtrips hashPassword + verifyPassword", async () => {
    const encoded = await hashPassword("hunter2");
    expect(encoded.startsWith("pbkdf2_sha256$10000$")).toBe(true);
    expect(await verifyPassword("hunter2", encoded)).toBe(true);
    expect(await verifyPassword("hunter3", encoded)).toBe(false);
  });
});