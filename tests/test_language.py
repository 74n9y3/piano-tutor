import json
import re

from fastapi.testclient import TestClient

from backend.i18n import set_lang
from backend.store import Store
from backend.vision import explain_marks


def test_english_prompt_asks_for_english(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"choices": [{"message": {"content": "This is a treble clef."}}]}).encode()

    def fake_urlopen(request, timeout=60):
        captured["body"] = json.loads(request.data.decode())
        return Response()

    monkeypatch.setattr("backend.vision.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr(
        "backend.vision.load_config",
        lambda: {
            "vision_api_key": "fake-key",
            "vision_base_url": "https://example.invalid/v1",
            "vision_model": "test-model",
        },
    )
    set_lang("en")
    try:
        result = explain_marks([{"kind": "clef", "clef": "treble", "hand": "right"}])
    finally:
        set_lang("zh")
    messages = captured["body"]["messages"]
    system = messages[0]
    user = messages[1]
    assert system["role"] == "system"
    assert "English" in system["content"]
    assert "only in English" in system["content"]
    assert not re.search(r"[\u4e00-\u9fff]", system["content"])
    assert not re.search(r"[\u4e00-\u9fff]", user["content"])
    assert "treble clef" in user["content"].lower()
    assert result["mode"] == "model"


def test_english_without_key_uses_builtin_explanation(monkeypatch):
    monkeypatch.setattr(
        "backend.vision.load_config",
        lambda: {"vision_api_key": "", "vision_base_url": "https://example.invalid/v1", "vision_model": "test"},
    )
    set_lang("en")
    try:
        result = explain_marks([{"kind": "clef", "clef": "treble", "hand": "right"}])
    finally:
        set_lang("zh")
    assert result["mode"] == "marks"
    assert "Treble clef" in result["text"]
    assert not re.search(r"[\u4e00-\u9fff]", result["text"])


def test_rename_error_follows_language(tmp_path, monkeypatch):
    monkeypatch.setenv("PIANO_DATA", str(tmp_path))
    client = TestClient(__import__("backend.main", fromlist=["create_app"]).create_app(Store(tmp_path / "pieces")))
    created = client.post("/api/pieces/sample")
    piece_id = created.json()["id"]
    chinese = client.patch(f"/api/pieces/{piece_id}", json={"title": " "})
    english = client.patch(
        f"/api/pieces/{piece_id}",
        json={"title": " "},
        headers={"X-Lang": "en"},
    )
    assert chinese.status_code == 400
    assert "曲名" in chinese.json()["detail"]
    assert english.status_code == 400
    assert "title" in english.json()["detail"].lower()
    assert not re.search(r"[\u4e00-\u9fff]", english.json()["detail"])
