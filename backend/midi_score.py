"""Turn a MIDI file into the same grand staff used for practice.

A file with two musical parts keeps the higher part on the treble staff and the
lower part on the bass staff. A single mixed part is split at middle C.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from music21 import converter, instrument, meter, stream, tempo

from backend.notate import quarters_to_score

GRID = 0.25
MAX_BYTES = 8_000_000
MAX_MEASURES = 160


class MidiScoreError(Exception):
    pass


def score_from_midi(data: bytes, title: str):
    if len(data) < 14 or not data.startswith(b"MThd"):
        raise MidiScoreError("这不是 MIDI 文件。请选择以 .mid 结尾的文件。")
    if len(data) > MAX_BYTES:
        raise MidiScoreError("这个 MIDI 太大了。请选一首短一些的。")
    parsed = _parse(data)
    groups = _groups(parsed)
    if not groups:
        raise MidiScoreError("这个 MIDI 里没有找到音符。")
    right, left = _hands(groups)
    beats = _beats(parsed)
    right = _snap(right, beats)
    left = _snap(left, beats)
    if not right and not left:
        raise MidiScoreError("这个 MIDI 里没有找到音符。")
    longest = max((end for hand in (right, left) for _start, end, _midi in hand), default=0)
    if math_ceil_measures(longest, beats) > MAX_MEASURES:
        raise MidiScoreError("这首太长了。请选 160 个小节以内的 MIDI。")
    return quarters_to_score(right, left, title, _bpm(parsed), beats, GRID)


def math_ceil_measures(total: float, beats: int) -> int:
    if total <= 1e-6:
        return 1
    return int((total - 1e-6) // beats) + 1


def _parse(data: bytes):
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as handle:
        handle.write(data)
        path = Path(handle.name)
    try:
        try:
            parsed = converter.parse(str(path), format="midi")
        except Exception as exc:
            raise MidiScoreError("这个 MIDI 读不出来。请换一个 .mid 文件。") from exc
    finally:
        path.unlink(missing_ok=True)
    if isinstance(parsed, stream.Score):
        return parsed
    score = stream.Score()
    score.insert(0, parsed)
    return score


def _groups(parsed) -> list[list[tuple[float, float, int]]]:
    groups = []
    parts = list(parsed.parts) if list(parsed.parts) else [parsed]
    for part in parts:
        if _is_drum(part):
            continue
        items = []
        for element in part.flatten().notes:
            start = float(element.offset)
            length = float(element.quarterLength)
            pitches = element.pitches if element.isChord else [element.pitch]
            for pitch in pitches:
                midi = int(pitch.midi)
                if 21 <= midi <= 108 and length >= 0.05:
                    items.append((start, start + length, midi))
        if items:
            groups.append(items)
    return groups


def _is_drum(part) -> bool:
    for found in part.recurse().getElementsByClass(instrument.Instrument):
        if getattr(found, "midiChannel", None) == 9:
            return True
    return False


def _hands(groups: list[list[tuple[float, float, int]]]):
    if len(groups) == 2:
        medians = []
        for items in groups:
            pitches = sorted(midi for _start, _end, midi in items)
            medians.append(pitches[len(pitches) // 2])
        if medians[0] >= medians[1]:
            return groups[0], groups[1]
        return groups[1], groups[0]
    flat = [item for group in groups for item in group]
    return (
        [item for item in flat if item[2] >= 60],
        [item for item in flat if item[2] < 60],
    )


def _snap(notes: list[tuple[float, float, int]], beats: int) -> list[tuple[float, float, int]]:
    snapped = []
    cap = float(beats) * 2
    for start, end, midi in notes:
        start = max(0.0, round(start / GRID) * GRID)
        end = max(0.0, round(end / GRID) * GRID)
        if end <= start:
            end = start + GRID
        end = min(end, start + cap)
        snapped.append((start, end, midi))
    return snapped


def _beats(parsed) -> int:
    found = list(parsed.recurse().getElementsByClass(meter.TimeSignature))
    if not found:
        return 4
    signature = found[0]
    if signature.denominator == 4 and signature.numerator in (2, 3, 4):
        return int(signature.numerator)
    return 4


def _bpm(parsed) -> int:
    for mark in parsed.recurse().getElementsByClass(tempo.MetronomeMark):
        if mark.number:
            return int(min(200, max(40, round(float(mark.number)))))
    return 88
