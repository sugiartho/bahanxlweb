type UserRow = {
  username: string;
  password_hash: string;
  created_at: number;
  theme: string;
  telegram_chat_id: number | null;
  email?: string | null;
  google_sub?: string | null;
  google_email?: string | null;
  updated_at: number;
};

type LinkCodeRow = {
  code: string;
  username: string;
  expires_at: number;
  created_at: number;
};

type R2IndexRow = {
  scope: string;
  username: string;
  object_key: string;
  r2_path: string;
  size_bytes: number;
  updated_at: number;
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class MockPreparedStatement implements D1PreparedStatement {
  private binds: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly db: InMemoryD1Database,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.binds = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const rows = await this.runQuery<T>();
    return rows[0] ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const results = await this.runQuery<T>();
    return { results, success: true, meta: {} as D1Meta };
  }

  async run(): Promise<D1Response> {
    await this.runQuery();
    return { success: true, meta: {} as D1Meta };
  }

  async raw<T>(): Promise<T[]> {
    return this.runQuery<T>();
  }

  private async runQuery<T>(): Promise<T[]> {
    const sql = normalizeSql(this.sql);

    if (sql.includes("where telegram_chat_id =")) {
      const [chatId] = this.binds as [number];
      const user = this.db.users.find((u) => u.telegram_chat_id === chatId);
      return user ? ([{ ...user }] as T[]) : [];
    }

    if (sql.includes("where google_sub =")) {
      const [googleSub] = this.binds as [string];
      const user = this.db.users.find((u) => u.google_sub === googleSub);
      return user ? ([{ ...user }] as T[]) : [];
    }

    if (sql.includes("from telegram_link_codes where code =")) {
      const [code] = this.binds as [string];
      const row = this.db.linkCodes.find((r) => r.code === code);
      return row ? ([{ ...row }] as T[]) : [];
    }

    if (sql.startsWith("insert into telegram_link_codes")) {
      const [code, username, expires_at, created_at] = this.binds as [string, string, number, number];
      this.db.linkCodes.push({ code, username, expires_at, created_at });
      return [];
    }

    if (sql.startsWith("delete from telegram_link_codes")) {
      const [code] = this.binds as [string];
      this.db.linkCodes = this.db.linkCodes.filter((r) => r.code !== code);
      return [];
    }

    if (sql.startsWith("select username, password_hash")) {
      return this.db.users.map((u) => ({ ...u })) as T[];
    }

    if (sql.startsWith("delete from webui_users")) {
      this.db.users = [];
      return [];
    }

    if (sql.startsWith("insert into webui_users")) {
      const [
        username,
        password_hash,
        created_at,
        theme,
        telegram_chat_id,
        email,
        google_sub,
        google_email,
        updated_at,
      ] = this.binds as [
        string,
        string,
        number,
        string,
        number | null,
        string | null,
        string | null,
        string | null,
        number,
      ];
      this.db.users.push({
        username,
        password_hash,
        created_at,
        theme,
        telegram_chat_id,
        email,
        google_sub,
        google_email,
        updated_at,
      });
      return [];
    }

    if (sql.startsWith("select value from storage_meta")) {
      const [key] = this.binds as [string];
      const row = this.db.meta.get(key);
      if (!row) return [];
      return [{ value: row.value.buffer }] as T[];
    }

    if (sql.startsWith("insert into storage_meta")) {
      const [key, value, updated_at] = this.binds as [string, Uint8Array, number];
      this.db.meta.set(key, { value: new Uint8Array(value), updated_at });
      return [];
    }

    if (sql.startsWith("delete from storage_meta")) {
      const [key] = this.binds as [string];
      this.db.meta.delete(key);
      return [];
    }

    if (sql.startsWith("select 1 as ok from storage_meta")) {
      const [key] = this.binds as [string];
      return this.db.meta.has(key) ? ([{ ok: 1 }] as T[]) : [];
    }

    if (sql.startsWith("insert into r2_objects")) {
      const [scope, username, object_key, r2_path, size_bytes, updated_at] = this.binds as [
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      const idx = this.db.r2Index.findIndex(
        (r) => r.scope === scope && r.username === username && r.object_key === object_key,
      );
      const row: R2IndexRow = { scope, username, object_key, r2_path, size_bytes, updated_at };
      if (idx >= 0) this.db.r2Index[idx] = row;
      else this.db.r2Index.push(row);
      return [];
    }

    if (sql.startsWith("delete from r2_objects")) {
      const [scope, username, object_key] = this.binds as [string, string, string];
      this.db.r2Index = this.db.r2Index.filter(
        (r) => !(r.scope === scope && r.username === username && r.object_key === object_key),
      );
      return [];
    }

    if (sql.startsWith("select 1 as ok from r2_objects")) {
      const [scope, username, object_key] = this.binds as [string, string, string];
      const found = this.db.r2Index.some(
        (r) => r.scope === scope && r.username === username && r.object_key === object_key,
      );
      return found ? ([{ ok: 1 }] as T[]) : [];
    }

    if (sql.includes("from r2_objects") && sql.includes("like")) {
      const binds = this.binds as [string, string?, string?];
      if (binds.length === 1) {
        const [like] = binds;
        const prefix = like.replace(/%$/, "");
        return this.db.r2Index
          .filter((r) => r.scope === "shared" && r.object_key.startsWith(prefix))
          .sort((a, b) => a.object_key.localeCompare(b.object_key))
          .map((r) => ({ object_key: r.object_key })) as T[];
      }
      const [scope, username, like] = binds as [string, string, string];
      const prefix = like === "%" ? "" : like.replace(/%$/, "");
      return this.db.r2Index
        .filter(
          (r) =>
            r.scope === scope &&
            r.username === username &&
            (prefix === "" || r.object_key.startsWith(prefix)),
        )
        .sort((a, b) => a.object_key.localeCompare(b.object_key))
        .map((r) => ({ object_key: r.object_key })) as T[];
    }

    throw new Error(`unsupported mock SQL: ${this.sql}`);
  }
}

export class InMemoryD1Database implements D1Database {
  users: UserRow[] = [];
  linkCodes: LinkCodeRow[] = [];
  meta = new Map<string, { value: Uint8Array; updated_at: number }>();
  r2Index: R2IndexRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockPreparedStatement(query, this);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    for (const stmt of statements) {
      await (stmt as MockPreparedStatement).run();
    }
    return [];
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 0, duration: 0 };
  }

  withSession(_constraintOrBookmark?: D1SessionBookmark | string): D1Database {
    return this;
  }

  dump(): Promise<string> {
    return Promise.resolve("");
  }
}