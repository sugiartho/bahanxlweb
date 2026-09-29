"""Decoy file helpers (storage-backed, safe under user_cwd)."""
from webui.storage.tenant import get_storage_username, read_user_json
from webui.storage.backend import USER_DECOY_DIR


def _decoy_prefix() -> str:
    return f"{USER_DECOY_DIR}/"


def _load_json(object_key: str) -> dict:
    data = read_user_json(object_key, default={})
    return data if isinstance(data, dict) else {}


def _configured(data: dict) -> bool:
    return bool(data.get("family_code") and data.get("variant_code"))


def _rp_label(price) -> str:
    try:
        n = int(price or 0)
        return f"Rp {n:,}".replace(",", ".")
    except (TypeError, ValueError):
        return "Rp ?"


def _method_for_builtin_kind(kind: str) -> str | None:
    return {
        "balance": "decoy_balance",
        "qris": "decoy_qris",
        "qris0": "decoy_qris0",
    }.get(kind)


def _pay_icon(kind: str) -> str:
    if kind == "balance":
        return "💳"
    if kind in ("qris", "qris0"):
        return "📱"
    return "🎭"


def _list_decoy_keys(pattern_prefix: str, glob_suffix: str) -> list[str]:
    from webui.storage import get_storage
    username = get_storage_username()
    keys = get_storage().list_blobs(username, f"{USER_DECOY_DIR}/")
    out = []
    for key in keys:
        name = key.removeprefix(f"{USER_DECOY_DIR}/")
        if name.startswith(pattern_prefix) and name.endswith(glob_suffix):
            out.append(key)
    return sorted(out)


def list_default_decoy_choices() -> list[dict]:
    choices: list[dict] = []
    for object_key in _list_decoy_keys("decoy-", ".json"):
        slot = object_key.split("/")[-1][len("decoy-"):-len(".json")]
        data = _load_json(object_key)
        if not _configured(data):
            continue
        kind = slot.rsplit("-", 1)[-1] if "-" in slot else slot
        method = _method_for_builtin_kind(kind)
        if not method:
            continue
        opt = (data.get("option_name") or data.get("variant_name") or slot).strip()
        price = _rp_label(data.get("price"))
        prefix = slot.rsplit("-", 1)[0] if "-" in slot else slot
        icon = _pay_icon(kind)
        choices.append({
            "label": f"{icon} {prefix} · {opt} ({price})",
            "method": method,
            "slot": slot,
            "tier": "default",
        })
    return choices


def list_custom_decoy_choices() -> list[dict]:
    choices: list[dict] = []
    for object_key in _list_decoy_keys("custom-", ".json"):
        name = object_key.split("/")[-1][len("custom-"):-len(".json")]
        data = _load_json(object_key)
        if not _configured(data):
            continue
        opt = (data.get("option_name") or name).strip()
        price = _rp_label(data.get("price"))
        base_m = (data.get("base_method") or "balance").lower()
        icon = "📱" if base_m == "qris" else "💳"
        choices.append({
            "label": f"{icon} {name} · {opt} ({price})",
            "method": f"decoy_custom_{name}",
            "slot": None,
            "tier": "custom",
        })
    return choices


def list_configured_decoy_choices() -> list[dict]:
    return list_default_decoy_choices() + list_custom_decoy_choices()