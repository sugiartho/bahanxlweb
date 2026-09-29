import { describe, expect, it } from "vitest";
import { MemoryStorageBackend } from "../storage/memory-backend";
import { addRule, deleteRule, loadRules, markRuleFired, updateRule } from "./rules";

const env = { ENVIRONMENT: "development" } as import("../env").Env;

describe("monitor rules (blob storage)", () => {
  it("CRUD and mark_fired", async () => {
    const storage = new MemoryStorageBackend();
    const rule = await addRule(env, storage, "alice", {
      name: "Low quota",
      msisdn: 628111,
      match: { kind: "any", data_type: "ANY" },
      trigger: { metric: "remaining_pct", op: "lt", value: 10 },
      actions: [{ type: "telegram", message: "alert" }],
    });
    expect(rule.id).toHaveLength(12);

    let rules = await loadRules(env, storage, "alice");
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("Low quota");

    await updateRule(env, storage, "alice", rule.id, { enabled: false });
    rules = await loadRules(env, storage, "alice");
    expect(rules[0].enabled).toBe(false);

    await markRuleFired(env, storage, "alice", rule.id, "ok", "sent");
    rules = await loadRules(env, storage, "alice");
    expect(rules[0].last_status).toBe("ok");
    expect(rules[0].last_msg).toBe("sent");
    expect(rules[0].last_fired_at).toBeGreaterThan(0);

    expect(await deleteRule(env, storage, "alice", rule.id)).toBe(true);
    rules = await loadRules(env, storage, "alice");
    expect(rules).toHaveLength(0);
  });
});