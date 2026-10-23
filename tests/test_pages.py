import io
import time

from music21 import clef, key, meter, note, stream
from PIL import Image
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.omr import OmrError
from backend.pages import merge_page_scores
from backend.score_ops import assign_ids, noteheads, write_score
from backend.store import Store


def _bar(pitch_name: str, sharps: int = 0) -> stream.Score:
    score = stream.Score()
    right = stream.Part(id="P1")
    measure = stream.Measure(number=1)
    measure.append(clef.TrebleClef())
    measure.append(key.KeySignature(sharps))
    measure.append(meter.TimeSignature("4/4"))
    measure.append(note.Note(pitch_name, quarterLength=4))
    right.append(measure)
    left = stream.Part(id="P2")
    bass = stream.Measure(number=1)
    bass.append(clef.BassClef())
    bass.append(key.KeySignature(sharps))
    bass.append(meter.TimeSignature("4/4"))
    bass.append(note.Note("C3", quarterLength=4))
    left.append(bass)
    score.insert(0, right)
    score.insert(0, left)
    return score


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 16), "white").save(buffer, "PNG")
    return buffer.getvalue()


def test_merge_keeps_order_and_continuous_measures():
    first, spans = merge_page_scores([_bar("C4"), _bar("G4", sharps=-1)])
    assert spans == [(1, 1), (2, 2)]
    heads = noteheads(first)
    treble = [head for head in heads if head["part"] == 0]
    assert [head["name"] for head in treble] == ["C4", "G4"]
    assert [head["measure"] for head in treble] == [1, 2]
    second_measure = list(first.parts)[0].measure(2)
    signatures = list(second_measure.getElementsByClass(key.KeySignature))
    assert signatures and signatures[0].sharps == -1


def test_merge_page_order_changes_the_music():
    forward, _ = merge_page_scores([_bar("C4"), _bar("G4")])
    backward, _ = merge_page_scores([_bar("G4"), _bar("C4")])
    forward_names = [head["name"] for head in noteheads(forward) if head["part"] == 0]
    backward_names = [head["name"] for head in noteheads(backward) if head["part"] == 0]
    assert forward_names == ["C4", "G4"]
    assert backward_names == ["G4", "C4"]


def test_merge_pads_a_page_with_fewer_staves():
    full = _bar("E4")
    solo = stream.Score()
    part = stream.Part(id="P1")
    measure = stream.Measure(number=1)
    measure.append(clef.TrebleClef())
    measure.append(meter.TimeSignature("4/4"))
    measure.append(note.Note("A4", quarterLength=4))
    part.append(measure)
    solo.insert(0, part)
    merged, spans = merge_page_scores([full, solo])
    assert spans == [(1, 1), (2, 2)]
    assert len(list(merged.parts)) == 2
    bass = [head for head in noteheads(merged) if head["part"] == 1]
    assert [head["measure"] for head in bass] == [1]
    assert list(merged.parts)[1].measure(2).recurse().getElementsByClass(note.Rest)


def test_partial_failure_keeps_the_successful_page(tmp_path, monkeypatch):
    store = Store(tmp_path / "pieces")
    client = TestClient(create_app(store))

    def fake_recognize(image_path, dest_xml):
        if image_path.name == "002.png":
            raise OmrError("第二页糊了")
        score = _bar("D4")
        assign_ids(score)
        write_score(score, dest_xml)

    monkeypatch.setattr("backend.store.omr.recognize", fake_recognize)
    created = client.post(
        "/api/pieces/photo",
        data={"title": "两页测试"},
        files=[
            ("files", ("a.png", _png(), "image/png")),
            ("files", ("b.png", _png(), "image/png")),
        ],
    )
    assert created.status_code == 200
    piece_id = created.json()["id"]
    piece = _wait(client, piece_id)
    assert piece["status"] == "partial"
    assert "第 2 页" in piece["error"]
    assert piece["pageCount"] == 2
    assert [page["status"] for page in piece["pages"]] == ["ready", "failed"]
    assert piece["pages"][0]["measureStart"] == 1
    assert piece["notes"]
    assert client.get(f"/api/pieces/{piece_id}/photo", params={"page": 2}).status_code == 200
    client.delete(f"/api/pieces/{piece_id}")


def test_legacy_single_photo_still_opens(tmp_path):
    store = Store(tmp_path / "pieces")
    piece_id = "abc123abc123"
    folder = tmp_path / "pieces" / piece_id
    folder.mkdir(parents=True)
    (folder / "photo.png").write_bytes(_png())
    (folder / "meta.json").write_text(
        '{"id":"abc123abc123","title":"旧谱","status":"ready","error":null,"created":"2020-01-01T00:00:00+00:00","hasPhoto":true}',
        encoding="utf-8",
    )
    client = TestClient(create_app(store))
    listed = client.get("/api/pieces").json()
    assert listed[0]["pageCount"] == 1
    assert listed[0]["pages"][0]["index"] == 1
    photo = client.get(f"/api/pieces/{piece_id}/photo")
    assert photo.status_code == 200
    assert (folder / "photo.png").exists()


def _wait(client: TestClient, piece_id: str) -> dict:
    deadline = time.time() + 5
    piece = None
    while time.time() < deadline:
        piece = client.get(f"/api/pieces/{piece_id}").json()
        if piece["status"] != "recognizing":
            return piece
        time.sleep(0.05)
    raise AssertionError(piece)
