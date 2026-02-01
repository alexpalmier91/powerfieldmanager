from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

SUPPORTED = {"fr", "en"}
DEFAULT_LANG = "fr"

class I18nMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 1. Cookie forcé par l'utilisateur
        cookie_lang = request.cookies.get("lang")
        if cookie_lang in SUPPORTED:
            request.state.lang = cookie_lang
        else:
            # 2. Tentative Accept-Language
            header = request.headers.get("Accept-Language", "").lower()
            if header.startswith("en"):
                request.state.lang = "en"
            else:
                request.state.lang = DEFAULT_LANG

        response = await call_next(request)
        return response
