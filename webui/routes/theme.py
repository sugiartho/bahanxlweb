"""Theme settings route — allows users to switch between dark and light themes."""
from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse

from webui.users import set_theme
from webui.deps import render

router = APIRouter()


@router.get("/settings/theme")
def theme_page(request: Request, msg: str | None = None):
    webui_user = getattr(request.state, "webui_user", None)
    current_theme = (webui_user or {}).get("theme", "dark")
    return render(
        request, "theme_settings.html",
        current_theme=current_theme,
        msg=msg,
    )


@router.post("/settings/theme")
async def update_theme(request: Request, theme: str = Form(...)):
    webui_user = getattr(request.state, "webui_user", None)
    if not webui_user:
        return RedirectResponse(url="/u/login", status_code=303)
    if theme not in ("dark", "light"):
        theme = "dark"
    set_theme(webui_user["username"], theme)
    return RedirectResponse(url=f"/settings/theme?msg=Tema+berhasil+diubah+ke+{theme}", status_code=303)
