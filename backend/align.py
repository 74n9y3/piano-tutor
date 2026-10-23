"""Align a microphone performance with the notes on the page.

Tempo is estimated from the notes that already match, so a child who plays
the right pitches a little slowly is not marked wrong. A note is late or early
only when it breaks that performance's own pace.
"""

from __future__ import annotations

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CLUSTER_SECONDS = 0.05
OFFSET_EPSILON = 1e-3
RHYTHM_MIN_SECONDS = 0.28
RHYTHM_BEAT_RATIO = 0.55


def midi_name(midi: int) -> str:
    octave = midi // 12 - 1
    return f"{NOTE_NAMES[midi % 12]}{octave}"


def align_performance(
    heads: list[dict],
    performance: list[dict],
    start_measure: int | None = None,
    end_measure: int | None = None,
) -> dict:
    selected = [
        head
        for head in heads
        if head.get("attack", True)
        and _in_range(int(head["measure"]), start_measure, end_measure)
    ]
    selected.sort(key=lambda head: (head["offset"], head["part"], head["midi"], head["id"]))
    score_groups = _group_score(selected)
    perf_groups = _group_performance(performance)
    pairs = _needleman_wunsch(score_groups, perf_groups)

    results = {
        head["id"]: {"id": head["id"], "status": "ok", "detail": ""}
        for head in selected
    }
    extras: list[dict] = []
    pitch_ok: list[tuple[dict, float]] = []

    for kind, score_index, perf_index in pairs:
        if kind == "missing":
            for head in score_groups[score_index]["heads"]:
                results[head["id"]] = {
                    "id": head["id"],
                    "status": "missing",
                    "detail": "这一音没有听到",
                }
            continue
        if kind == "extra":
            group = perf_groups[perf_index]
            for midi in group["midis"]:
                extras.append(
                    {
                        "onset": round(group["onset"], 3),
                        "midi": midi,
                        "name": midi_name(midi),
                    }
                )
            continue
        _match_group(
            score_groups[score_index],
            perf_groups[perf_index],
            results,
            extras,
            pitch_ok,
        )

    heard_bpm = _mark_rhythm(pitch_ok, results)
    summary = {"ok": 0, "wrong_pitch": 0, "missing": 0, "rhythm": 0, "extra": len(extras)}
    for item in results.values():
        summary[item["status"]] = summary.get(item["status"], 0) + 1
    payload = {
        "notes": [results[head["id"]] for head in selected],
        "extras": extras,
        "summary": summary,
    }
    if heard_bpm is not None:
        payload["heardBpm"] = heard_bpm
    return payload


def _in_range(measure: int, start: int | None, end: int | None) -> bool:
    if start is not None and measure < start:
        return False
    if end is not None and measure > end:
        return False
    return True


def _group_score(heads: list[dict]) -> list[dict]:
    groups: list[dict] = []
    for head in heads:
        if groups and abs(head["offset"] - groups[-1]["offset"]) <= OFFSET_EPSILON:
            groups[-1]["heads"].append(head)
        else:
            groups.append({"offset": head["offset"], "heads": [head]})
    return groups


def _group_performance(notes: list[dict]) -> list[dict]:
    ordered = sorted(notes, key=lambda item: (float(item["onset"]), int(item["midi"])))
    groups: list[dict] = []
    for item in ordered:
        onset = float(item["onset"])
        midi = int(item["midi"])
        if groups and onset - groups[-1]["onset"] <= CLUSTER_SECONDS:
            groups[-1]["midis"].append(midi)
            groups[-1]["onset"] = min(groups[-1]["onset"], onset)
        else:
            groups.append({"onset": onset, "midis": [midi]})
    for group in groups:
        group["midis"] = sorted(group["midis"])
    return groups


def _similarity(expected: list[int], heard: list[int]) -> int:
    left = set(expected)
    right = set(heard)
    if left == right:
        return 3
    if left & right:
        return 1
    return -1


def _needleman_wunsch(score_groups: list[dict], perf_groups: list[dict]) -> list[tuple]:
    rows = len(score_groups)
    cols = len(perf_groups)
    scores = [[0] * (cols + 1) for _ in range(rows + 1)]
    moves = [[""] * (cols + 1) for _ in range(rows + 1)]
    for i in range(1, rows + 1):
        scores[i][0] = -i
        moves[i][0] = "up"
    for j in range(1, cols + 1):
        scores[0][j] = -j
        moves[0][j] = "left"
    for i in range(1, rows + 1):
        expected = [head["midi"] for head in score_groups[i - 1]["heads"]]
        for j in range(1, cols + 1):
            heard = perf_groups[j - 1]["midis"]
            choices = [
                (scores[i - 1][j - 1] + _similarity(expected, heard), "diag"),
                (scores[i - 1][j] - 1, "up"),
                (scores[i][j - 1] - 1, "left"),
            ]
            best_score, best_move = max(choices, key=lambda item: item[0])
            scores[i][j] = best_score
            moves[i][j] = best_move

    pairs: list[tuple] = []
    i, j = rows, cols
    while i > 0 or j > 0:
        move = moves[i][j]
        if move == "diag":
            pairs.append(("match", i - 1, j - 1))
            i -= 1
            j -= 1
        elif move == "up":
            pairs.append(("missing", i - 1, None))
            i -= 1
        elif move == "left":
            pairs.append(("extra", None, j - 1))
            j -= 1
        else:
            break
    pairs.reverse()
    return pairs


def _match_group(score_group: dict, perf_group: dict, results: dict, extras: list, pitch_ok: list) -> None:
    heard = list(perf_group["midis"])
    unmatched_heads = []
    for head in score_group["heads"]:
        if head["midi"] in heard:
            heard.remove(head["midi"])
            results[head["id"]] = {"id": head["id"], "status": "ok", "detail": ""}
            pitch_ok.append((head, perf_group["onset"]))
        else:
            unmatched_heads.append(head)
    for head in unmatched_heads:
        if heard:
            played = heard.pop(0)
            results[head["id"]] = {
                "id": head["id"],
                "status": "wrong_pitch",
                "detail": f"谱上是 {head['name']}，听到的是 {midi_name(played)}",
            }
        else:
            results[head["id"]] = {
                "id": head["id"],
                "status": "missing",
                "detail": "这一音没有听到",
            }
    for midi in heard:
        extras.append(
            {
                "onset": round(perf_group["onset"], 3),
                "midi": midi,
                "name": midi_name(midi),
            }
        )


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _mark_rhythm(pitch_ok: list[tuple[dict, float]], results: dict) -> int | None:
    """Compare each gap with this performance's own pace, not with the printed tempo."""
    points = sorted(pitch_ok, key=lambda item: (item[0]["offset"], item[0]["id"]))
    intervals = []
    for (head_a, time_a), (head_b, time_b) in zip(points, points[1:]):
        quarter_gap = head_b["offset"] - head_a["offset"]
        time_gap = time_b - time_a
        if quarter_gap > 0.2 and time_gap > 0:
            intervals.append((head_b, time_gap, quarter_gap))
    if not intervals:
        return None
    seconds_per_quarter = _median([time_gap / quarter_gap for _head, time_gap, quarter_gap in intervals])
    if seconds_per_quarter <= 0:
        return None
    tolerance = max(RHYTHM_MIN_SECONDS, RHYTHM_BEAT_RATIO * seconds_per_quarter)
    if len(intervals) >= 2:
        for head, time_gap, quarter_gap in intervals:
            if results[head["id"]]["status"] != "ok":
                continue
            if abs(time_gap - seconds_per_quarter * quarter_gap) > tolerance:
                results[head["id"]] = {
                    "id": head["id"],
                    "status": "rhythm",
                    "detail": "音高对了，但这一下明显抢了或拖了",
                }
    return int(round(60 / seconds_per_quarter))
