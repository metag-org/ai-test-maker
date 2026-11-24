import hashlib
import hmac

from fastapi import APIRouter, HTTPException, Request, Response

from app.config import settings
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

AUTH_COOKIE_NAME = "review_test_auth_token"


def make_auth_token() -> str:
    return hmac.new(
        settings.effective_secret.encode("utf-8"),
        f"authorized::{settings.app_password}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def is_request_authenticated(request: Request) -> bool:
    if not settings.app_password:
        return True
    token = request.cookies.get(AUTH_COOKIE_NAME, "")
    if not token:
        return False
    return hmac.compare_digest(token, make_auth_token())


@router.get("/status")
def auth_status(request: Request) -> dict[str, bool]:
    return {
        "password_enabled": bool(settings.app_password),
        "authenticated": is_request_authenticated(request),
    }


@router.post("/login")
def login(payload: LoginRequest, response: Response) -> dict[str, bool]:
    if not settings.app_password:
        return {"authenticated": True}
    if not hmac.compare_digest(payload.password, settings.app_password):
        raise HTTPException(status_code=401, detail="パスワードが正しくありません。")
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=make_auth_token(),
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
    )
    return {"authenticated": True}


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(key=AUTH_COOKIE_NAME)
    return {"authenticated": False}
