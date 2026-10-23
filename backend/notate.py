"""Turn heard piano notes into a grand staff.

The recording has no written beat, so the time between notes becomes the beat.
Central C and everything above go on the treble staff. Lower notes go on the bass staff.
"""

from __future__ import annotations

import math
from datetime import datetime

from music21 import chord, clef, key, metadata, meter, note, stream, tempo, tie

GRID = 0.5
MEASURE = 4.0


class NotateError(Exception):
    pass


def improv_title(moment: datetime | None = None) -> str:
    when = moment or datetime.now()
    return f"即兴 {when.month}月{when.day}日 {when.hour:02d}:{when.minute:02d}"


def notes_to_score(events: list[dict], title: str) -> stream.Score:
    cleaned = _clean(events)
    if not cleaned:
        raise NotateError("没有听出钢琴的音。把电脑靠近钢琴，再弹一遍。")
    quarter = _quarter_seconds(cleaned)
    origin = min(event["onset"] for event in cleaned)
    placed = []
    for event in cleaned:
        start = _snap((event["onset"] - origin) / quarter)
        end = _snap((event["offset"] - origin) / quarter)
        if end <= start:
            end = start + GRID
        end = min(end, start + MEASURE * 2)
        placed.append((start, end, int(event["midi"])))
    total = max(end for _start, end, _midi in placed)
    measures = max(1, math.ceil((total - 1e-6) / MEASURE))
    end_limit = measures * MEASURE
    placed = [(start, min(end, end_limit), midi) for start, end, midi in placed if start < end_limit]
    if not placed:
        raise NotateError("没有听出钢琴的音。把电脑靠近钢琴，再弹一遍。")

    bpm = int(round(60 / quarter))
    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = title
    score.insert(0, _part([(start, end, midi) for start, end, midi in placed if midi >= 60], clef.TrebleClef(), "P1", "右手", end_limit, bpm))
    score.insert(0, _part([(start, end, midi) for start, end, midi in placed if midi < 60], clef.BassClef(), "P2", "左手", end_limit, None))
    return score


def _clean(events: list[dict]) -> list[dict]:
    cleaned = []
    for event in events:
        midi = int(event["midi"])
        onset = float(event["onset"])
        offset = float(event["offset"])
        if not 21 <= midi <= 108 or offset - onset < 0.06:
            continue
        velocity = event.get("velocity")
        if velocity is not None and int(velocity) < 12:
            continue
        cleaned.append({"midi": midi, "onset": onset, "offset": offset})
    cleaned.sort(key=lambda event: (event["midi"], event["onset"]))
    merged: list[dict] = []
    for event in cleaned:
        if merged and merged[-1]["midi"] == event["midi"] and event["onset"] <= merged[-1]["offset"] + 0.05:
            merged[-1]["offset"] = max(merged[-1]["offset"], event["offset"])
            continue
        merged.append(dict(event))
    return merged


def _quarter_seconds(events: list[dict]) -> float:
    """Guess the beat from the gaps between notes, and keep it in a child's tempo range."""
    onsets = sorted(event["onset"] for event in events)
    gaps = [later - earlier for earlier, later in zip(onsets, onsets[1:]) if 0.12 <= later - earlier <= 1.6]
    if not gaps:
        return 0.5
    gaps.sort()
    median = gaps[len(gaps) // 2]
    if median < 0.34:
        quarter = median * 2
    elif median > 0.85:
        quarter = median / 2
    else:
        quarter = median
    bpm = min(150.0, max(56.0, 60.0 / quarter))
    return 60.0 / bpm


def _snap(quarters: float) -> float:
    return max(0.0, round(quarters / GRID) * GRID)


def quarters_to_score(
    right: list[tuple[float, float, int]],
    left: list[tuple[float, float, int]],
    title: str,
    bpm: int,
    beats: int = 4,
    grid: float = GRID,
) -> stream.Score:
    """Build a grand staff from notes whose times are already in quarter-note lengths."""
    measure = float(beats)
    total = 0.0
    for hand in (right, left):
        if hand:
            total = max(total, max(end for _start, end, _midi in hand))
    measures = max(1, math.ceil((total - 1e-6) / measure))
    end_limit = measures * measure

    def clip(hand: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
        return [(start, min(end, end_limit), midi) for start, end, midi in hand if start < end_limit]

    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = title
    score.insert(0, _part(clip(right), clef.TrebleClef(), "P1", "右手", end_limit, bpm, grid, measure))
    score.insert(0, _part(clip(left), clef.BassClef(), "P2", "左手", end_limit, None, grid, measure))
    return score


def _part(
    notes: list[tuple[float, float, int]],
    clef_mark,
    part_id: str,
    name: str,
    end_limit: float,
    bpm: int | None,
    grid: float = GRID,
    measure_quarters: float = MEASURE,
) -> stream.Part:
    part = stream.Part(id=part_id)
    part.partName = name
    steps_per_measure = int(round(measure_quarters / grid))
    steps = int(round(end_limit / grid))
    columns = []
    for index in range(steps):
        start = index * grid
        sounding = tuple(
            sorted(
                {
                    midi
                    for note_start, note_end, midi in notes
                    if note_start <= start + 1e-6 and note_end > start + 1e-6
                }
            )
        )
        columns.append(sounding)
    buckets: list[list[tuple[float, float, tuple[int, ...], str | None]]] = [
        [] for _ in range(max(1, steps // steps_per_measure))
    ]
    index = 0
    while index < len(columns):
        end = index + 1
        while end < len(columns) and columns[end] == columns[index] and not _reattack(notes, columns[end], end * grid):
            end += 1
        cursor = index
        while cursor < end:
            measure_index = cursor // steps_per_measure
            take = min(steps_per_measure - (cursor % steps_per_measure), end - cursor)
            buckets[measure_index].append(
                (
                    (cursor % steps_per_measure) * grid,
                    take * grid,
                    columns[index],
                    _tie_kind(columns[index], cursor != index, cursor + take != end),
                )
            )
            cursor += take
        index = end
    for measure_index, items in enumerate(buckets):
        measure = stream.Measure(number=measure_index + 1)
        if measure_index == 0:
            measure.append(clef_mark)
            measure.append(key.KeySignature(0))
            measure.append(meter.TimeSignature(f"{int(measure_quarters)}/4"))
            if bpm:
                measure.insert(0, tempo.MetronomeMark(number=bpm))
        for offset, quarter_length, pitches, tie_kind in items:
            measure.insert(offset, _event(pitches, quarter_length, tie_kind))
        part.append(measure)
    return part


def _reattack(notes: list[tuple[float, float, int]], sounding: tuple[int, ...], when: float) -> bool:
    if not sounding:
        return False
    return any(abs(start - when) <= 1e-6 and midi in sounding for start, _end, midi in notes)


def _tie_kind(pitches: tuple[int, ...], from_previous: bool, to_next: bool) -> str | None:
    if not pitches or not (from_previous or to_next):
        return None
    if from_previous and to_next:
        return "continue"
    return "stop" if from_previous else "start"


def _event(pitches: tuple[int, ...], quarter_length: float, tie_kind: str | None):
    if not pitches:
        return note.Rest(quarterLength=quarter_length)
    if len(pitches) == 1:
        element = note.Note(pitches[0], quarterLength=quarter_length)
        if tie_kind:
            element.tie = tie.Tie(tie_kind)
        return element
    element = chord.Chord(list(pitches), quarterLength=quarter_length)
    if tie_kind:
        for pitch in element.pitches:
            element.setTie(tie.Tie(tie_kind), pitch)
    return element
