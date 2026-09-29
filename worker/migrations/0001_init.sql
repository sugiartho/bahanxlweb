-- WebUI-XL D1 schema (Phase 2 production)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    version         INTEGER NOT NULL,
    applied_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webui_users (
    username         TEXT PRIMARY KEY,
    password_hash    TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    theme            TEXT NOT NULL DEFAULT 'dark',
    telegram_chat_id INTEGER,
    updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webui_users_telegram
    ON webui_users (telegram_chat_id);

CREATE TABLE IF NOT EXISTS storage_meta (
    key              TEXT PRIMARY KEY,
    value            BLOB NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_config (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    secret_version   INTEGER NOT NULL DEFAULT 1,
    rotated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_config (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    bot_token_ref            TEXT NOT NULL DEFAULT 'TELEGRAM_BOT_TOKEN',
    enabled                  INTEGER NOT NULL DEFAULT 0,
    daily_summary_enabled    INTEGER NOT NULL DEFAULT 1,
    daily_summary_hour       INTEGER NOT NULL DEFAULT 7,
    daily_summary_minute     INTEGER NOT NULL DEFAULT 0,
    low_quota_threshold_pct  INTEGER NOT NULL DEFAULT 10,
    poll_interval_minutes    INTEGER NOT NULL DEFAULT 5,
    webhook_secret           TEXT,
    updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monitoring_rules (
    id                TEXT PRIMARY KEY,
    username          TEXT NOT NULL REFERENCES webui_users(username) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    msisdn            TEXT NOT NULL,
    match_json        TEXT NOT NULL,
    trigger_json      TEXT NOT NULL,
    actions_json      TEXT NOT NULL,
    cooldown_seconds  INTEGER NOT NULL DEFAULT 3600,
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_fired_at     INTEGER,
    last_status       TEXT,
    last_msg          TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON monitoring_rules(username);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON monitoring_rules(enabled);

CREATE TABLE IF NOT EXISTS otp_sessions (
    phone             TEXT PRIMARY KEY,
    subscriber_id     TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_chat_state (
    chat_id           INTEGER PRIMARY KEY,
    username          TEXT REFERENCES webui_users(username) ON DELETE SET NULL,
    step              TEXT,
    data_json         TEXT DEFAULT '{}',
    active_msisdn     TEXT,
    account_msisdn    TEXT,
    pkg_map_json      TEXT DEFAULT '{}',
    unsub_map_json    TEXT DEFAULT '{}',
    updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_pending_confirm (
    chat_id           INTEGER PRIMARY KEY,
    confirm_type      TEXT NOT NULL,
    payload_json      TEXT NOT NULL,
    expires_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS error_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        INTEGER NOT NULL,
    username          TEXT,
    route             TEXT,
    method            TEXT,
    message           TEXT NOT NULL,
    stack             TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);

-- R2 object index (list blobs without R2 list ops)
CREATE TABLE IF NOT EXISTS r2_objects (
    scope             TEXT NOT NULL,
    username          TEXT NOT NULL DEFAULT '',
    object_key        TEXT NOT NULL,
    r2_path           TEXT NOT NULL,
    size_bytes        INTEGER,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (scope, username, object_key)
);

CREATE INDEX IF NOT EXISTS idx_r2_objects_scope_user
    ON r2_objects (scope, username, object_key);