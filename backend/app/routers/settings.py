from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.setting import AppSetting
from app.schemas import LLMSettingsRead, LLMSettingsUpdate
from app.services.llm.provider import (
    LLM_SETTINGS_KEY,
    get_llm_config,
    mask_api_key,
    test_llm_connection,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _to_read(cfg: dict) -> LLMSettingsRead:
    g_key = cfg.get("gemini_api_key") or ""
    o_key = cfg.get("openai_api_key") or ""
    return LLMSettingsRead(
        provider=cfg.get("provider", "gemini"),
        gemini_api_key_masked=mask_api_key(g_key),
        gemini_has_key=bool(g_key),
        gemini_model=cfg.get("gemini_model") or "gemini-2.5-flash",
        openai_api_key_masked=mask_api_key(o_key),
        openai_has_key=bool(o_key),
        openai_base_url=cfg.get("openai_base_url") or "https://api.openai.com/v1",
        openai_model=cfg.get("openai_model") or "gpt-4o",
    )


@router.get("/llm", response_model=LLMSettingsRead)
def get_llm_settings(db: Session = Depends(get_db)) -> LLMSettingsRead:
    return _to_read(get_llm_config(db))


@router.put("/llm", response_model=LLMSettingsRead)
def update_llm_settings(payload: LLMSettingsUpdate, db: Session = Depends(get_db)) -> LLMSettingsRead:
    cfg = get_llm_config(db)
    cfg["provider"] = payload.provider
    cfg["gemini_model"] = payload.gemini_model.strip() or "gemini-2.5-flash"
    cfg["openai_base_url"] = payload.openai_base_url.strip() or "https://api.openai.com/v1"
    cfg["openai_model"] = payload.openai_model.strip() or "gpt-4o"

    # APIキーは明示的に入力された場合のみ上書き（空文字や未指定なら既存維持）
    if payload.gemini_api_key is not None and payload.gemini_api_key.strip() != "":
        cfg["gemini_api_key"] = payload.gemini_api_key.strip()
    if payload.openai_api_key is not None and payload.openai_api_key.strip() != "":
        cfg["openai_api_key"] = payload.openai_api_key.strip()

    row = db.get(AppSetting, LLM_SETTINGS_KEY)
    if row is None:
        row = AppSetting(key=LLM_SETTINGS_KEY, value=cfg)
        db.add(row)
    else:
        row.value = cfg
    db.commit()
    return _to_read(cfg)


@router.post("/llm/test")
def test_llm(db: Session = Depends(get_db)) -> dict:
    return test_llm_connection(db)
