"""Per-user quota snapshot cache (storage-backed)."""
import json
import time

from webui.storage.backend import USER_QUOTA_CACHE


def _storage():
    from webui.storage import get_storage
    return get_storage()


def load_cache(username: str) -> dict:
    raw = _storage().get_blob(username, USER_QUOTA_CACHE)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_cache(username: str, data: dict) -> None:
    _storage().put_blob(username, USER_QUOTA_CACHE, json.dumps(data, indent=2))


def _quota_display_name(q: dict) -> str:
    direct = (q.get("name") or "").strip()
    if direct:
        return direct
    family = (q.get("package_family") or {}).get("name")
    if family:
        return str(family)
    variants = q.get("package_variants") or {}
    variant = variants.get("display_name") or variants.get("name")
    if variant:
        return str(variant)
    group = (q.get("group_name") or "").strip()
    if group:
        return group
    return "-"


def extract_quota_name_options(cache: dict) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for msisdn, data in (cache or {}).items():
        for q in (data or {}).get("quotas") or []:
            name = _quota_display_name(q)
            if not name or name == "-":
                continue
            key = f"{msisdn}:{name}"
            if key in seen:
                continue
            seen.add(key)
            out.append({"msisdn": str(msisdn), "name": name})
    return sorted(out, key=lambda x: (x["msisdn"], x["name"]))


DEFAULT_RULE_TELEGRAM_MESSAGE = (
    "{nodefault}⚠️ <b>Peringatan Kuota</b>\n\n"
    "📱 <code>{msisdn}</code>\n"
    "📦 <b>{quota}</b>\n"
    "📊 {benefit}: <b>{pct}%</b> tersisa ({remaining} / {total})\n\n"
    "<i>Segera top up biar kuota nggak habis ya!</i>"
)


def update_account_cache(username: str, msisdn: int, balance: dict | None, quotas: list | None) -> None:
    cache = load_cache(username)
    cache[str(msisdn)] = {
        "updated_at": int(time.time()),
        "balance": balance,
        "quotas": quotas,
    }
    save_cache(username, cache)