import base64
import json
import re
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.setting import AppSetting
from app.services.llm.prompts import build_extraction_prompt
from app.services.llm.schema import ExtractedPageResult

T = TypeVar("T", bound=BaseModel)

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


def _parse_json_safely(raw_text: str, schema_cls: type[T]) -> T:
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
    return schema_cls.model_validate(data)


def run_structured_llm_with_usage(
    db: Session,
    prompt: str,
    schema_cls: type[T],
    images: list[tuple[bytes, str]] | None = None,
    temperature: float = 0.1,
) -> tuple[T, dict[str, Any]]:
    """
    汎用マルチモーダル構造化LLM呼び出し（トークン消費量も同時に返す）。
    images: [(image_bytes, mime_type), ...]
    """
    cfg = get_llm_config(db)
    provider = cfg.get("provider", "gemini")
    image_list = images or []

    if provider == "gemini":
        api_key = (cfg.get("gemini_api_key") or "").strip()
        if not api_key:
            raise ValueError("Gemini APIキーが未設定です。「設定」画面からAPIキーを登録してください。")
        model_name = (cfg.get("gemini_model") or "gemini-2.5-flash").strip()
        return _call_gemini_structured(api_key, model_name, prompt, schema_cls, image_list, temperature)

    if provider == "openai_compatible":
        api_key = (cfg.get("openai_api_key") or "").strip()
        base_url = (cfg.get("openai_base_url") or "https://api.openai.com/v1").strip()
        model_name = (cfg.get("openai_model") or "gpt-4o").strip()
        if not api_key:
            raise ValueError("OpenAI互換 APIキーが未設定です。「設定」画面からAPIキーを登録してください。")
        return _call_openai_structured(api_key, base_url, model_name, prompt, schema_cls, image_list, temperature)

    raise ValueError(f"未対応のLLMプロバイダです: {provider}")


def run_structured_llm(
    db: Session,
    prompt: str,
    schema_cls: type[T],
    images: list[tuple[bytes, str]] | None = None,
    temperature: float = 0.1,
) -> T:
    result, _ = run_structured_llm_with_usage(
        db=db,
        prompt=prompt,
        schema_cls=schema_cls,
        images=images,
        temperature=temperature,
    )
    return result


def _call_gemini_structured(
    api_key: str,
    model_name: str,
    prompt: str,
    schema_cls: type[T],
    images: list[tuple[bytes, str]],
    temperature: float,
) -> tuple[T, dict[str, Any]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    contents: list[Any] = []
    for img_bytes, mime_type in images:
        contents.append(types.Part.from_bytes(data=img_bytes, mime_type=mime_type))
    contents.append(prompt)

    response = client.models.generate_content(
        model=model_name,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema_cls,
            temperature=temperature,
        ),
    )

    um = getattr(response, "usage_metadata", None)
    input_tokens = int(getattr(um, "prompt_token_count", 0) or 0)
    output_tokens = int(getattr(um, "candidates_token_count", 0) or 0)
    thoughts_tokens = int(getattr(um, "thoughts_token_count", 0) or 0)
    total_tokens = int(getattr(um, "total_token_count", 0) or (input_tokens + output_tokens + thoughts_tokens))
    usage: dict[str, Any] = {
        "provider": "gemini",
        "model": model_name,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "thoughts_tokens": thoughts_tokens,
        "total_tokens": total_tokens,
    }

    if getattr(response, "parsed", None) is not None:
        return schema_cls.model_validate(response.parsed), usage
    raw_text = response.text or ""
    if not raw_text:
        raise RuntimeError("Gemini から空の応答が返されました。")
    return _parse_json_safely(raw_text, schema_cls), usage


def _call_openai_structured(
    api_key: str,
    base_url: str,
    model_name: str,
    prompt: str,
    schema_cls: type[T],
    images: list[tuple[bytes, str]],
    temperature: float,
) -> tuple[T, dict[str, Any]]:
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url)
    user_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for img_bytes, mime_type in images:
        b64 = base64.b64encode(img_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64}"
        user_content.append({"type": "image_url", "image_url": {"url": data_url, "detail": "high"}})

    response = client.chat.completions.create(
        model=model_name,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": user_content}],
    )
    u = getattr(response, "usage", None)
    input_tokens = int(getattr(u, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(u, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(u, "total_tokens", 0) or (input_tokens + output_tokens))
    usage: dict[str, Any] = {
        "provider": "openai_compatible",
        "model": model_name,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "thoughts_tokens": 0,
        "total_tokens": total_tokens,
    }

    content = response.choices[0].message.content or ""
    if not content:
        raise RuntimeError("OpenAI互換 API から空の応答が返されました。")
    return _parse_json_safely(content, schema_cls), usage


def extract_questions_from_image_with_usage(
    db: Session,
    image_abs_path: Path,
    subject: str,
) -> tuple[ExtractedPageResult, dict[str, Any]]:
    prompt = build_extraction_prompt(subject)
    image_bytes = image_abs_path.read_bytes()
    return run_structured_llm_with_usage(
        db=db,
        prompt=prompt,
        schema_cls=ExtractedPageResult,
        images=[(image_bytes, "image/jpeg")],
        temperature=0.1,
    )


def extract_questions_from_image(
    db: Session,
    image_abs_path: Path,
    subject: str,
) -> ExtractedPageResult:
    result, _ = extract_questions_from_image_with_usage(db, image_abs_path, subject)
    return result


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
