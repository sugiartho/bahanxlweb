-- WebUI-XL SQLite storage schema (Phase 1 — maps to D1 in Phase 2)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    version         INTEGER NOT NULL,
    applied_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webui_users (
    username        TEXT PRIMARY KEY,
    password_hash   TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    theme           TEXT NOT NULL DEFAULT 'dark',
    telegram_chat_id INTEGER
);

CREATE TABLE IF NOT EXISTS storage_meta (
    key             TEXT PRIMARY KEY,
    value           BLOB NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- scope: global | user | cli
CREATE TABLE IF NOT EXISTS blobs (
    scope           TEXT NOT NULL,
    username        TEXT NOT NULL DEFAULT '',
    object_key      TEXT NOT NULL,
    data            BLOB NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (scope, username, object_key)
);

CREATE INDEX IF NOT EXISTS idx_blobs_user_prefix
    ON blobs (scope, username, object_key);

CREATE INDEX IF NOT EXISTS idx_webui_users_telegram
    ON webui_users (telegram_chat_id);