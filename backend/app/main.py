from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, exams, groups, settings as settings_router, submissions, upload
from app.routers.auth import is_request_authenticated

app = FastAPI(title="復習テストメーカー API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def optional_password_guard(request: Request, call_next):
    path = request.url.path
    if settings.app_password:
        is_protected = path.startswith("/api/") or path.startswith("/uploads/")
        is_public = path in ("/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/logout")
        if is_protected and not is_public and not is_request_authenticated(request):
            return JSONResponse(status_code=401, content={"detail": "認証が必要です。"})
    return await call_next(request)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(settings_router.router)
app.include_router(upload.router)
app.include_router(groups.router)
app.include_router(exams.router)
app.include_router(submissions.router)

# アップロード画像の配信
app.mount("/uploads", StaticFiles(directory=str(settings.upload_path)), name="uploads")

# ビルド済み React 静的ファイルの配信 (Docker 本番単一コンテナ構成)
static_path = Path(settings.static_dir).resolve()
if static_path.exists() and (static_path / "index.html").exists():
    assets_dir = static_path / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = (static_path / full_path).resolve()
        if full_path and static_path in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(
            static_path / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
