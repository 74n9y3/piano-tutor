import time

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.notate import NotateError, notes_to_score
from backend.score_ops import assign_ids, build_sample, noteheads, parse_file, remove_note, score_bpm, write_score
from backend.store import Store


def _melody():
    return [
        {"midi": 60, "onset": 0.0, "offset": 0.5},
        {"midi": 64, "onset": 0.0, "offset": 0.5},
        {"midi": 62, "onset": 0.5, "offset": 1.0},
        {"midi": 64, "onset": 1.0, "offset": 1.5},
        {"midi": 65, "onset": 1.5, "offset": 2.0},
        {"midi": 48, "onset": 0.0, "offset": 2.0},
    ]


def test_improv_becomes_grand_staff(tmp_path):
    score = notes_to_score(_melody(), "即兴测试")
    assert score_bpm(score) == 120
    path = tmp_path / "score.musicxml"
    write_score(score, path)
    loaded = parse_file(path)
    assert score_bpm(loaded) == 120
    assign_ids(loaded)
    heads = [head for head in noteheads(loaded) if head["attack"]]
    right = [head["name"] for head in heads if head["part"] == 0]
    left = [head for head in heads if head["part"] == 1]
    assert right == ["C4", "E4", "D4", "E4", "F4"]
    assert left[0]["name"] == "C3"
    assert left[0]["quarterLength"] == 4
    text = path.read_text(encoding="utf-8")
    assert text.count("即兴测试") == 1


def test_long_note_ties_across_the_bar():
    score = notes_to_score(
        [
            {"midi": 60, "onset": 0.0, "offset": 2.5},
            {"midi": 62, "onset": 3.0, "offset": 3.5},
        ],
        "连过去",
    )
    assign_ids(score)
    heads = [head for head in noteheads(score) if head["name"] == "C4"]
    assert [head["quarterLength"] for head in heads] == [4, 1]
    assert [head["attack"] for head in heads] == [True, False]
    assert heads[1]["measure"] == 2


def test_soft_and_empty_recordings_are_rejected():
    try:
        notes_to_score([{"midi": 60, "onset": 0.0, "offset": 0.5, "velocity": 4}], "太轻")
    except NotateError as exc:
        assert "没有听出" in str(exc)
    else:
        raise AssertionError("quiet notes should not become a score")
    try:
        notes_to_score([], "空的")
    except NotateError:
        return
    raise AssertionError("empty recordings should not become a score")


def test_remove_note_leaves_a_rest():
    score = build_sample()
    assign_ids(score)
    first = next(head for head in noteheads(score) if head["name"] == "C4" and head["offset"] == 0)
    edited = remove_note(score, first["id"])
    names = [head["name"] for head in noteheads(edited) if head["part"] == 0 and head["measure"] == 1]
    assert "C4" not in names
    assert "D4" in names


def test_api_improv_and_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.store.transcribe.transcribe_wav",
        lambda path, purpose="practice": _melody(),
    )
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    created = client.post("/api/pieces/improv", files={"file": ("improv.wav", b"x" * 2000, "audio/wav")})
    assert created.status_code == 200
    body = created.json()
    assert body["source"] == "improv"
    assert body["title"].startswith("即兴")
    piece = body
    for _ in range(50):
        if piece["status"] != "recognizing":
            break
        time.sleep(0.05)
        piece = client.get(f"/api/pieces/{body['id']}").json()
    assert piece["status"] == "ready"
    assert piece["bpm"] == 120
    assert any(head["name"] == "C3" for head in piece["notes"])
    target = next(head for head in piece["notes"] if head["name"] == "F4")
    deleted = client.delete(f"/api/pieces/{piece['id']}/notes/{target['id']}")
    assert deleted.status_code == 200
    assert all(head["name"] != "F4" for head in deleted.json()["notes"])
