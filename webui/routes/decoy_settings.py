import json
import re

from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse, JSONResponse

from app.service.auth import AuthInstance
from app.service.decoy import DecoyInstance
from app.client.engsel import get_package_details
from webui.deps import render, get_active_user_safe
from webui.storage.backend import USER_DECOY_DIR
from webui.storage.tenant import (
    delete_user_blob,
    read_user_json,
    user_blob_exists,
    write_user_json,
)

router = APIRouter()

BUILTIN_SLOTS = [
    {"key": "default-balance", "label": "Default · Pulsa", "subtype": "Reguler", "method": "balance"},
    {"key": "default-qris",    "label": "Default · QRIS (+1K)", "subtype": "Reguler", "method": "qris"},
    {"key": "default-qris0",   "label": "Default · QRIS (Rp0)", "subtype": "Reguler", "method": "qris0"},
    {"key": "prio-balance",    "label": "Prio · Pulsa",      "subtype": "PRIORITAS/PRIOHYBRID/GO", "method": "balance"},
    {"key": "prio-qris",       "label": "Prio · QRIS (+1K)", "subtype": "PRIORITAS/PRIOHYBRID/GO", "method": "qris"},
    {"key": "prio-qris0",      "label": "Prio · QRIS (Rp0)", "subtype": "PRIORITAS/PRIOHYBRID/GO", "method": "qris0"},
]
BUILTIN_KEYS = {s["key"] for s in BUILTIN_SLOTS}

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,30}$")


def _builtin_key(key: str) -> str:
    return f"{USER_DECOY_DIR}/decoy-{key}.json"


def _custom_key(name: str) -> str:
    return f"{USER_DECOY_DIR}/custom-{name}.json"


def _load_json(object_key: str) -> dict:
    data = read_user_json(object_key, default={})
    return data if isinstance(data, dict) else {}


def _save_json(object_key: str, data: dict) -> None:
    write_user_json(object_key, data)


def list_custom_decoys() -> list[dict]:
    from webui.storage import get_storage
    from webui.storage.tenant import get_storage_username

    keys = get_storage().list_blobs(get_storage_username(), f"{USER_DECOY_DIR}/custom-")
    out = []
    for object_key in sorted(keys):
        name = object_key.split("/")[-1][len("custom-"):-len(".json")]
        data = _load_json(object_key)
        out.append({"name": name, "data": data, "base_method": data.get("base_method", "balance")})
    return out


def list_builtin_decoys() -> list[dict]:
    out = []
    for slot in BUILTIN_SLOTS:
        out.append({**slot, "data": _load_json(_builtin_key(slot["key"]))})
    return out


@router.get("/settings/decoy")
def decoy_page(request: Request, msg: str | None = None):
    return render(
        request, "decoy_settings.html",
        builtins=list_builtin_decoys(),
        customs=list_custom_decoys(),
        msg=msg,
    )


def _parse_form_to_data(form: dict, include_base_method: bool = False) -> dict:
    data = {
        "family_name": (form.get("family_name") or "").strip(),
        "family_code": (form.get("family_code") or "").strip(),
        "is_enterprise": str(form.get("is_enterprise", "")).lower() in ("true", "1", "yes", "on"),
        "migration_type": (form.get("migration_type") or "NONE").strip(),
        "variant_name": (form.get("variant_name") or "").strip(),
        "variant_code": (form.get("variant_code") or "").strip(),
        "option_name": (form.get("option_name") or "").strip(),
        "order": int(form.get("order", 1) or 1),
        "price": int(form.get("price", 0) or 0),
    }
    if include_base_method:
        bm = (form.get("base_method") or "balance").strip().lower()
        if bm not in ("balance", "qris"):
            bm = "balance"
        data["base_method"] = bm
    return data


@router.post("/settings/decoy/builtin/{key}")
async def update_builtin(request: Request, key: str):
    if key not in BUILTIN_KEYS:
        return render(request, "error.html", title="Slot tidak dikenal", message=f"Builtin slot '{key}' invalid")
    form = await request.form()
    data = _parse_form_to_data(form)
    _save_json(_builtin_key(key), data)
    DecoyInstance.reset_decoys()
    return RedirectResponse(url=f"/settings/decoy?msg=Built-in+%27{key}%27+disimpan", status_code=303)


@router.post("/settings/decoy/custom/add")
async def add_custom(request: Request):
    form = await request.form()
    name = (form.get("name") or "").strip().lower()
    if not NAME_RE.match(name):
        return render(request, "error.html",
                      title="Nama invalid",
                      message="Nama hanya boleh: huruf kecil, angka, _, - (max 31 char). Contoh: v1, vtest, my-decoy")
    object_key = _custom_key(name)
    if user_blob_exists(object_key):
        return render(request, "error.html", title="Nama duplikat",
                      message=f"Custom decoy bernama '{name}' sudah ada. Pilih nama lain atau edit yang ada.")
    data = _parse_form_to_data(form, include_base_method=True)
    _save_json(object_key, data)
    return RedirectResponse(url=f"/settings/decoy?msg=Custom+%27{name}%27+ditambahkan", status_code=303)


@router.post("/settings/decoy/custom/{name}")
async def update_custom(request: Request, name: str):
    if not NAME_RE.match(name):
        return render(request, "error.html", title="Nama invalid", message=name)
    object_key = _custom_key(name)
    if not user_blob_exists(object_key):
        return render(request, "error.html", title="Tidak ditemukan", message=f"custom-{name}.json belum ada")
    form = await request.form()
    data = _parse_form_to_data(form, include_base_method=True)
    _save_json(object_key, data)
    return RedirectResponse(url=f"/settings/decoy?msg=Custom+%27{name}%27+disimpan", status_code=303)


@router.post("/settings/decoy/custom/{name}/delete")
def delete_custom(request: Request, name: str):
    if not NAME_RE.match(name):
        return render(request, "error.html", title="Nama invalid", message=name)
    delete_user_blob(_custom_key(name))
    return RedirectResponse(url=f"/settings/decoy?msg=Custom+%27{name}%27+dihapus", status_code=303)


def get_custom_decoy_data(name: str) -> dict | None:
    if not NAME_RE.match(name):
        return None
    object_key = _custom_key(name)
    if not user_blob_exists(object_key):
        return None
    return _load_json(object_key)


@router.post("/settings/decoy/raw/{kind}/{key}")
async def update_raw_json(request: Request, kind: str, key: str):
    form = await request.form()
    raw = form.get("raw_json", "")
    if not raw.strip():
        return render(request, "error.html", title="JSON kosong", message="Masukin JSON yang valid")
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Root harus berupa object (dict)")
    except Exception as e:
        return render(request, "error.html", title="JSON invalid", message=str(e))

    if kind == "builtin":
        if key not in BUILTIN_KEYS:
            return render(request, "error.html", title="Slot tidak dikenal", message=key)
        _save_json(_builtin_key(key), data)
        DecoyInstance.reset_decoys()
        return RedirectResponse(url=f"/settings/decoy?msg=Built-in+%27{key}%27+(JSON)+disimpan", status_code=303)
    elif kind == "custom":
        if not NAME_RE.match(key):
            return render(request, "error.html", title="Nama invalid", message=key)
        if "base_method" not in data:
            data["base_method"] = "balance"
        _save_json(_custom_key(key), data)
        return RedirectResponse(url=f"/settings/decoy?msg=Custom+%27{key}%27+(JSON)+disimpan", status_code=303)
    return render(request, "error.html", title="Kind invalid", message=kind)


@router.post("/settings/decoy/test/{kind}/{key}")
def test_fetch(request: Request, kind: str, key: str):
    user = get_active_user_safe()
    if not user:
        return JSONResponse({"ok": False, "error": "Belum ada akun aktif"}, status_code=200)

    if kind == "builtin":
        data = _load_json(_builtin_key(key))
    elif kind == "custom":
        if not NAME_RE.match(key):
            return JSONResponse({"ok": False, "error": "Nama custom invalid"}, status_code=200)
        data = _load_json(_custom_key(key))
    else:
        return JSONResponse({"ok": False, "error": "Kind invalid"}, status_code=200)

    if not data:
        return JSONResponse({"ok": False, "error": "File kosong / tidak ditemukan"}, status_code=200)
    if not data.get("family_code") or not data.get("variant_code"):
        return JSONResponse({"ok": False, "error": "family_code / variant_code belum diisi"}, status_code=200)

    attempts = [
        (data.get("is_enterprise", False), data.get("migration_type", "NONE"), "stored"),
        (None, None, "auto"),
    ]
    pkg = None
    last_attempt = None
    for ie, mt, label in attempts:
        try:
            pkg = get_package_details(
                AuthInstance.api_key, user["tokens"],
                data["family_code"], data["variant_code"], data.get("order", 1) or 1,
                ie, mt,
            )
        except Exception as e:
            return JSONResponse({"ok": False, "error": f"Exception: {e}"}, status_code=200)
        last_attempt = label
        if pkg:
            break

    if not pkg:
        return JSONResponse({
            "ok": False,
            "error": (
                "Server MyXL nolak family_code/variant_code (semua kombo is_enterprise × migration_type gagal). "
                "UUID mungkin expired, atau paket nggak available untuk subscription "
                + (user.get("subscription_type") or "?") + ". "
                "Cari family_code/variant_code lain dari /store/segments atau /store/packages."
            ),
        }, status_code=200)

    opt = pkg.get("package_option") or {}
    return JSONResponse({
        "ok": True,
        "option_code": opt.get("package_option_code", ""),
        "option_name": opt.get("name", ""),
        "price": opt.get("price", 0),
        "validity": opt.get("validity", ""),
        "note": (None if last_attempt == "stored"
                 else "️ Berhasil pakai mode AUTO (is_enterprise/migration_type stored ditolak server). Boleh saved as-is — sistem tetap retry saat beli."),
    }, status_code=200)