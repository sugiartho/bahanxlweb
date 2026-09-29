-- Google OAuth + Telegram link codes
ALTER TABLE webui_users ADD COLUMN email TEXT;
ALTER TABLE webui_users ADD COLUMN google_sub TEXT;
ALTER TABLE webui_users ADD COLUMN google_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webui_users_google_sub
    ON webui_users (google_sub)
    WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code              TEXT PRIMARY KEY,
    username          TEXT NOT NULL,
    expires_at        INTEGER NOT NULL,
    created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_username
    ON telegram_link_codes (username);