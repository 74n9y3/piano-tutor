"""English built-in explanations. Used when the interface language is English."""

from __future__ import annotations

import re

from music21 import articulations, clef, dynamics, expressions, key, meter, tempo

MAJOR_SHARP = {
    0: "C major",
    1: "G major",
    2: "D major",
    3: "A major",
    4: "E major",
    5: "B major",
    6: "F-sharp major",
    7: "C-sharp major",
}
MAJOR_FLAT = {
    1: "F major",
    2: "B-flat major",
    3: "E-flat major",
    4: "A-flat major",
    5: "D-flat major",
    6: "G-flat major",
    7: "C-flat major",
}
SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"]
BEAT_NAMES = {1: "whole note", 2: "half note", 4: "quarter note", 8: "eighth note", 16: "sixteenth note"}
NOTE_VALUES = (
    (4.0, "Whole note", "hold for 4 beats"),
    (3.0, "Dotted half note", "hold for 3 beats"),
    (2.0, "Half note", "hold for 2 beats"),
    (1.5, "Dotted quarter note", "hold for 1 and a half beats"),
    (1.0, "Quarter note", "hold for 1 beat"),
    (0.75, "Dotted eighth note", "a little longer than half a beat"),
    (0.5, "Eighth note", "half a beat"),
    (0.25, "Sixteenth note", "a quarter of a beat"),
)
DYNAMIC_TEXT = {
    "ppp": "very, very soft",
    "pp": "very soft",
    "p": "soft",
    "mp": "medium soft, a little louder than soft",
    "mf": "medium loud, clear but not forced",
    "f": "loud",
    "ff": "very loud",
    "fff": "very, very loud",
    "fp": "loud, then immediately soft",
    "sfz": "suddenly stronger on this note",
    "sf": "suddenly stronger on this note",
}
WORD_TEXT = {
    "rit.": "gradually slower",
    "rit": "gradually slower",
    "ritard.": "gradually slower",
    "ritardando": "gradually slower",
    "rall.": "gradually slower",
    "accel.": "gradually faster",
    "accelerando": "gradually faster",
    "a tempo": "back to the first tempo",
    "tempo i": "back to the first tempo",
    "legato": "smooth and connected",
    "staccato": "short and detached",
    "cresc.": "gradually louder",
    "crescendo": "gradually louder",
    "dim.": "gradually softer",
    "diminuendo": "gradually softer",
    "decresc.": "gradually softer",
    "fine": "stop here",
    "d.c.": "go back to the beginning and play again",
    "da capo": "go back to the beginning and play again",
    "dolce": "play gently",
}
GLOSSARY = [
    {"name": "Treble clef", "text": "The curly sign at the start of the staff. The right hand usually reads this staff. Middle C is on the first ledger line below the staff."},
    {"name": "Bass clef", "text": "The sign like an ear with two dots. The left hand usually reads this staff. Middle C is on the first ledger line above the staff."},
    {"name": "4/4 time", "text": "Four beats in a measure. Each beat is a quarter note. Count 1, 2, 3, 4."},
    {"name": "3/4 time", "text": "Three beats in a measure. Count 1, 2, 3."},
    {"name": "2/4 time", "text": "Two beats in a measure. Count 1, 2."},
    {"name": "6/8 time", "text": "Often felt as two big beats, with three smaller counts inside each. Count 1 2 3, 1 2 3 slowly at first."},
    {"name": "Sharp ♯", "text": "Play the next key to the right, often a black key."},
    {"name": "Flat ♭", "text": "Play the next key to the left, often a black key."},
    {"name": "Natural ♮", "text": "Play the white key again. The note is no longer sharp or flat."},
    {"name": "Dot", "text": "The small dot to the right of a note adds half of that note's length. A dotted quarter note lasts 1 and a half beats."},
    {"name": "Slur", "text": "A curved line over different notes means play them smoothly, without a break. If it joins the same note twice, that is a tie: hold the key and do not play it again."},
    {"name": "Staccato dot", "text": "A small dot above or below the notehead. Play the note short."},
    {"name": "Fingering 1 to 5", "text": "The small number is which finger to use. 1 is the thumb, 2 the index finger, 3 the middle finger, 4 the ring finger, and 5 the little finger."},
    {"name": "mf", "text": "Medium loud. Clear, but do not bang the key."},
    {"name": "mp", "text": "Medium soft. A little louder than soft, still gentle."},
    {"name": "f / p", "text": "f is loud. p is soft."},
    {"name": "rit.", "text": "Gradually slower."},
    {"name": "Pedal", "text": "Press the right sustain pedal. Let it up at the star or where the pedal line lifts."},
]
_PITCH = re.compile(r"^[A-G][♯#♭b-]?-?\d{1,2}$")
_TIME = re.compile(r"^\d{1,2}/\d{1,2}$")
_SOLFEGE = {"C": "Do", "D": "Re", "E": "Mi", "F": "Fa", "G": "Sol", "A": "La", "B": "Si"}
_DURATION = {
    "whole": ("whole note", "hold for 4 beats"),
    "half": ("half note", "hold for 2 beats"),
    "quarter": ("quarter note", "hold for 1 beat"),
    "eighth": ("eighth note", "hold for half a beat"),
}
_REST = {
    "whole": "rest for 4 beats; do not play",
    "half": "rest for 2 beats",
    "quarter": "rest for 1 beat",
    "eighth": "rest for half a beat",
}
_PLAYING = {
    "staccato": "The dot means staccato. Do not hold the full length. Touch the key and let go, so the note sounds short and separate.",
    "staccatissimo": "The wedge means staccatissimo. Even shorter than staccato.",
    "spiccato": "This kind of dot means a short note. The hand may leave the key.",
    "accent": "The angle is an accent. Make this note stand out a little from the ones beside it.",
    "strongaccent": "This is a strong accent. Make the note clearly heavier, but do not bang.",
    "softaccent": "This is a gentle accent. Make the note clear without making it very loud.",
    "tenuto": "The short line is a tenuto. Hold the full length. Do not play it short.",
    "fermata": "The arc and dot are a fermata. You may hold this note longer, then go on when it feels right.",
    "invertedfermata": "The fermata is written below the note. You may hold it longer.",
    "detachedlegato": "A slur with staccato dots. Separate the notes, but not too short.",
    "breathmark": "The comma is a breath mark. Lift slightly here.",
    "caesura": "The double slash is a caesura. Pause briefly after this note, then continue.",
    "tie": "A curved line joining the same pitch is a tie. Hold the key. Do not play the note a second time.",
    "slur": "A curved line over different notes is a slur. Play them smoothly, with no break.",
    "trill": "tr is a trill. Alternate this note quickly with the note above it.",
    "turn": "The sideways curve is a turn. Play the note above, this note, the note below, then this note again.",
    "invertedturn": "This is an inverted turn. Start with the note below, then this note, the note above, and this note again.",
    "mordent": "The wavy line is a mordent. Quickly touch the note above, then come back.",
    "invertedmordent": "This mordent starts with the note below, then comes straight back.",
    "delayedturn": "This turn comes later. Hold this note first, then play the turn.",
    "delayedinvertedturn": "This inverted turn comes later. Hold this note first, then start the turn downward.",
}


def explain_score_en(score, bpm: int | None = None) -> dict:
    facts = []
    facts.extend(_clef_facts(score))
    facts.extend(_key_facts(score))
    facts.extend(_time_facts(score))
    facts.extend(_tempo_facts(score, bpm))
    facts.extend(_value_facts(score))
    facts.extend(_dynamic_facts(score))
    facts.extend(_word_facts(score))
    facts.extend(_fingering_facts(score))
    if not facts:
        facts.append({
            "label": "Score",
            "text": "No clef or time signature was found yet. Listen once, then look at the common markings.",
        })
    return {"facts": facts, "glossary": GLOSSARY}


def describe_marks_en(marks: list[dict]) -> str:
    lines = []
    for mark in marks:
        line = _mark_line(mark)
        if line and line not in lines:
            lines.append(line)
    if not lines:
        return ""
    return "These are the markings on the score.\n" + "\n".join(
        f"{index}. {line}" for index, line in enumerate(lines, start=1)
    )


def _mark_line(mark: dict) -> str:
    if not isinstance(mark, dict):
        return ""
    kind = mark.get("kind")
    if kind == "clef":
        return _clef_line(str(mark.get("clef") or ""), mark.get("hand"))
    if kind == "time":
        return _time_line(str(mark.get("time") or ""))
    if kind == "key":
        return _key_line(mark.get("sharps"))
    if kind == "note":
        return _pitched_line(mark, rest=False)
    if kind == "dot":
        dotted = _dotted_note_line(mark)
        return dotted or (
            "The small dot to the right of the notehead is an augmentation dot, not a staccato. "
            "It adds half the note's length. A dotted quarter note is held for 1 and a half beats."
        )
    if kind == "symbol":
        return _symbols_text(mark)
    if kind == "rest":
        return _pitched_line(mark, rest=True)
    return ""


def _hand(hand: object) -> str:
    if hand == "right":
        return "right hand"
    if hand == "left":
        return "left hand"
    return ""


def _clef_line(which: str, hand: object) -> str:
    hand_text = _hand(hand)
    row = f"the {hand_text} staff" if hand_text else "this staff"
    if which == "treble":
        return (
            f"Treble clef, at the start of {row}. It tells the pitch of every line. "
            "From the bottom line upward the lines are E, G, B, D, F. Middle C sits on the ledger line below the staff. "
            "Play this staff with the right hand."
        )
    if which == "bass":
        return (
            f"Bass clef, at the start of {row}. It also sets the pitches, but the lines are not the same as the treble clef. "
            "From the bottom line upward the lines are G, B, D, F, A. Middle C sits on the ledger line above the staff, "
            "the same piano key as the ledger line below the treble staff. Play this staff with the left hand."
        )
    if which == "alto":
        return f"Alto clef on {row}. It is uncommon in children's piano lessons. The middle line is middle C. Ask the teacher which staff to read."
    if which == "tenor":
        return f"Tenor clef on {row}. It is uncommon in children's piano lessons. The second line from the top is middle C. Ask the teacher which staff to read."
    return ""


def _time_line(label: str) -> str:
    if not _TIME.fullmatch(label):
        return ""
    numerator, denominator = (int(part) for part in label.split("/"))
    beat = BEAT_NAMES.get(denominator, "note")
    extra = {
        "4/4": "Count 1, 2, 3, 4.",
        "3/4": "Count 1, 2, 3.",
        "2/4": "Count 1, 2.",
        "6/8": "It is often two big beats, with three small counts inside each.",
        "3/8": "Three short counts in each measure.",
    }.get(label, "")
    tail = f" {extra}" if extra else ""
    return f"{label} time. {numerator} beats in a measure, and each beat is a {beat}.{tail} Finish the count before the next measure."


def _key_line(sharps: object) -> str:
    if not isinstance(sharps, int) or isinstance(sharps, bool) or not -7 <= sharps <= 7:
        return ""
    if sharps == 0:
        return "The key signature has no sharps or flats. The white keys are Do, Re, Mi, Fa, Sol, La, Ti. Play a black key only when a sharp or flat is printed beside the note."
    if sharps > 0:
        names = ", ".join(SHARP_ORDER[:sharps])
        major = MAJOR_SHARP.get(sharps, "this key")
        return f"The key signature has {sharps} sharp{'s' if sharps != 1 else ''}: {names}. Play each of those notes on the next key to the right, often a black key. It sounds like {major}."
    flats = -sharps
    names = ", ".join(FLAT_ORDER[:flats])
    major = MAJOR_FLAT.get(flats, "this key")
    return f"The key signature has {flats} flat{'s' if flats != 1 else ''}: {names}. Play each of those notes on the next key to the left, often a black key. It sounds like {major}."


def _pitch_words(name: str) -> str:
    step = name[0]
    solfege = _SOLFEGE.get(step, "")
    if "♯" in name or "#" in name:
        solfege += " sharp"
    elif "♭" in name or "b" in name or "-" in name[1:]:
        solfege += " flat"
    middle = ", middle C" if name == "C4" else ""
    return f"{name} ({solfege}){middle}"


def _place(mark: dict) -> str:
    bits = []
    measure = mark.get("measure")
    if isinstance(measure, int) and not isinstance(measure, bool) and 0 <= measure <= 400:
        bits.append("the pickup" if measure == 0 else f"measure {measure}")
    hand = _hand(mark.get("hand"))
    if hand:
        bits.append(f"the {hand}")
    if not bits:
        return ""
    return "In " + " , ".join(bits) + ", "


def _pitched_line(mark: dict, rest: bool) -> str:
    duration = str(mark.get("duration") or "")
    if rest:
        how = _REST.get(duration, "do not play yet")
        name = "rest"
        if duration in _DURATION:
            name = _DURATION[duration][0].replace("note", "rest")
        return f"{_place(mark)}{name}. {how.capitalize()}."
    raw_name = str(mark.get("name") or "")
    if not _PITCH.fullmatch(raw_name):
        return ""
    if _dot_count(mark):
        dotted = _dotted_note_line(mark)
        if dotted:
            return dotted
    label, how = _DURATION.get(duration, ("this note", "hold it for the length written on the score"))
    pitch = _pitch_words(raw_name)
    extra = ""
    if ("♯" in raw_name or "#" in raw_name) and not _printed_accidental(mark):
        extra = " The sharp means the next key to the right, often a black key."
    elif ("♭" in raw_name or "b" in raw_name or raw_name[1:2] == "-") and not _printed_accidental(mark):
        extra = " The flat means the next key to the left, often a black key."
    return f"{_symbols_text(mark)}{_printed_accidental(mark)}{_place(mark)}{pitch}, {label}. {how.capitalize()}.{extra}"


def _dot_count(mark: dict) -> int:
    dots = mark.get("dots")
    if isinstance(dots, bool) or not isinstance(dots, int) or dots < 1:
        return 0
    return min(dots, 3)


def _quarters(mark: dict) -> float | None:
    value = mark.get("quarters")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not 0 < number <= 16:
        return None
    return number


def _written_kind(mark: dict) -> str:
    duration = str(mark.get("duration") or "")
    if duration in _DURATION:
        return duration
    quarters = _quarters(mark)
    dots = _dot_count(mark)
    if quarters is None or dots < 1:
        return ""
    factor = {1: 1.5, 2: 1.75, 3: 1.875}[dots]
    written = quarters / factor
    for name, value in (("whole", 4), ("half", 2), ("quarter", 1), ("eighth", 0.5)):
        if abs(written - value) < 0.08:
            return name
    return ""


def _dotted_note_line(mark: dict) -> str:
    raw_name = str(mark.get("name") or "")
    if not _PITCH.fullmatch(raw_name):
        return ""
    dots = _dot_count(mark)
    if dots < 1:
        return ""
    pitch = _pitch_words(raw_name)
    written = _written_kind(mark)
    base = _DURATION.get(written, ("note", ""))[0]
    point = "the small dot to the right" if dots == 1 else f"the {dots} small dots to the right"
    contrast = "" if mark.get("articulation") == "staccato" else ", not a staccato"
    hold = {
        ("quarter", 1): "A quarter note is 1 beat; with the dot it is 1 and a half beats.",
        ("half", 1): "A half note is 2 beats; with the dot it is 3 beats.",
        ("whole", 1): "A whole note is 4 beats; with the dot it is 6 beats.",
        ("eighth", 1): "An eighth note is half a beat; with the dot it is three quarters of a beat.",
    }.get((written, dots), "The dot makes the note half again as long." if dots == 1 else "Each extra dot adds a smaller amount of time.")
    return (
        f"{_symbols_text(mark)}{_printed_accidental(mark)}{_place(mark)}{pitch}, {base}. "
        f"{point.capitalize()} of the notehead is an augmentation dot{contrast}. "
        f"The dot adds half the note's own length. {hold} Hold the key until the count is finished."
    )


def _symbols_text(mark: dict) -> str:
    items = []
    raw = mark.get("symbols")
    if isinstance(raw, list):
        items.extend(item for item in raw if isinstance(item, dict))
    if mark.get("articulation") == "staccato" and not any(item.get("code") == "staccato" for item in items):
        items.append({"code": "staccato", "detail": "below"})
    lines = []
    for item in items[:8]:
        line = _symbol_sentence(item)
        if line and line not in lines:
            lines.append(line + " ")
    return "".join(lines)


def _beside(detail: str) -> str:
    if detail == "below":
        return "Below the notehead, "
    if detail == "above":
        return "Above the notehead, "
    return "Beside the notehead, "


def _symbol_sentence(item: dict) -> str:
    code = str(item.get("code") or "")
    if not re.fullmatch(r"[a-z0-9._-]{1,40}", code):
        return ""
    detail = str(item.get("detail") or "")[:40]
    if code == "word":
        return _word_sentence(detail)
    if code == "fingering":
        fingers = {"1": "thumb", "2": "index finger", "3": "middle finger", "4": "ring finger", "5": "little finger"}
        which = f"Here it is {detail}, the {fingers[detail]}." if detail in fingers else "1 is the thumb, 2 the index finger, 3 the middle finger, 4 the ring finger, and 5 the little finger."
        return f"The small number beside the note is the fingering. {which}"
    text = _PLAYING.get(code)
    if not text:
        return f"There is a performance marking named {code}. Say what it looks like, what it means, and how the child should play it."
    if code in {"staccato", "staccatissimo", "tenuto", "accent", "strongaccent", "fermata"}:
        return _beside(detail) + text
    return text


def _word_sentence(detail: str) -> str:
    cleaned = " ".join(detail.split())
    if not cleaned or len(cleaned) > 40:
        return ""
    token = cleaned.lower().rstrip(".")
    if token in DYNAMIC_TEXT:
        return f"It says {cleaned}. {DYNAMIC_TEXT[token].capitalize()}."
    for name, text in WORD_TEXT.items():
        if token == name.lower().rstrip("."):
            return f"It says {cleaned}. {text.capitalize()}."
    if re.fullmatch(r"\d{1,3}", cleaned) or re.fullmatch(r"[A-Ga-g][#b♯♭]?\d?", cleaned):
        return ""
    return f"The score says “{cleaned}”. Explain what it means and what the child should do."


def _printed_accidental(mark: dict) -> str:
    kind = mark.get("accidental")
    return {
        "sharp": "The small grid-like sign to the left of the notehead is a sharp. Play the next key to the right, often a black key. ",
        "flat": "The small sign like a lowercase b to the left of the notehead is a flat. Play the next key to the left, often a black key. ",
        "natural": "The small sign like a box to the left of the notehead is a natural. Play the white key again. ",
        "double-sharp": "The sign to the left of the notehead is a double sharp. Play two keys to the right. ",
        "double-flat": "The sign to the left of the notehead is a double flat. Play two keys to the left. ",
    }.get(kind, "")


def _clef_facts(score) -> list[dict]:
    found = []
    for part in score.parts:
        clefs = list(part.recurse().getElementsByClass(clef.Clef))
        if clefs:
            found.append(clefs[0])
    if not found:
        return []
    kinds = []
    for item in found:
        if isinstance(item, clef.TrebleClef):
            kinds.append("treble")
        elif isinstance(item, clef.BassClef):
            kinds.append("bass")
        elif isinstance(item, clef.AltoClef):
            kinds.append("alto")
        elif isinstance(item, clef.TenorClef):
            kinds.append("tenor")
        else:
            kinds.append("other")
    if kinds == ["treble"]:
        text = "There is only a treble clef, usually played by the right hand. Middle C is the ledger line below the staff. From the bottom, the lines are E, G, B, D, F."
    elif kinds == ["bass"]:
        text = "There is only a bass clef, usually played by the left hand. Middle C is the ledger line above the staff. From the bottom, the lines are G, B, D, F, A."
    elif "treble" in kinds and "bass" in kinds:
        text = "The top staff is the treble clef, usually the right hand. The bottom staff is the bass clef, usually the left hand. Middle C is the same piano key on both: the ledger line below the treble staff and the ledger line above the bass staff."
    elif "alto" in kinds or "tenor" in kinds:
        text = "This score uses an alto or tenor clef. That is uncommon in children's piano lessons. Check the original page with the teacher."
    else:
        text = "The clef was recognized. Check the photo and confirm which staff the child should read."
    return [{"label": "Clef", "text": text}]


def _key_facts(score) -> list[dict]:
    amounts = []
    for signature in score.recurse().getElementsByClass(key.KeySignature):
        amount = int(signature.sharps)
        if amount not in amounts:
            amounts.append(amount)
    facts = []
    for amount in amounts:
        if amount == 0:
            text = "No sharps or flats. Starting from middle C, the white keys are Do, Re, Mi, Fa, Sol, La, Ti."
        elif amount > 0:
            names = ", ".join(SHARP_ORDER[:amount])
            major = MAJOR_SHARP.get(amount, "this sharp key")
            text = f"{amount} sharp{'s' if amount != 1 else ''}: {names}. Play those notes on the next key to the right. It sounds like {major}."
        else:
            flats = -amount
            names = ", ".join(FLAT_ORDER[:flats])
            major = MAJOR_FLAT.get(flats, "this flat key")
            text = f"{flats} flat{'s' if flats != 1 else ''}: {names}. Play those notes on the next key to the left. It sounds like {major}."
        facts.append({"label": "Key signature", "text": text})
    return facts


def _time_facts(score) -> list[dict]:
    seen: list[tuple[str, int, int]] = []
    labels: set[str] = set()
    for signature in score.recurse().getElementsByClass(meter.TimeSignature):
        label = f"{signature.numerator}/{signature.denominator}"
        if label not in labels:
            labels.add(label)
            seen.append((label, int(signature.numerator), int(signature.denominator)))
    facts = []
    for label, numerator, denominator in seen:
        beat = BEAT_NAMES.get(denominator, "note")
        extra = {
            "4/4": "Count 1, 2, 3, 4.",
            "3/4": "Count 1, 2, 3.",
            "2/4": "Count 1, 2.",
            "6/8": "Often two big beats, with three small counts inside each.",
            "3/8": "Three short counts in each measure.",
        }.get(label, "")
        text = f"{label}. {numerator} beats in a measure, and each beat is a {beat}. {extra}".strip()
        facts.append({"label": "Time signature", "text": text})
    return facts


def _tempo_facts(score, bpm: int | None) -> list[dict]:
    number = bpm
    if number is None:
        for mark in score.recurse().getElementsByClass(tempo.MetronomeMark):
            if mark.number:
                number = int(round(float(mark.number)))
                break
    if not number:
        return []
    return [{
        "label": "Tempo",
        "text": f"The printed tempo is about {number} beats per minute. While the piece is new, play slower, then return to this speed.",
    }]


def _value_facts(score) -> list[dict]:
    present = set()
    for element in score.recurse().notesAndRests:
        present.add(round(float(element.quarterLength), 4))
    lines = [f"{name}: {how}" for quarters, name, how in NOTE_VALUES if any(abs(item - quarters) < 1e-3 for item in present)]
    if not lines:
        return []
    return [{"label": "Note values", "text": ". ".join(lines) + "."}]


def _dynamic_facts(score) -> list[dict]:
    seen = []
    for dynamic in score.recurse().getElementsByClass(dynamics.Dynamic):
        value = str(dynamic.value or "").lower()
        if value and value not in seen:
            seen.append(value)
    if not seen:
        return []
    parts = [f"{item} means {DYNAMIC_TEXT.get(item, 'a dynamic marking')}" for item in seen]
    return [{"label": "Dynamics", "text": "; ".join(parts) + "."}]


def _word_facts(score) -> list[dict]:
    lines = []
    for expression in score.recurse().getElementsByClass(expressions.TextExpression):
        content = str(expression.content or "").strip()
        meaning = WORD_TEXT.get(content.lower()) or WORD_TEXT.get(content.lower().rstrip("."))
        if meaning and meaning not in lines:
            lines.append(f"{content}: {meaning}")
    if not lines:
        return []
    return [{"label": "Words", "text": ". ".join(lines) + "."}]


def _fingering_facts(score) -> list[dict]:
    for element in score.recurse().notes:
        for articulation in getattr(element, "articulations", []):
            if isinstance(articulation, articulations.Fingering):
                return [{
                    "label": "Fingering",
                    "text": "The small number beside a note is which finger to use. 1 is the thumb, 2 the index finger, 3 the middle finger, 4 the ring finger, and 5 the little finger. Count from the thumb on each hand.",
                }]
    return []
