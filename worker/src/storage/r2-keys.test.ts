import { describe, expect, it } from "vitest";
import { GLOBAL_USERS_REGISTRY, USER_REFRESH_TOKENS } from "./keys";
import { resolveBlobLocation, sharedR2Path, userR2Path } from "./r2-keys";

describe("R2 key layout", () => {
  it("maps user blobs under users/{username}/", () => {
    expect(userR2Path("alice", USER_REFRESH_TOKENS)).toBe("users/alice/refresh-tokens.json");
    const loc = resolveBlobLocation("alice", USER_REFRESH_TOKENS);
    expect(loc).toEqual({
      scope: "user",
      username: "alice",
      objectKey: USER_REFRESH_TOKENS,
      r2Path: "users/alice/refresh-tokens.json",
    });
  });

  it("maps shared blobs under shared/", () => {
    expect(sharedR2Path("shared/hot.json")).toBe("shared/hot.json");
    const loc = resolveBlobLocation(null, "shared/hot.json");
    expect(loc?.scope).toBe("shared");
    expect(loc?.r2Path).toBe("shared/hot.json");
  });

  it("users registry is not a blob", () => {
    expect(resolveBlobLocation(null, GLOBAL_USERS_REGISTRY)).toBeNull();
  });
});