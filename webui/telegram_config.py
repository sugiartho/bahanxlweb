"""Global Telegram bot configuration (instance-wide, not per-user)."""
import json

from webui.storage.backend import GLOBAL_TELEGRAM_CONFIG

_DEFAULTS = {
    "bot_token": "",
    "enabled": False,
    "daily_summary_enabled": True,
    "daily_summary_hour": 7,
    "daily_summary_minute": 0,
    "low_quota_threshold_pct": 10,
    "poll_interval_minutes": 5,
}


def load_config() -> dict:
    from webui.storage import get_storage
    raw = get_storage().get_blob(None, GLOBAL_TELEGRAM_CONFIG)
    if not raw:
        return dict(_DEFAULTS)
    try:
        data = json.loads(raw)
        merged = dict(_DEFAULTS)
        merged.update(data)
        return merged
    except Exception:
        return dict(_DEFAULTS)


def save_config(cfg: dict) -> None:
    from webui.storage import get_storage
    merged = dict(_DEFAULTS)
    merged.update(cfg)
    get_storage().put_blob(None, GLOBAL_TELEGRAM_CONFIG, json.dumps(merged, indent=2))