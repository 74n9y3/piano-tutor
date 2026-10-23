"""Join several recognized pages into one score with continuous measure numbers."""

from __future__ import annotations

import copy

from music21 import clef, key, meter, note, stream

from backend.i18n import t
from backend.i18n import t
from backend.score_ops import ScoreError


def merge_page_scores(scores: list[stream.Score]) -> tuple[stream.Score, list[tuple[int, int] | None]]:
    """Concatenate pages in order.

    A later page with fewer staves gets rests for the missing staff. A later page
    with an extra staff keeps it, and earlier pages gain rests on that staff.
    Key and time signatures that sit inside a measure stay with that measure, so a
    change on a new page still prints. Measure numbers start at 1 and run straight
    through, ignoring the numbers homr wrote on each page.
    """
    if not scores:
        raise ScoreError(t("nothing_to_merge"))
    page_parts = [_parts(score) for score in scores]
    width = max((len(parts) for parts in page_parts), default=0)
    if width == 0:
        raise ScoreError(t("no_staves"))
    merged_parts = [stream.Part(id=f"P{index + 1}") for index in range(width)]
    spans: list[tuple[int, int] | None] = []
    next_number = 1
    for parts in page_parts:
        lengths = [len(_measures(part)) for part in parts]
        page_length = max(lengths, default=0)
        if page_length == 0:
            spans.append(None)
            continue
        start = next_number
        for index, merged in enumerate(merged_parts):
            source = parts[index] if index < len(parts) else None
            measures = _measures(source) if source is not None else []
            for offset in range(page_length):
                if offset < len(measures):
                    measure = copy.deepcopy(measures[offset])
                else:
                    measure = _rest_measure(_bar_length(_reference_measure(parts, offset)))
                merged.append(measure)
                measure.number = next_number + offset
            _ensure_clef(merged, index)
        spans.append((start, next_number + page_length - 1))
        next_number += page_length
    if next_number == 1:
        raise ScoreError(t("no_measures"))
    score = stream.Score()
    for part in merged_parts:
        score.insert(0, part)
    return score, spans


def _parts(score: stream.Score) -> list[stream.Part]:
    parts = [part for part in score.parts if isinstance(part, stream.Part)]
    if parts:
        return parts
    measures = [item for item in score.getElementsByClass(stream.Measure)]
    if not measures:
        return []
    part = stream.Part()
    for measure in measures:
        part.append(copy.deepcopy(measure))
    return [part]


def _measures(part: stream.Part | None) -> list[stream.Measure]:
    if part is None:
        return []
    return [item for item in part.getElementsByClass(stream.Measure)]


def _reference_measure(parts: list[stream.Part], offset: int) -> stream.Measure | None:
    for part in parts:
        measures = _measures(part)
        if offset < len(measures):
            return measures[offset]
    return None


def _bar_length(measure: stream.Measure | None) -> float:
    if measure is None:
        return 4.0
    signature = measure.timeSignature or measure.getContextByClass(meter.TimeSignature)
    if signature is not None:
        return float(signature.barDuration.quarterLength)
    return float(measure.barDuration.quarterLength) or 4.0


def _rest_measure(quarter_length: float) -> stream.Measure:
    measure = stream.Measure()
    measure.append(note.Rest(quarterLength=quarter_length or 4.0))
    return measure


def _ensure_clef(part: stream.Part, index: int) -> None:
    measures = _measures(part)
    if not measures:
        return
    first = measures[0]
    if first.getElementsByClass(clef.Clef):
        return
    first.insert(0, clef.BassClef() if index else clef.TrebleClef())
    if not first.getElementsByClass(key.KeySignature):
        found = part.recurse().getElementsByClass(key.KeySignature)
        if found:
            first.insert(0, copy.deepcopy(found[0]))
    if not first.getElementsByClass(meter.TimeSignature):
        found = part.recurse().getElementsByClass(meter.TimeSignature)
        if found:
            first.insert(0, copy.deepcopy(found[0]))
