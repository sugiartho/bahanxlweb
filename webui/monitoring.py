"""Quota monitoring storage + helpers (storage-backed per user)."""
import json
import time
import uuid
from typing import Optional

import requests

from webui.storage.backend import USER_MONITORING, USER_MONITOR_LOG, USER_TELEGRAM
from webui.storage.tenant import read_user_json, read_user_text, write_user_json, write_user_text


def _read_json(key: str, default):
    data = read_user_json(key, default=default)
    return data if data is not None else default


def _write_json(key: str, data) -> None:
    write_user_json(key, data)


def load_telegram() -> dict:
    data = _read_json(USER_TELEGRAM, {"bot_token": "", "chat_id": ""})
    return data if isinstance(data, dict) else {"bot_token": "", "chat_id": ""}


def save_telegram(bot_token: str, chat_id: str) -> None:
    _write_json(USER_TELEGRAM, {
        "bot_token": (bot_token or "").strip(),
        "chat_id": (chat_id or "").strip(),
    })


def resolve_send_config(username: Optional[str] = None) -> dict:
    from webui import telegram_config as TC
    from webui.users import get_user

    global_cfg = TC.load_config()
    token = (global_cfg.get("bot_token") or "").strip()
    chat = ""

    if username:
        u = get_user(username)
        if u and u.get("telegram_chat_id"):
            chat = str(u["telegram_chat_id"])

    per_user = load_telegram()
    if not chat:
        chat = (per_user.get("chat_id") or "").strip()
    if not token:
        token = (per_user.get("bot_token") or "").strip()

    return {"bot_token": token, "chat_id": chat}


def send_telegram(text: str, *, cfg: Optional[dict] = None, username: Optional[str] = None) -> tuple[bool, str]:
    cfg = cfg or resolve_send_config(username)
    token = cfg.get("bot_token", "").strip()
    chat = cfg.get("chat_id", "").strip()
    if not token or not chat:
        return False, "Bot token / chat_id belum di-set"
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=15,
        )
        if r.status_code == 200 and r.json().get("ok"):
            return True, "Pesan terkirim"
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return False, f"Exception: {e}"


def load_rules() -> list[dict]:
    rules = _read_json(USER_MONITORING, [])
    return rules if isinstance(rules, list) else []


def save_rules(rules: list[dict]) -> None:
    _write_json(USER_MONITORING, rules)


def get_rule(rule_id: str) -> Optional[dict]:
    for r in load_rules():
        if r.get("id") == rule_id:
            return r
    return None


def add_rule(payload: dict) -> dict:
    rules = load_rules()
    rule = {
        "id": uuid.uuid4().hex[:12],
        "name": payload.get("name") or "Untitled",
        "msisdn": int(payload.get("msisdn") or 0),
        "match": payload.get("match") or {"kind": "any", "value": None, "data_type": "ANY"},
        "trigger": payload.get("trigger") or {"metric": "remaining_pct", "op": "lt", "value": 10},
        "actions": payload.get("actions") or [],
        "cooldown_seconds": int(payload.get("cooldown_seconds") or 3600),
        "enabled": bool(payload.get("enabled", True)),
        "created_at": int(time.time()),
        "last_fired_at": 0,
        "last_status": "",
        "last_msg": "",
    }
    rules.append(rule)
    save_rules(rules)
    return rule


def update_rule(rule_id: str, patch: dict) -> Optional[dict]:
    rules = load_rules()
    for r in rules:
        if r.get("id") == rule_id:
            for k, v in patch.items():
                if k in ("id", "created_at"):
                    continue
                r[k] = v
            save_rules(rules)
            return r
    return None


def delete_rule(rule_id: str) -> bool:
    rules = load_rules()
    n = len(rules)
    rules = [r for r in rules if r.get("id") != rule_id]
    if len(rules) != n:
        save_rules(rules)
        return True
    return False


def mark_fired(rule_id: str, status: str, msg: str) -> None:
    rules = load_rules()
    for r in rules:
        if r.get("id") == rule_id:
            r["last_fired_at"] = int(time.time())
            r["last_status"] = status
            r["last_msg"] = msg
            save_rules(rules)
            return


LOG_MAX_BYTES = 256 * 1024


def log_line(line: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    full = f"[{ts}] {line}\n"
    try:
        existing = read_user_text(USER_MONITOR_LOG) or ""
        combined = existing + full
        if len(combined.encode("utf-8")) > LOG_MAX_BYTES:
            lines = combined.splitlines()
            combined = "\n".join(lines[-200:]) + "\n"
        write_user_text(USER_MONITOR_LOG, combined)
    except Exception:
        pass


def tail_log(n: int = 100) -> list[str]:
    try:
        text = read_user_text(USER_MONITOR_LOG)
        if not text:
            return []
        lines = text.splitlines()
        return lines[-n:]
    except Exception:
        return []