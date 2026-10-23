import io
import json
import time

from fastapi.testclient import TestClient
from PIL import Image

from backend.explain import describe_marks
from backend.main import create_app
from backend.score_ops import assign_ids, build_sample, edit_note, noteheads, write_score
from backend.store import Store


def test_sample_note_order_and_edit(tmp_path):
    score = build_sample()
    assign_ids(score)
    heads = noteheads(score)
    assert heads[0]["name"] == "C4"
    assert heads[0]["midi"] == 60
    assert any(head["name"] == "C3" and head["offset"] == 0 for head in heads)
    assert score_bpm_is_72(score)

    edited = edit_note(score, heads[0]["id"], semitone=1)
    changed = noteheads(edited)
    assert changed[0]["name"] == "C♯4"
    assert changed[0]["midi"] == 61

    edited = edit_note(edited, changed[0]["id"], duration="half")
    changed = noteheads(edited)
    first = next(head for head in changed if head["part"] == 0 and head["offset"] == 0)
    assert first["quarterLength"] == 2
    assert first["measure"] == 1
    right_hand = [head for head in changed if head["part"] == 0 and head["measure"] == 1]
    assert len(right_hand) == 3


def score_bpm_is_72(score) -> bool:
    from backend.score_ops import score_bpm

    return score_bpm(score) == 72


def test_roundtrip_keeps_title(tmp_path):
    score = build_sample()
    assign_ids(score)
    path = tmp_path / "score.musicxml"
    write_score(score, path)
    from backend.score_ops import parse_file, score_title

    xml_text = path.read_text(encoding="utf-8")
    assert xml_text.count("双手五指练习") == 1
    loaded = parse_file(path)
    assert score_title(loaded) == "双手五指练习"
    assign_ids(loaded)
    assert noteheads(loaded)[0]["name"] == "C4"


def test_api_sample_explain_and_edit(tmp_path, monkeypatch):
    monkeypatch.setenv("PIANO_DATA", str(tmp_path))
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    created = client.post("/api/pieces/sample")
    assert created.status_code == 200
    piece = created.json()
    assert piece["title"] == "双手五指练习"
    assert piece["bpm"] == 72
    text = " ".join(fact["text"] for fact in piece["explain"]["facts"])
    assert "高音谱号" in text
    assert "低音谱号" in text
    assert text.count("4/4") == 1
    assert "没有升降号" in text

    xml = client.get(f"/api/pieces/{piece['id']}/score")
    assert xml.status_code == 200
    assert b"<step>C</step>" in xml.content and b"<octave>4</octave>" in xml.content

    first = next(note for note in piece["notes"] if note["name"] == "C4" and note["offset"] == 0)
    edited = client.patch(
        f"/api/pieces/{piece['id']}/notes/{first['id']}",
        json={"semitone": 1},
    )
    assert edited.status_code == 200
    assert edited.json()["notes"][0]["name"] == "C♯4"

    renamed = client.patch(f"/api/pieces/{piece['id']}", json={"title": "  小星星  "})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "小星星"
    renamed_xml = client.get(f"/api/pieces/{piece['id']}/score").text
    assert renamed_xml.count("小星星") == 1
    assert "双手五指练习" not in renamed_xml
    blank = client.patch(f"/api/pieces/{piece['id']}", json={"title": "   "})
    assert blank.status_code == 400

    saved = client.post(
        f"/api/pieces/{piece['id']}/asks",
        json={"label": "第1小节 右手 C4", "text": "这是中央 C，弹 1 拍。", "noteId": "n0"},
    )
    assert saved.status_code == 200
    history = client.get(f"/api/pieces/{piece['id']}/asks")
    assert history.status_code == 200
    assert history.json()[0]["label"] == "第1小节 右手 C4"
    assert history.json()[0]["text"] == "这是中央 C，弹 1 拍。"
    assert history.json()[0]["noteId"] == "n0"

    monkeypatch.setattr(
        "backend.vision.load_config",
        lambda: {"vision_api_key": "", "vision_base_url": "https://example.invalid/v1", "vision_model": "none"},
    )
    region = client.post(
        f"/api/pieces/{piece['id']}/explain/marks",
        json={
            "marks": [
                {"kind": "clef", "clef": "treble", "hand": "right", "measure": 1},
                {"kind": "time", "time": "4/4"},
                {"kind": "note", "name": "C4", "duration": "quarter", "measure": 1, "hand": "right"},
            ]
        },
    )
    assert region.status_code == 200
    body = region.json()
    assert body["mode"] == "marks"
    assert "高音谱号" in body["text"]
    assert "4/4" in body["text"]
    assert "中央 C" in body["text"]
    assert "右手" in body["text"]

    listed = client.get("/api/pieces")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == piece["id"]
    assert listed.json()[0]["title"] == "小星星"
    removed = client.delete(f"/api/pieces/{piece['id']}")
    assert removed.status_code == 200
    assert client.get("/api/pieces").json() == []


def test_photo_job_and_take(tmp_path, monkeypatch):
    monkeypatch.setenv("PIANO_DATA", str(tmp_path))
    store = Store(tmp_path / "pieces")
    client = TestClient(create_app(store))

    def fake_recognize(image_path, dest_xml):
        score = build_sample()
        assign_ids(score)
        write_score(score, dest_xml)

    monkeypatch.setattr("backend.omr.recognize", fake_recognize)
    monkeypatch.setattr("backend.store.omr.recognize", fake_recognize)

    buffer = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(buffer, "PNG")
    created = client.post(
        "/api/pieces/photo",
        files={"file": ("page.png", buffer.getvalue(), "image/png")},
    )
    assert created.status_code == 200
    piece_id = created.json()["id"]
    deadline = time.time() + 5
    piece = None
    while time.time() < deadline:
        piece = client.get(f"/api/pieces/{piece_id}").json()
        if piece["status"] == "ready":
            break
        time.sleep(0.05)
    assert piece["status"] == "ready"
    assert piece["hasPhoto"] is True
    photo = client.get(f"/api/pieces/{piece_id}/photo")
    assert photo.status_code == 200

    monkeypatch.setattr(
        "backend.transcribe.transcribe_wav",
        lambda path: [
            {"midi": 60, "onset": 0.0, "offset": 0.4},
            {"midi": 62, "onset": 0.5, "offset": 0.9},
            {"midi": 64, "onset": 1.0, "offset": 1.4},
            {"midi": 65, "onset": 1.5, "offset": 1.9},
        ],
    )
    take = client.post(
        f"/api/pieces/{piece_id}/takes",
        files={"file": ("take.wav", b"R" * 2000, "audio/wav")},
        data={"start_measure": 1, "end_measure": 1},
    )
    assert take.status_code == 200
    take_id = take.json()["id"]
    deadline = time.time() + 5
    record = None
    while time.time() < deadline:
        record = client.get(f"/api/pieces/{piece_id}/takes/{take_id}").json()
        if record["status"] != "analyzing":
            break
        time.sleep(0.05)
    assert record["status"] == "ready"
    assert record["result"]["summary"]["ok"] >= 1

    deleted = client.delete(f"/api/pieces/{piece_id}")
    assert deleted.status_code == 200


def test_bad_musicxml(tmp_path):
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    response = client.post(
        "/api/pieces/musicxml",
        files={"file": ("nope.xml", b"not music", "application/xml")},
    )
    assert response.status_code == 400
    assert "乐谱" in response.json()["detail"]


def test_augmentation_dot_means_hold_half_again():
    text = describe_marks(
        [
            {
                "kind": "dot",
                "name": "C4",
                "duration": "quarter",
                "dots": 1,
                "quarters": 1.5,
                "measure": 1,
                "hand": "right",
            }
        ]
    )
    assert "附点" in text
    assert "不是跳音" in text
    assert "1 拍半" in text
    assert "中央 C" in text

    inferred = describe_marks(
        [{"kind": "note", "name": "D4", "duration": "other", "dots": 1, "quarters": 1.5, "measure": 2, "hand": "left"}]
    )
    assert "附点" in inferred
    assert "1 拍半" in inferred
    assert "左手" in inferred


def test_printed_sharp_is_the_little_grid_on_the_left():
    text = describe_marks(
        [
            {
                "kind": "note",
                "name": "F♯4",
                "duration": "quarter",
                "accidental": "sharp",
                "measure": 1,
                "hand": "right",
            }
        ]
    )
    assert "小格子" in text
    assert "升号" in text
    assert "黑键" in text
    assert text.index("小格子") < text.index("四分音符")

    key_signature_only = describe_marks(
        [{"kind": "note", "name": "F♯4", "duration": "quarter", "measure": 1, "hand": "right"}]
    )
    assert "小格子" not in key_signature_only
    assert "升号" in key_signature_only


def test_dot_under_the_note_is_staccato():
    text = describe_marks(
        [
            {
                "kind": "note",
                "name": "C4",
                "duration": "quarter",
                "articulation": "staccato",
                "measure": 1,
                "hand": "right",
            }
        ]
    )
    assert "跳音" in text
    assert "点一下就松开" in text
    assert text.index("跳音") < text.index("四分音符")

    plain = describe_marks([{"kind": "note", "name": "C4", "duration": "quarter", "measure": 1, "hand": "right"}])
    assert "跳音" not in plain

    accent = describe_marks(
        [{"kind": "note", "name": "D4", "duration": "quarter", "symbols": [{"code": "accent", "detail": "above"}], "measure": 1}]
    )
    assert "重音" in accent
    unknown = describe_marks([{"kind": "symbol", "symbols": [{"code": "scoop"}]}])
    assert "scoop" in unknown
    assert "怎么弹" in unknown


def test_model_explains_a_mark_without_a_handwritten_lesson(monkeypatch):
    monkeypatch.setattr(
        "backend.vision.load_config",
        lambda: {"vision_api_key": "test-key", "vision_base_url": "https://example.invalid/v1", "vision_model": "test"},
    )

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"choices": [{"message": {"content": "这是滑音。手指从旁边滑到这个音。"}}]}).encode()

    monkeypatch.setattr("backend.vision.urllib.request.urlopen", lambda *args, **kwargs: Reply())
    from backend.vision import explain_marks

    result = explain_marks([{"kind": "symbol", "symbols": [{"code": "scoop"}]}])
    assert result["mode"] == "model"
    assert "滑音" in result["text"]


def test_reveal_opens_only_that_piece_folder(tmp_path, monkeypatch):
    store = Store(tmp_path / "pieces")
    client = TestClient(create_app(store))
    piece = client.post("/api/pieces/sample").json()
    opened: dict[str, list[str]] = {}

    def fake_run(args, check):
        opened["args"] = args
        assert check is True

    monkeypatch.setattr("backend.store.subprocess.run", fake_run)
    response = client.post(f"/api/pieces/{piece['id']}/folder")
    assert response.status_code == 200
    assert opened["args"] == ["open", str((tmp_path / "pieces" / piece["id"]).resolve())]
    assert client.post("/api/pieces/not-a-hex-id/folder").status_code == 404
