import json
from fastapi import APIRouter, Request
from webui.deps import render
from webui.storage import get_storage
from webui.storage.backend import SHARED_HOT, SHARED_HOT2

router = APIRouter()


def _read_hot(object_key: str):
    raw = get_storage().get_blob(None, object_key)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


@router.get("/hot")
def hot(request: Request):
    return render(request, "hot.html", title=" Hot", packages=_read_hot(SHARED_HOT), kind="hot")


@router.get("/hot2")
def hot2(request: Request):
    return render(request, "hot.html", title=" Hot-2", packages=_read_hot(SHARED_HOT2), kind="hot2")