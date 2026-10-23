from __future__ import annotations

import copy
import re
from pathlib import Path

from music21 import chord, clef, converter, key, metadata, meter, note, stream, tempo

from backend.i18n import t

from backend.i18n import t

DURATION_QUARTERS = {
    "whole": 4.0,
    "half": 2.0,
    "quarter": 1.0,
    "eighth": 0.5,
}
OUR_ID = re.compile(r"n\d+")


class ScoreError(Exception):
    pass


def build_sample() -> stream.Score:
    """A short original two-hand exercise in C major."""
    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = t("sample_title")
    score.insert(0, tempo.MetronomeMark(number=72))

    right = stream.Part(id="P1")
    right.partName = t("right_hand")
    measure = stream.Measure(number=1)
    measure.append(clef.TrebleClef())
    measure.append(key.KeySignature(0))
    measure.append(meter.TimeSignature("4/4"))
    for name in ("C4", "D4", "E4", "F4"):
        measure.append(note.Note(name, quarterLength=1))
    right.append(measure)
    measure = stream.Measure(number=2)
    measure.append(note.Note("G4", quarterLength=2))
    measure.append(note.Note("E4", quarterLength=1))
    measure.append(note.Note("C4", quarterLength=1))
    right.append(measure)

    left = stream.Part(id="P2")
    left.partName = t("left_hand")
    measure = stream.Measure(number=1)
    measure.append(clef.BassClef())
    measure.append(key.KeySignature(0))
    measure.append(meter.TimeSignature("4/4"))
    measure.append(note.Note("C3", quarterLength=4))
    left.append(measure)
    measure = stream.Measure(number=2)
    measure.append(note.Note("G2", quarterLength=2))
    measure.append(note.Note("C3", quarterLength=2))
    left.append(measure)

    score.insert(0, right)
    score.insert(0, left)
    return score


def as_score(parsed) -> stream.Score:
    if isinstance(parsed, stream.Score):
        return parsed
    if isinstance(parsed, stream.Opus) and parsed.scores:
        return parsed.scores[0]
    score = stream.Score()
    score.insert(0, parsed)
    return score


def parse_file(path: Path) -> stream.Score:
    try:
        parsed = converter.parse(str(path))
    except Exception as exc:
        raise ScoreError(t("not_a_score")) from exc
    score = as_score(parsed)
    if not list(score.parts) and not list(score.recurse().notes):
        raise ScoreError(t("no_notes_in_score"))
    return score


def parse_bytes(data: bytes) -> stream.Score:
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False) as handle:
        handle.write(data)
        path = Path(handle.name)
    try:
        return parse_file(path)
    finally:
        path.unlink(missing_ok=True)


_FILENAME_TITLE = re.compile(r"^[^/\\<>]+\.(?:musicxml|xml|mid|midi)$", re.IGNORECASE)


def _looks_like_filename(value: str) -> bool:
    return bool(_FILENAME_TITLE.match(value.strip()))


def write_score(score: stream.Score, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    _clear_filename_movement(score)
    score.write("musicxml", fp=str(path))
    _drop_duplicate_movement_title(path)


def _clear_filename_movement(score: stream.Score) -> None:
    """music21 uses the source filename as movementName when a file has no title."""
    block = score.metadata
    if block is None:
        return
    name = block.movementName
    if name and _looks_like_filename(str(name)):
        block.movementName = None


def _drop_duplicate_movement_title(path: Path) -> None:
    """Drop a movement title that repeats the work title or is only a filename.

    music21 copies the work title into movement-title, and OSMD draws that second
    line under the title. A filename such as score.musicxml is the same kind of
    extra line when the real title lives in work-title.
    """
    text = path.read_text(encoding="utf-8")
    work = re.search(r"<work-title>([^<]*)</work-title>", text)
    movement = re.search(r"<movement-title>([^<]*)</movement-title>", text)
    if movement is None:
        return
    movement_text = movement.group(1).strip()
    same_as_work = work is not None and work.group(1).strip() == movement_text
    if not same_as_work and not _looks_like_filename(movement_text):
        return
    path.write_text(re.sub(r"\s*<movement-title>[^<]*</movement-title>", "", text, count=1), encoding="utf-8")


def rename_title(score: stream.Score, title: str) -> stream.Score:
    cleaned = " ".join(title.split())
    if not cleaned:
        raise ScoreError(t("title_empty"))
    if len(cleaned) > 40:
        raise ScoreError(t("title_too_long"))
    if score.metadata is None:
        score.metadata = metadata.Metadata()
    score.metadata.title = cleaned
    score.metadata.movementName = cleaned
    return score


def score_title(score: stream.Score, fallback: str | None = None) -> str:
    if not fallback:
        fallback = t("untitled")
    metadata_block = score.metadata
    if metadata_block is not None:
        for value in (metadata_block.title, metadata_block.movementName, metadata_block.bestTitle):
            if not value:
                continue
            title = str(value).strip()
            if title and title.lower() != "music21" and not _looks_like_filename(title):
                return title
    return fallback


def score_bpm(score: stream.Score) -> int:
    for mark in score.recurse().getElementsByClass(tempo.MetronomeMark):
        if mark.number:
            return int(round(float(mark.number)))
    return 72


def assign_ids(score: stream.Score) -> None:
    number = 0
    for element in _pitched_elements(score):
        element.id = f"n{number}"
        number += 1


def noteheads(score: stream.Score) -> list[dict]:
    heads: list[dict] = []
    for part_index, part in enumerate(score.parts):
        for element in part.recurse().notes:
            if _is_grace(element):
                continue
            offset = round(float(element.getOffsetInHierarchy(score)), 4)
            quarter_length = round(float(element.quarterLength), 4)
            measure = int(element.measureNumber or 1)
            if isinstance(element, chord.Chord):
                for chord_index, pitch in enumerate(element.pitches):
                    tie = element.getTie(pitch) if hasattr(element, "getTie") else None
                    heads.append(
                        _head(
                            f"{element.id}:c{chord_index}",
                            part_index,
                            measure,
                            offset,
                            quarter_length,
                            pitch,
                            tie,
                        )
                    )
            elif isinstance(element, note.Note):
                heads.append(
                    _head(
                        str(element.id),
                        part_index,
                        measure,
                        offset,
                        quarter_length,
                        element.pitch,
                        element.tie,
                    )
                )
    heads.sort(key=lambda head: (head["offset"], head["part"], head["midi"], head["id"]))
    return heads


def edit_note(
    score: stream.Score,
    note_id: str,
    semitone: int | None = None,
    duration: str | None = None,
) -> stream.Score:
    base_id, chord_index = _split_id(note_id)
    found = None
    for element in _pitched_elements(score):
        if str(element.id) == base_id:
            found = element
            break
    if found is None:
        raise ScoreError(t("note_missing"))
    if semitone:
        _shift_pitch(found, chord_index, semitone)
    if duration:
        if duration not in DURATION_QUARTERS:
            raise ScoreError(t("bad_duration"))
        found.duration.quarterLength = DURATION_QUARTERS[duration]
        score = _rebar(score)
    assign_ids(score)
    return score


def remove_note(score: stream.Score, note_id: str) -> stream.Score:
    base_id, chord_index = _split_id(note_id)
    found = None
    for element in _pitched_elements(score):
        if str(element.id) == base_id:
            found = element
            break
    if found is None or found.activeSite is None:
        raise ScoreError(t("note_missing"))
    site = found.activeSite
    offset = found.offset
    quarter_length = float(found.quarterLength)
    if isinstance(found, chord.Chord) and chord_index is not None:
        remaining = [pitch.nameWithOctave for index, pitch in enumerate(found.pitches) if index != chord_index]
        if len(remaining) > 1:
            replacement = chord.Chord(remaining, quarterLength=quarter_length)
        elif len(remaining) == 1:
            replacement = note.Note(remaining[0], quarterLength=quarter_length)
        else:
            replacement = note.Rest(quarterLength=quarter_length)
    else:
        replacement = note.Rest(quarterLength=quarter_length)
    site.remove(found)
    site.insert(offset, replacement)
    assign_ids(score)
    return score


def measure_span(heads: list[dict]) -> tuple[int, int]:
    if not heads:
        return (1, 1)
    measures = [int(head["measure"]) for head in heads]
    return min(measures), max(measures)


def _head(note_id, part, measure, offset, quarter_length, pitch, tie) -> dict:
    kind = _duration_kind(quarter_length)
    return {
        "id": note_id,
        "part": part,
        "measure": measure,
        "offset": offset,
        "quarterLength": quarter_length,
        "duration": kind,
        "midi": int(pitch.midi),
        "name": _pretty_name(pitch),
        "attack": not _tie_continues(tie),
    }


def _pretty_name(pitch) -> str:
    return pitch.nameWithOctave.replace("-", "♭").replace("#", "♯")


def _duration_kind(quarter_length: float) -> str:
    for name, quarters in DURATION_QUARTERS.items():
        if abs(quarter_length - quarters) < 1e-3:
            return name
    return "other"


def _tie_continues(tie) -> bool:
    return tie is not None and getattr(tie, "type", None) in {"stop", "continue"}


def _is_grace(element) -> bool:
    duration = getattr(element, "duration", None)
    return bool(duration is not None and duration.isGrace)


def _pitched_elements(score: stream.Score):
    for part in score.parts:
        for element in part.recurse().notes:
            if not _is_grace(element):
                yield element


def _split_id(note_id: str) -> tuple[str, int | None]:
    if not re.fullmatch(r"n\d+(:c\d+)?", note_id):
        raise ScoreError(t("note_missing"))
    if ":c" not in note_id:
        return note_id, None
    base, index = note_id.split(":c")
    return base, int(index)


def _shift_pitch(element, chord_index: int | None, semitone: int) -> None:
    if isinstance(element, chord.Chord):
        if chord_index is None or chord_index >= len(element.pitches):
            raise ScoreError(t("note_missing"))
        element.pitches[chord_index].midi = int(element.pitches[chord_index].midi) + semitone
        return
    if not isinstance(element, note.Note):
        raise ScoreError(t("pitch_locked"))
    element.pitch.midi = int(element.pitch.midi) + semitone


def _rebar(score: stream.Score) -> stream.Score:
    rebuilt = stream.Score()
    if score.metadata is not None:
        rebuilt.metadata = copy.deepcopy(score.metadata)
    for mark in score.recurse().getElementsByClass(tempo.MetronomeMark):
        if mark.number:
            rebuilt.insert(0, tempo.MetronomeMark(number=float(mark.number)))
            break
    for part in score.parts:
        rebuilt.insert(0, _rebuild_part(part))
    return rebuilt


def _rebuild_part(part: stream.Part) -> stream.Part:
    fresh = stream.Part(id=part.id)
    if part.partName:
        fresh.partName = part.partName
    clefs = list(part.recurse().getElementsByClass(clef.Clef))
    keys = list(part.recurse().getElementsByClass(key.KeySignature))
    times = list(part.recurse().getElementsByClass(meter.TimeSignature))
    if clefs:
        fresh.insert(0, copy.deepcopy(clefs[0]))
    if keys:
        fresh.insert(0, copy.deepcopy(keys[0]))
    fresh.insert(0, copy.deepcopy(times[0]) if times else meter.TimeSignature("4/4"))

    groups = _groups_in_part(part)
    cursor = 0.0
    for elements in groups:
        for element in elements:
            fresh.insert(cursor, _clone_event(element))
        cursor += max(float(element.quarterLength) for element in elements)
    fresh.makeMeasures(inPlace=True)
    return fresh


def _groups_in_part(part: stream.Part) -> list[list]:
    items = [element for element in part.recurse().notesAndRests if not _is_grace(element)]
    items.sort(key=lambda element: (round(float(element.getOffsetInHierarchy(part)), 4), element.classSortOrder))
    groups: list[list] = []
    for element in items:
        offset = round(float(element.getOffsetInHierarchy(part)), 4)
        if groups and abs(offset - groups[-1][0]) <= 1e-3:
            groups[-1][1].append(element)
        else:
            groups.append([offset, [element]])
    return [elements for _offset, elements in groups]


def _clone_event(element):
    quarter_length = float(element.quarterLength)
    if isinstance(element, note.Rest):
        cloned = note.Rest(quarterLength=quarter_length)
    elif isinstance(element, chord.Chord):
        cloned = chord.Chord([pitch.nameWithOctave for pitch in element.pitches], quarterLength=quarter_length)
    elif isinstance(element, note.Note):
        cloned = note.Note(element.pitch.nameWithOctave, quarterLength=quarter_length)
    else:
        cloned = copy.deepcopy(element)
    if OUR_ID.fullmatch(str(element.id)):
        cloned.id = str(element.id)
    return cloned
