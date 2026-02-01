from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

NO_CACHE_PATHS = (
    "/login",
    "/dashboard",
    "/superuser",
    "/agent",
    "/labo",
    "/api-zenhub/auth",
)

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        path = request.url.path
        if path.startswith(NO_CACHE_PATHS):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        return response
