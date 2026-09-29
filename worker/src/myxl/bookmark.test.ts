import { describe, expect, it } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { addBookmark, getBookmarks, removeBookmark } from "./bookmark";

describe("bookmark service", () => {
  it("adds and removes bookmarks per user", async () => {
    const storage = new MemoryStorageBackend();
    const ok = await addBookmark(storage, "alice", {
      family_code: "FAM1",
      family_name: "Family",
      is_enterprise: false,
      variant_name: "V1",
      option_name: "Opt",
      order: 1,
      package_option_code: "OPT1",
    });
    expect(ok).toBe(true);
    expect(await getBookmarks(storage, "alice")).toHaveLength(1);
    await removeBookmark(storage, "alice", "FAM1", false, "V1", 1);
    expect(await getBookmarks(storage, "alice")).toHaveLength(0);
  });
});