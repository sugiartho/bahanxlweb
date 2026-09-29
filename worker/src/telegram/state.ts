import type { Env } from "../env";
import type { ChatStateData, PendingConfirm } from "./types";

const memoryStates = new Map<number, ChatStateData>();
const memoryPending = new Map<number, PendingConfirm>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class TelegramStateStore {
  constructor(private readonly env: Env) {}

  private useD1(): boolean {
    return !!this.env.DB;
  }

  async loadState(chatId: number): Promise<ChatStateData> {
    if (!this.useD1()) {
      return { ...(memoryStates.get(chatId) ?? {}) };
    }

    const row = await this.env.DB!.prepare(
      `SELECT username, step, data_json, active_msisdn, account_msisdn, pkg_map_json, unsub_map_json
       FROM telegram_chat_state WHERE chat_id = ?`,
    )
      .bind(chatId)
      .first<{
        username: string | null;
        step: string | null;
        data_json: string | null;
        active_msisdn: string | null;
        account_msisdn: string | null;
        pkg_map_json: string | null;
        unsub_map_json: string | null;
      }>();

    if (!row) return {};

    let data: Record<string, unknown> = {};
    try {
      data = row.data_json ? (JSON.parse(row.data_json) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    let pkgMap: Record<string, string> = {};
    let unsubMap: Record<string, string> = {};
    try {
      pkgMap = row.pkg_map_json ? (JSON.parse(row.pkg_map_json) as Record<string, string>) : {};
    } catch {
      pkgMap = {};
    }
    try {
      unsubMap = row.unsub_map_json ? (JSON.parse(row.unsub_map_json) as Record<string, string>) : {};
    } catch {
      unsubMap = {};
    }

    return {
      ...data,
      step: row.step,
      active_msisdn: row.active_msisdn ? Number.parseInt(row.active_msisdn, 10) : null,
      account_msisdn: row.account_msisdn ? Number.parseInt(row.account_msisdn, 10) : null,
      pkg_map: pkgMap,
      unsub_map: unsubMap,
      linked_username: row.username ?? undefined,
    };
  }

  async saveState(chatId: number, state: ChatStateData, username?: string | null): Promise<void> {
    if (!this.useD1()) {
      memoryStates.set(chatId, { ...state });
      return;
    }

    const {
      step,
      active_msisdn,
      account_msisdn,
      pkg_map,
      unsub_map,
      dcy_map,
      bm_map,
      pending_purchase,
      pending_hot,
      pending_hot_method,
      ...rest
    } = state;

    const dataJson = JSON.stringify({
      ...rest,
      pending_purchase,
      pending_hot,
      pending_hot_method,
      dcy_map,
      bm_map,
    });

    await this.env.DB!.prepare(
      `INSERT INTO telegram_chat_state (
         chat_id, username, step, data_json, active_msisdn, account_msisdn,
         pkg_map_json, unsub_map_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         username = excluded.username,
         step = excluded.step,
         data_json = excluded.data_json,
         active_msisdn = excluded.active_msisdn,
         account_msisdn = excluded.account_msisdn,
         pkg_map_json = excluded.pkg_map_json,
         unsub_map_json = excluded.unsub_map_json,
         updated_at = excluded.updated_at`,
    )
      .bind(
        chatId,
        username ?? state.linked_username ?? null,
        step ?? null,
        dataJson,
        active_msisdn != null ? String(active_msisdn) : null,
        account_msisdn != null ? String(account_msisdn) : null,
        JSON.stringify(pkg_map ?? {}),
        JSON.stringify(unsub_map ?? {}),
        nowSec(),
      )
      .run();
  }

  async clearFlow(chatId: number, keepActive = true): Promise<void> {
    const prev = await this.loadState(chatId);
    const active = keepActive ? prev.active_msisdn ?? prev.account_msisdn : null;
    await this.saveState(
      chatId,
      {
        step: null,
        data: {},
        active_msisdn: active ?? null,
        account_msisdn: active ?? null,
        pkg_map: {},
        unsub_map: {},
        dcy_map: {},
        bm_map: {},
        linked_username: prev.linked_username,
      },
      typeof prev.linked_username === "string" ? prev.linked_username : null,
    );
  }

  async loadPending(chatId: number): Promise<PendingConfirm | null> {
    if (!this.useD1()) {
      const p = memoryPending.get(chatId);
      if (!p) return null;
      if (p.expires < Date.now() / 1000) {
        memoryPending.delete(chatId);
        return null;
      }
      return p;
    }

    const row = await this.env.DB!.prepare(
      `SELECT confirm_type, payload_json, expires_at FROM telegram_pending_confirm WHERE chat_id = ?`,
    )
      .bind(chatId)
      .first<{ confirm_type: string; payload_json: string; expires_at: number }>();

    if (!row || row.expires_at < nowSec()) {
      if (row) await this.clearPending(chatId);
      return null;
    }

    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      return { action: row.confirm_type, expires: row.expires_at, ...payload };
    } catch {
      return null;
    }
  }

  async savePending(chatId: number, pending: PendingConfirm): Promise<void> {
    if (!this.useD1()) {
      memoryPending.set(chatId, pending);
      return;
    }

    const { action, expires, ...payload } = pending;
    await this.env.DB!.prepare(
      `INSERT INTO telegram_pending_confirm (chat_id, confirm_type, payload_json, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         confirm_type = excluded.confirm_type,
         payload_json = excluded.payload_json,
         expires_at = excluded.expires_at`,
    )
      .bind(chatId, action, JSON.stringify(payload), expires)
      .run();
  }

  async clearPending(chatId: number): Promise<void> {
    if (!this.useD1()) {
      memoryPending.delete(chatId);
      return;
    }
    await this.env.DB!.prepare(`DELETE FROM telegram_pending_confirm WHERE chat_id = ?`).bind(chatId).run();
  }
}

export function resetMemoryStateForTests(): void {
  memoryStates.clear();
  memoryPending.clear();
}