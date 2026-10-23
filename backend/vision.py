from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from backend.explain import describe_marks
from backend.paths import config_path, env_path

DEFAULT_CONFIG = {
    "vision_api_key": "",
    "vision_base_url": "https://api.openai.com/v1",
    "vision_model": "gpt-4o-mini",
}

ENV_FIELDS = {
    "PIANO_AI_API_KEY": "vision_api_key",
    "PIANO_AI_BASE_URL": "vision_base_url",
    "PIANO_AI_MODEL": "vision_model",
}


def parse_env_file(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if name:
            values[name] = value
    return values


def _apply_nonempty(config: dict, field: str, value: object) -> None:
    text = str(value or "").strip()
    if text:
        config[field] = text


def load_config() -> dict:
    """Real environment variables win, then .env, then a legacy data/config.json."""
    config = dict(DEFAULT_CONFIG)
    path = config_path()
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            loaded = None
        if isinstance(loaded, dict):
            for field in DEFAULT_CONFIG:
                if field in loaded:
                    _apply_nonempty(config, field, loaded[field])
    env_file = env_path()
    if env_file.exists():
        parsed = parse_env_file(env_file.read_text(encoding="utf-8"))
        for env_name, field in ENV_FIELDS.items():
            if env_name in parsed:
                _apply_nonempty(config, field, parsed[env_name])
    for env_name, field in ENV_FIELDS.items():
        if env_name in os.environ:
            _apply_nonempty(config, field, os.environ.get(env_name))
    return config


def config_status() -> dict:
    key = str(load_config().get("vision_api_key") or "").strip()
    return {"aiConfigured": bool(key)}


def explain_marks(marks: list[dict]) -> dict:
    """The score identifies the marks. The model explains what they mean and how to play them."""
    identified = describe_marks(marks)
    if not identified:
        return {
            "mode": "marks",
            "text": "没有点到谱号、拍号或音符。点一下音符，或音符旁边的记号。",
            "glossary": [],
        }
    config = load_config()
    api_key = str(config.get("vision_api_key") or "").strip()
    if not api_key:
        return {"mode": "marks", "text": identified, "glossary": []}
    prompt = (
        "你在给完全不识谱的家长解释钢琴谱。"
        "程序已经从谱上认出了记号，下面是身份，不要改成别的记号，也不要编造没有列出的记号。"
        "你来说明每一个：看起来什么样、叫什么、什么意思、孩子要怎么弹。"
        "用短句，用中文。如果只给了英文名字，要翻译成家长能懂的话，不要只重复英文。"
        "如果写了样子或位置，例如小格子、符头下面的小圆点，这些词要留下来。\n\n"
        + identified
    )
    body = {
        "model": config["vision_model"],
        "messages": [{"role": "user", "content": prompt}],
    }
    request = urllib.request.Request(
        config["vision_base_url"].rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = payload["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, IndexError, json.JSONDecodeError, TimeoutError):
        return {"mode": "marks", "text": identified, "glossary": []}
    if not text:
        return {"mode": "marks", "text": identified, "glossary": []}
    return {"mode": "model", "text": text, "glossary": []}
