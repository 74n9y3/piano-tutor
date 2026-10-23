import json

from backend.vision import load_config


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setenv("PIANO_DATA", str(tmp_path))
    monkeypatch.setenv("PIANO_ENV_FILE", str(tmp_path / "app.env"))
    for name in ("PIANO_AI_API_KEY", "PIANO_AI_BASE_URL", "PIANO_AI_MODEL"):
        monkeypatch.delenv(name, raising=False)


def test_legacy_json_still_loads(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "vision_api_key": "fake-key-json",
                "vision_base_url": "https://legacy.example/v1",
                "vision_model": "legacy-model",
            }
        ),
        encoding="utf-8",
    )
    config = load_config()
    assert config["vision_api_key"] == "fake-key-json"
    assert config["vision_base_url"] == "https://legacy.example/v1"
    assert config["vision_model"] == "legacy-model"


def test_dotenv_overrides_legacy_json(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "vision_api_key": "fake-key-json",
                "vision_base_url": "https://legacy.example/v1",
                "vision_model": "legacy-model",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "app.env").write_text(
        "\n".join(
            [
                "# comment",
                "export PIANO_AI_API_KEY='fake-key-dotenv'",
                'PIANO_AI_BASE_URL="https://dotenv.example/v1"',
                "PIANO_AI_MODEL=dotenv-model",
                "",
            ]
        ),
        encoding="utf-8",
    )
    config = load_config()
    assert config["vision_api_key"] == "fake-key-dotenv"
    assert config["vision_base_url"] == "https://dotenv.example/v1"
    assert config["vision_model"] == "dotenv-model"


def test_environment_overrides_dotenv(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    (tmp_path / "app.env").write_text(
        "PIANO_AI_API_KEY=fake-key-dotenv\nPIANO_AI_MODEL=dotenv-model\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("PIANO_AI_API_KEY", "fake-key-env")
    monkeypatch.setenv("PIANO_AI_API_KEY_BLANK", "")
    monkeypatch.setenv("PIANO_AI_MODEL", "   ")
    config = load_config()
    assert config["vision_api_key"] == "fake-key-env"
    assert config["vision_model"] == "dotenv-model"


def test_missing_files_keep_defaults_and_do_not_create_json(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    config = load_config()
    assert config["vision_api_key"] == ""
    assert config["vision_base_url"] == "https://api.openai.com/v1"
    assert config["vision_model"] == "gpt-4o-mini"
    assert not (tmp_path / "config.json").exists()
