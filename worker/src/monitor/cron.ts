import type { Env } from "../env";
import { loadUsers } from "../auth/users";
import type { StorageBackend } from "../storage/types";
import { loadTelegramConfig } from "../telegram/config";
import { checkUserOnce } from "./checker";
import { logLine } from "./log";
import { maybeSendDailySummary } from "./daily-summary";

export async function runMonitorCron(env: Env, storage: StorageBackend): Promise<void> {
  const tgCfg = await loadTelegramConfig(env, storage);
  const users = await loadUsers(storage);

  for (const u of users) {
    const uname = u.username;
    try {
      await checkUserOnce(env, storage, uname);
    } catch (e) {
      try {
        await logLine(storage, uname, `[monitor] user ${uname} err: ${e}`);
      } catch {
        // ignore
      }
    }

    try {
      await maybeSendDailySummary(env, storage, uname, tgCfg);
    } catch (e) {
      try {
        await logLine(storage, uname, `[${uname}] daily summary err: ${e}`);
      } catch {
        // ignore
      }
    }
  }
}