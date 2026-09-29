"""Per-request middleware: validate webui session cookie, bind storage tenant,
then reload AuthInstance/BookmarkInstance from storage for that user."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse, Response
from starlette.types import ASGIApp

from webui.users import (
    COOKIE_NAME,
    parse_session_token,
    get_user,
    user_dir,
)
from webui.context import current_user_dir
from webui.storage.tenant import (
    current_storage_username,
    ensure_user_bootstrap,
)

PUBLIC_PATHS = (
    "/u/login",
    "/u/register",
    "/u/logout",
    "/static/",
    "/favicon",
    "/u/api/",
)


class WebUIAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request, call_next):
        path = request.url.path
        is_public = any(path == p.rstrip("/") or path.startswith(p) for p in PUBLIC_PATHS)

        token = request.cookies.get(COOKIE_NAME)
        username = parse_session_token(token) if token else None
        user = get_user(username) if username else None

        if not user:
            if is_public:
                return await call_next(request)
            accept = request.headers.get("accept", "")
            if "text/html" in accept or accept == "" or accept == "*/*":
                return RedirectResponse(url=f"/u/login?next={path}", status_code=303)
            return Response("Unauthorized", status_code=401)

        uname = user["username"]
        udir = user_dir(uname)
        udir.mkdir(parents=True, exist_ok=True)
        ensure_user_bootstrap(uname)

        dir_token = current_user_dir.set(udir)
        user_token = current_storage_username.set(uname)

        try:
            try:
                from app.service.auth import AuthInstance
                AuthInstance.reload_for_current_dir()
            except Exception:
                pass
            try:
                from app.service.bookmark import BookmarkInstance
                BookmarkInstance.reload_for_current_dir()
            except Exception:
                pass
            try:
                from app.service.decoy import DecoyInstance
                DecoyInstance.reset_decoys()
            except Exception:
                pass

            request.state.webui_user = user
            request.state.webui_user_dir = str(udir)

            response = await call_next(request)
            return response
        finally:
            current_storage_username.reset(user_token)
            current_user_dir.reset(dir_token)