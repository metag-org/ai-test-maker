import base64
import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.setting import AppSetting
from app.services.llm.prompts import build_extraction_prompt
from app.services.llm.schema import ExtractedPageResult

LLM_SETTINGS_KEY = "llm_config"

DEFAULT_LLM_CONFIG: dict[str, Any] = {
    "provider": "gemini",
    "gemini_api_key": "",
    "gemini_model": "gemini-2.5-flash",
    "openai_api_key": "",
    "openai_base_url": "https://api.openai.com/v1",
    "openai_model": "gpt-4o",
}


def get_llm_config(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, LLM_SETTINGS_KEY)
    merged = dict(DEFAULT_LLM_CONFIG)
    if row and isinstance(row.value, dict):
        merged.update(row.value)
    return merged


def mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


def _parse_json_safely(raw_text: str) -> ExtractedPageResult:
    text = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
    data = json.loads(text)
    return ExtractedPageResult.model_validate(data)


def extract_questions_from_image(
    db: Session,
    image_abs_path: Path,
    subject: str,
) -> ExtractedPageResult:
    cfg = get_llm_config(db)
    provider = cfg.get("provider", "gemini")
    prompt = build_extraction_prompt(subject)
    image_bytes = image_abs_path.read_bytes()

    if provider == "gemini":
        api_key = (cfg.get("gemini_api_key") or "").strip()
        if not api_key:
            raise ValueError("Gemini APIキーが未設定です。「設定」画面からAPIキーを登録してください。")
        model_name = (cfg.get("gemini_model") or "gemini-2.5-flash").strip()
        return _extract_with_gemini(api_key, model_name, image_bytes, prompt)

    if provider == "openai_compatible":
        api_key = (cfg.get("openai_api_key") or "").strip()
        base_url = (cfg.get("openai_base_url") or "https://api.openai.com/v1").strip()
        model_name = (cfg.get("openai_model") or "gpt-4o").strip()
        if not api_key:
            raise ValueError("OpenAI互換 APIキーが未設定です。「設定」画面からAPIキーを登録してください。")
        return _extract_with_openai(api_key, base_url, model_name, image_bytes, prompt)

    raise ValueError(f"未対応のLLMプロバイダです: {provider}")


def _extract_with_gemini(
    api_key: str,
    model_name: str,
    image_bytes: bytes,
    prompt: str,
) -> ExtractedPageResult:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model_name,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            prompt,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ExtractedPageResult,
            temperature=0.1,
        ),
    )

    if getattr(response, "parsed", None) is not None:
        return ExtractedPageResult.model_validate(response.parsed)
    raw_text = response.text or ""
    if not raw_text:
        raise RuntimeError("Gemini から空の応答が返されました。")
    return _parse_json_safely(raw_text)


def _extract_with_openai(
    api_key: str,
    base_url: str,
    model_name: str,
    image_bytes: bytes,
    prompt: str,
) -> ExtractedPageResult:
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url)
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"

    response = client.chat.completions.create(
        model=model_name,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                ],
            }
        ],
    )
    content = response.choices[0].message.content or ""
    if not content:
        raise RuntimeError("OpenAI互換 API から空の応答が返されました。")
    return _parse_json_safely(content)


def test_llm_connection(db: Session) -> dict[str, Any]:
    cfg = get_llm_config(db)
    provider = cfg.get("provider", "gemini")

    if provider == "gemini":
        api_key = (cfg.get("gemini_api_key") or "").strip()
        model_name = (cfg.get("gemini_model") or "gemini-2.5-flash").strip()
        if not api_key:
            return {"ok": False, "message": "Gemini APIキーが未設定です。"}
        try:
            from google import genai

            client = genai.Client(api_key=api_key)
            resp = client.models.generate_content(model=model_name, contents="Reply with OK only.")
            text = (resp.text or "").strip()
            return {"ok": True, "message": f"接続成功（Gemini / {model_name}）: {text[:40]}"}
        except Exception as exc:
            return {"ok": False, "message": f"接続失敗: {exc}"}

    if provider == "openai_compatible":
        api_key = (cfg.get("openai_api_key") or "").strip()
        base_url = (cfg.get("openai_base_url") or "https://api.openai.com/v1").strip()
        model_name = (cfg.get("openai_model") or "gpt-4o").strip()
        if not api_key:
            return {"ok": False, "message": "OpenAI互換 APIキーが未設定です。"}
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=base_url)
            resp = client.chat.completions.create(
                model=model_name,
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply with OK only."}],
            )
            text = (resp.choices[0].message.content or "").strip()
            return {"ok": True, "message": f"接続成功（{model_name}）: {text[:40]}"}
        except Exception as exc:
            return {"ok": False, "message": f"接続失敗: {exc}"}

    return {"ok": False, "message": f"未対応のプロバイダ: {provider}"}
