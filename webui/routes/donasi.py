from fastapi import APIRouter, Request
from webui.deps import render

router = APIRouter()

@router.get("/donasi")
def donasi_page(request: Request):
    return render(request, "donasi.html")
