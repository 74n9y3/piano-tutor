from music21 import chord, clef, meter, note, stream, tempo

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.store import Store


def _write_midi(path, score: stream.Score) -> bytes:
    score.write("midi", fp=str(path))
    return path.read_bytes()


def _two_hand_score() -> stream.Score:
    score = stream.Score()
    score.insert(0, tempo.MetronomeMark(number=96))
    right = stream.Part(id="P1")
    right.insert(0, clef.TrebleClef())
    right.insert(0, meter.TimeSignature("4/4"))
    for index, name in enumerate(["C4", "C4", "G4", "G4"]):
        right.insert(index, note.Note(name, quarterLength=1))
    left = stream.Part(id="P2")
    left.insert(0, clef.BassClef())
    left.insert(0, note.Note("C3", quarterLength=4))
    score.insert(0, right)
    score.insert(0, left)
    return score


def test_midi_import_keeps_both_hands_and_tempo(tmp_path):
    data = _write_midi(tmp_path / "小星星.mid", _two_hand_score())
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    created = client.post("/api/pieces/midi", files={"file": ("小星星.mid", data, "audio/midi")})
    assert created.status_code == 200
    piece = created.json()
    assert piece["title"] == "小星星"
    assert piece["source"] == "midi"
    assert piece["bpm"] == 96
    assert piece["status"] == "ready"
    right = [head["name"] for head in piece["notes"] if head["part"] == 0 and head["attack"]]
    left = [head["name"] for head in piece["notes"] if head["part"] == 1 and head["attack"]]
    assert right == ["C4", "C4", "G4", "G4"]
    assert left == ["C3"]
    text = " ".join(fact["text"] for fact in piece["explain"]["facts"])
    assert "4/4" in text


def test_single_track_midi_splits_at_middle_c(tmp_path):
    part = stream.Part()
    part.insert(0, tempo.MetronomeMark(number=80))
    part.insert(0, meter.TimeSignature("3/4"))
    part.insert(0, chord.Chord(["C4", "C3"], quarterLength=1))
    part.insert(1, note.Note("E4", quarterLength=1))
    part.insert(2, note.Note("G2", quarterLength=1))
    score = stream.Score()
    score.insert(0, part)
    data = _write_midi(tmp_path / "mixed.mid", score)
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    created = client.post("/api/pieces/midi", files={"file": ("mixed.mid", data, "audio/midi")})
    assert created.status_code == 200
    piece = created.json()
    right = [head["name"] for head in piece["notes"] if head["part"] == 0 and head["attack"]]
    left = [head["name"] for head in piece["notes"] if head["part"] == 1 and head["attack"]]
    assert right == ["C4", "E4"]
    assert left == ["C3", "G2"]
    text = " ".join(fact["text"] for fact in piece["explain"]["facts"])
    assert "3/4" in text


def test_midi_rejects_other_files(tmp_path):
    client = TestClient(create_app(Store(tmp_path / "pieces")))
    created = client.post("/api/pieces/midi", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert created.status_code == 400
    assert "MIDI" in created.json()["detail"]
