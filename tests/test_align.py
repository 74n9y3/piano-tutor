from backend.align import align_performance


def head(index: int, midi: int, offset: float, name: str, measure: int = 1) -> dict:
    return {
        "id": f"n{index}",
        "part": 0,
        "measure": measure,
        "offset": offset,
        "quarterLength": 1,
        "midi": midi,
        "name": name,
        "attack": True,
    }


SCALE = [
    head(0, 60, 0, "C4"),
    head(1, 62, 1, "D4"),
    head(2, 64, 2, "E4"),
    head(3, 65, 3, "F4"),
]


def statuses(result) -> dict:
    return {item["id"]: item["status"] for item in result["notes"]}


def test_missing_note_and_wrong_pitch():
    performance = [
        {"midi": 60, "onset": 0.0},
        {"midi": 62, "onset": 0.5},
        {"midi": 66, "onset": 1.6},
    ]
    result = align_performance(SCALE, performance)
    assert statuses(result) == {
        "n0": "ok",
        "n1": "ok",
        "n2": "missing",
        "n3": "wrong_pitch",
    }
    assert "F♯" in result["notes"][3]["detail"] or "F#" in result["notes"][3]["detail"]


def test_even_slow_playing_is_not_a_rhythm_error():
    performance = [
        {"midi": 60, "onset": 0.0},
        {"midi": 62, "onset": 0.9},
        {"midi": 64, "onset": 1.8},
        {"midi": 65, "onset": 2.7},
    ]
    result = align_performance(SCALE, performance)
    assert set(statuses(result).values()) == {"ok"}
    assert result["heardBpm"] == 67


def test_rushed_note_is_marked():
    performance = [
        {"midi": 60, "onset": 0.0},
        {"midi": 62, "onset": 0.5},
        {"midi": 64, "onset": 0.55},
        {"midi": 65, "onset": 1.5},
    ]
    result = align_performance(SCALE, performance)
    assert statuses(result)["n2"] == "rhythm"


def test_extra_note():
    performance = [
        {"midi": 60, "onset": 0.0},
        {"midi": 64, "onset": 0.4},
        {"midi": 62, "onset": 0.8},
        {"midi": 64, "onset": 1.6},
        {"midi": 65, "onset": 2.4},
    ]
    result = align_performance(SCALE, performance)
    assert result["summary"]["extra"] >= 1
    assert statuses(result)["n0"] == "ok"
    assert statuses(result)["n3"] == "ok"


def test_measure_range_limits_what_is_checked():
    heads = SCALE + [head(4, 67, 4, "G4", measure=2)]
    performance = [{"midi": 67, "onset": 0.2}]
    result = align_performance(heads, performance, start_measure=2, end_measure=2)
    assert [item["id"] for item in result["notes"]] == ["n4"]
    assert statuses(result)["n4"] == "ok"
