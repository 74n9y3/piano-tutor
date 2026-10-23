from __future__ import annotations

import re

from music21 import articulations, clef, dynamics, expressions, key, meter, tempo

MAJOR_SHARP = {
    0: "C 大调",
    1: "G 大调",
    2: "D 大调",
    3: "A 大调",
    4: "E 大调",
    5: "B 大调",
    6: "升 F 大调",
    7: "升 C 大调",
}
MAJOR_FLAT = {
    1: "F 大调",
    2: "降 B 大调",
    3: "降 E 大调",
    4: "降 A 大调",
    5: "降 D 大调",
    6: "降 G 大调",
    7: "降 C 大调",
}
SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"]
BEAT_NAMES = {1: "全音符", 2: "二分音符", 4: "四分音符", 8: "八分音符", 16: "十六分音符"}
NOTE_VALUES = (
    (4.0, "全音符", "唱满 4 拍"),
    (3.0, "附点二分音符", "唱 3 拍"),
    (2.0, "二分音符", "唱 2 拍"),
    (1.5, "附点四分音符", "唱 1 拍半"),
    (1.0, "四分音符", "唱 1 拍"),
    (0.75, "附点八分音符", "比半拍再长一点"),
    (0.5, "八分音符", "半拍"),
    (0.25, "十六分音符", "四分之一拍"),
)
DYNAMIC_TEXT = {
    "ppp": "极轻",
    "pp": "很轻",
    "p": "轻",
    "mp": "中弱，比轻再响一点",
    "mf": "中强，清楚但不要砸",
    "f": "强",
    "ff": "很强",
    "fff": "极强",
    "fp": "先强，马上收回来",
    "sfz": "这个音突然加强",
    "sf": "这个音突然加强",
}
WORD_TEXT = {
    "rit.": "渐渐慢下来",
    "rit": "渐渐慢下来",
    "ritard.": "渐渐慢下来",
    "ritardando": "渐渐慢下来",
    "rall.": "渐渐慢下来",
    "accel.": "渐渐快起来",
    "accelerando": "渐渐快起来",
    "a tempo": "回到原来的速度",
    "tempo i": "回到原来的速度",
    "legato": "连着弹，音和音之间不要断开",
    "staccato": "弹短，像轻轻点一下",
    "cresc.": "渐渐响起来",
    "crescendo": "渐渐响起来",
    "dim.": "渐渐轻下去",
    "diminuendo": "渐渐轻下去",
    "decresc.": "渐渐轻下去",
    "fine": "到这里结束",
    "d.c.": "回到曲子开头再弹",
    "da capo": "回到曲子开头再弹",
    "dolce": "弹得柔和一些",
}

GLOSSARY = [
    {"name": "高音谱号", "text": "行首像花体的记号。右手通常看这一行。下加一线是中央 C。"},
    {"name": "低音谱号", "text": "行首像耳朵再加两点。左手通常看这一行。上加一线也是中央 C。"},
    {"name": "拍号 4/4", "text": "每小节 4 拍，一拍是一个四分音符。可以数 1、2、3、4。"},
    {"name": "拍号 3/4", "text": "每小节 3 拍。可以数 1、2、3。"},
    {"name": "拍号 2/4", "text": "每小节 2 拍。可以数 1、2。"},
    {"name": "拍号 6/8", "text": "常分成两组，每组三下。先慢慢数 1 2 3、1 2 3。"},
    {"name": "升号 ♯", "text": "这个音改弹右边紧挨着的琴键，常常是黑键。"},
    {"name": "降号 ♭", "text": "这个音改弹左边紧挨着的琴键，常常是黑键。"},
    {"name": "还原号 ♮", "text": "这个音回到白键，不再升也不再降。"},
    {"name": "附点", "text": "音符右边的小点。这个音再延长自己的一半。四分音符加附点是 1 拍半。"},
    {"name": "连线", "text": "弧线连着的音要连着弹。如果连的是同一个音，就按住不要弹第二次。"},
    {"name": "跳音点", "text": "符头上或下面的小圆点。这个音弹短一些。"},
    {"name": "指法 1 到 5", "text": "小数字是用哪根手指。1 是大拇指，2 食指，3 中指，4 无名指，5 小指。"},
    {"name": "mf", "text": "中强。声音清楚，但不是用力砸下去。"},
    {"name": "mp", "text": "中弱。比轻稍响，仍然柔和。"},
    {"name": "f / p", "text": "f 是强，p 是轻。"},
    {"name": "rit.", "text": "渐渐慢下来。"},
    {"name": "踏板 Ped.", "text": "踩下右边的延音踏板。看到 * 或踏板线抬起时松开。"},
]


def explain_score(score, bpm: int | None = None) -> dict:
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
        facts.append({"label": "谱面", "text": "还没有从这份谱里读出谱号或拍号。可以先听一遍，再看右边的常见记号。"})
    return {"facts": facts, "glossary": GLOSSARY}


def glossary_payload(message: str) -> dict:
    return {"mode": "glossary", "message": message, "glossary": GLOSSARY}


_PITCH = re.compile(r"^[A-G][♯#♭b-]?-?\d{1,2}$")
_TIME = re.compile(r"^\d{1,2}/\d{1,2}$")
_SOLFEGE = {"C": "Do", "D": "Re", "E": "Mi", "F": "Fa", "G": "Sol", "A": "La", "B": "Si"}
_DURATION_PLAY = {
    "whole": ("全音符", "唱满 4 拍"),
    "half": ("二分音符", "唱 2 拍"),
    "quarter": ("四分音符", "唱 1 拍"),
    "eighth": ("八分音符", "唱半拍"),
}
_REST_PLAY = {
    "whole": "空满 4 拍，这里不要弹",
    "half": "空 2 拍，手先不要按下去",
    "quarter": "空 1 拍",
    "eighth": "空半拍",
}


def describe_marks(marks: list[dict]) -> str:
    """Explain symbols the program already identified on the engraved score."""
    lines = []
    for mark in marks:
        line = _mark_line(mark)
        if line and line not in lines:
            lines.append(line)
    if not lines:
        return ""
    return "圈到的是谱上这些记号。\n" + "\n".join(f"{index}. {line}" for index, line in enumerate(lines, start=1))


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
        return _dotted_note_line(mark) or (
            "符头右边的小圆点是附点，不是跳音。这个音再延长自己的一半。"
            "四分音符加一个附点要按住 1 拍半。"
        )
    if kind == "symbol":
        return _symbols_text(mark)
    if kind == "rest":
        return _pitched_line(mark, rest=True)
    return ""


def _clef_line(clef: str, hand: object) -> str:
    hand_text = _hand(hand)
    row = f"{hand_text}这一行" if hand_text else "这一行"
    if clef == "treble":
        return (
            f"高音谱号，写在{row}的开头。它规定这条线上每个音的高度。"
            "五线从下往上是 Mi、Sol、Si、Re、Fa。下加一线是中央 C。用右手看这一行来弹。"
        )
    if clef == "bass":
        return (
            f"低音谱号，写在{row}的开头。它也是在规定音高，和上面的高音谱号不是同一套线。"
            "五线从下往上是 Sol、Si、Re、Fa、La。上加一线是中央 C，和右手下加一线是同一个琴键。用左手看这一行来弹。"
        )
    if clef == "alto":
        return f"中音谱号，写在{row}。儿童钢琴课里少见。中间那条线是中央 C。先让老师确认孩子该看哪一行。"
    if clef == "tenor":
        return f"次中音谱号，写在{row}。儿童钢琴课里少见。从上往下数第二条线是中央 C。先让老师确认。"
    return ""


def _time_line(label: str) -> str:
    if not _TIME.fullmatch(label):
        return ""
    numerator, denominator = (int(part) for part in label.split("/"))
    beat = BEAT_NAMES.get(denominator, "音符")
    extra = {
        "4/4": "可以数 1、2、3、4。",
        "3/4": "可以数 1、2、3。",
        "2/4": "可以数 1、2。",
        "6/8": "常常两下大拍，每下里面再数三下。",
        "3/8": "每小节三下，每下比较短。",
    }.get(label, "")
    return f"拍号 {label}。每小节 {numerator} 拍，一拍是一个{beat}。{extra}数满再进入下一小节。".replace("。 ", "。")


def _key_line(sharps: object) -> str:
    if not isinstance(sharps, int) or isinstance(sharps, bool) or not -7 <= sharps <= 7:
        return ""
    if sharps == 0:
        return "调号没有升降号。白键就是 Do Re Mi Fa Sol La Si。只有音符旁边另外写了升号或降号，才改去旁边的黑键。"
    if sharps > 0:
        names = "、".join(SHARP_ORDER[:sharps])
        major = MAJOR_SHARP.get(sharps, "这个调")
        return f"调号有 {sharps} 个升号，升的是 {names}。这几个音要弹右边紧挨着的键，常常是黑键。听起来是 {major}。"
    flats = -sharps
    names = "、".join(FLAT_ORDER[:flats])
    major = MAJOR_FLAT.get(flats, "这个调")
    return f"调号有 {flats} 个降号，降的是 {names}。这几个音要弹左边紧挨着的键，常常是黑键。听起来是 {major}。"


def _pitched_line(mark: dict, rest: bool) -> str:
    duration = str(mark.get("duration") or "")
    if rest:
        name, how = ("休止符", _REST_PLAY.get(duration, "这里先不要弹"))
        if duration in _DURATION_PLAY:
            name = _DURATION_PLAY[duration][0].replace("音符", "休止符")
        pitch = ""
    else:
        raw_name = str(mark.get("name") or "")
        if not _PITCH.fullmatch(raw_name):
            return ""
        if _dot_count(mark):
            dotted = _dotted_note_line(mark)
            if dotted:
                return dotted
        label, how = _DURATION_PLAY.get(duration, ("这个音", "按谱上画的长度弹"))
        name = label
        pitch = _pitch_words(raw_name)
        if "♯" in raw_name or "#" in raw_name:
            if not _printed_accidental(mark):
                how += "。升号表示弹右边紧挨着的琴键，常常是黑键"
        elif "♭" in raw_name or "b" in raw_name or raw_name[1:2] == "-":
            if not _printed_accidental(mark):
                how += "。降号表示弹左边紧挨着的琴键，常常是黑键"
    place = _place(mark)
    shown = f"{pitch}，{name}" if pitch else name
    return f"{_symbols_text(mark)}{_printed_accidental(mark)}{place}{shown}。{how}。"


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
    if duration in _DURATION_PLAY:
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
    place = _place(mark)
    written = _written_kind(mark)
    base = _DURATION_PLAY.get(written, ("音符", ""))[0]
    point = "右边那个小圆点" if dots == 1 else f"右边那 {dots} 个小圆点"
    contrast = "" if mark.get("articulation") == "staccato" else "，不是跳音"
    return (
        f"{_symbols_text(mark)}{_printed_accidental(mark)}{place}{pitch}，{base}。符头{point}是附点{contrast}。"
        f"附点的意思是这个音再延长自己的一半。{_dotted_hold(written, dots)}"
        "手指按住，数完再松开。"
    )


def _dotted_hold(written: str, dots: int) -> str:
    if dots == 1:
        return {
            "quarter": "本来唱 1 拍，加上这个点一共唱 1 拍半。",
            "half": "本来唱 2 拍，加上这个点一共唱 3 拍。",
            "whole": "本来唱 4 拍，加上这个点一共唱 6 拍。",
            "eighth": "本来唱半拍，加上这个点一共唱 3/4 拍。",
        }.get(written, "按住的时间比原来多一半。")
    if dots == 2 and written == "quarter":
        return "第一个点加一半，第二个点再加一半的一半，一共唱 1 又 3/4 拍。"
    return "第一个点延长一半，后面的点再少延长一些。按住的时间更长。"


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
            lines.append(line)
    return "".join(lines)


def _symbol_sentence(item: dict) -> str:
    code = str(item.get("code") or "")
    if not re.fullmatch(r"[a-z0-9._-]{1,40}", code):
        return ""
    detail = str(item.get("detail") or "")[:40]
    if code == "word":
        return _word_sentence(detail)
    if code == "fingering":
        fingers = {"1": "大拇指", "2": "食指", "3": "中指", "4": "无名指", "5": "小指"}
        which = f"这里是 {detail}，用{fingers[detail]}。" if detail in fingers else "1 是大拇指，2 食指，3 中指，4 无名指，5 小指。"
        return f"音符旁边的小数字是指法。{which}"
    text = _PLAYING_MARKS.get(code)
    if not text:
        return f"谱上有一个演奏记号，名字是 {code}。请说明它看起来什么样、什么意思、孩子要怎么弹。"
    if code in {"staccato", "staccatissimo", "tenuto", "accent", "strongaccent", "fermata"}:
        return _beside(detail) + text
    return text


def _beside(detail: str) -> str:
    if detail == "below":
        return "符头下面"
    if detail == "above":
        return "符头上面"
    return "符头旁边"


def _word_sentence(detail: str) -> str:
    cleaned = " ".join(detail.split())
    if not cleaned or len(cleaned) > 40:
        return ""
    key = cleaned.lower().rstrip(".")
    if key in DYNAMIC_TEXT:
        return f"写着 {cleaned}。{DYNAMIC_TEXT[key]}。"
    for name, text in WORD_TEXT.items():
        if key == name.lower().rstrip("."):
            return f"写着 {cleaned}。{text}。"
    if re.fullmatch(r"\d{1,3}", cleaned):
        return ""
    if re.fullmatch(r"[A-Ga-g][#b♯♭]?\d?", cleaned):
        return ""
    return f"谱上写着「{cleaned}」。请说明这是什么意思、孩子要怎么做。"


_PLAYING_MARKS = {
    "staccato": "的小圆点是跳音。这个音不要按满，手指点一下就松开，听起来短、分开。",
    "staccatissimo": "的小楔子是顿音。比跳音更短，点一下马上松开。",
    "spiccato": "的点是跳音的一种。这个音弹短，手可以离键。",
    "accent": "的尖角是重音。这个音要比旁边的音更突出一点。",
    "strongaccent": "的尖角是很重的音。这个音要明显重一些，但不要砸。",
    "softaccent": "的记号是轻一点的重音。这个音清楚一些，不用很响。",
    "tenuto": "的短横线是保持音。这个音要按满时值，不要弹短。",
    "fermata": "的弧线和点是延长记号。这个音可以停久一点，觉得够了再弹下一个。",
    "invertedfermata": "的延长记号写在下面。这个音可以停久一点。",
    "detachedlegato": "既有连线又有跳音点。音要分开，但不要太短。",
    "breathmark": "的逗号是换气。这里可以轻轻断开一下。",
    "caesura": "的双斜线是停一下。这个音后稍停，再继续。",
    "tie": "连着同一个音的弧线是延音线。按住不要弹第二次。",
    "slur": "连着几个音的弧线是连线。这些音要连着弹，中间不要断开。",
    "trill": "tr 是颤音。这个音和上面的音快速交替着弹。",
    "turn": "横着的弯钩是回音。按上面的音、这个音、下面的音、再回到这个音。",
    "invertedturn": "反向的回音。先弹下面的音，再是这个音、上面的音，回到这个音。",
    "mordent": "波纹是波音。很快碰一下上面的音，马上回到这个音。",
    "invertedmordent": "波音先碰下面的音，马上回到这个音。",
    "delayedturn": "晚一点的回音。先把这个音按住，再按回音的顺序弹。",
    "delayedinvertedturn": "晚一点的反向回音。先按住这个音，再往下开始回音。",
}


def _printed_accidental(mark: dict) -> str:
    kind = mark.get("accidental")
    return {
        "sharp": "符头左边那个像小格子的记号是升号。这个音改弹右边紧挨着的琴键，常常是黑键。",
        "flat": "符头左边那个像小写 b 的记号是降号。这个音改弹左边紧挨着的琴键，常常是黑键。",
        "natural": "符头左边那个像小方框的记号是还原号。这个音回到白键，不再升高，也不再降低。",
        "double-sharp": "符头左边的记号是重升号。这个音要再高一些，弹右边第二个键。",
        "double-flat": "符头左边的记号是重降号。这个音要再低一些，弹左边第二个键。",
    }.get(kind, "")


def _pitch_words(name: str) -> str:
    step = name[0]
    solfege = _SOLFEGE.get(step, "")
    if "♯" in name or "#" in name:
        solfege += "♯"
    elif "♭" in name or "b" in name or "-" in name[1:]:
        solfege += "♭"
    central = "，中央 C" if name == "C4" else ""
    return f"{name}（{solfege}）{central}"


def _place(mark: dict) -> str:
    bits = []
    measure = mark.get("measure")
    if isinstance(measure, int) and not isinstance(measure, bool) and 0 <= measure <= 400:
        bits.append("弱起" if measure == 0 else f"第 {measure} 小节")
    hand = _hand(mark.get("hand"))
    if hand:
        bits.append(hand)
    return "，".join(bits) + "的" if bits else ""


def _hand(hand: object) -> str:
    if hand == "right":
        return "右手"
    if hand == "left":
        return "左手"
    return ""


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
        text = "只有高音谱号，一般用右手弹。下加一线是中央 C。五线从下往上数，线是 E、G、B、D、F。"
    elif kinds == ["bass"]:
        text = "只有低音谱号，一般用左手弹。上加一线是中央 C。五线从下往上数，线是 G、B、D、F、A。"
    elif "treble" in kinds and "bass" in kinds:
        text = "上面一行是高音谱号，通常右手弹；下面一行是低音谱号，通常左手弹。两个谱号的中央 C 是同一个琴键：高音谱下加一线，低音谱上加一线。"
    elif "alto" in kinds or "tenor" in kinds:
        text = "这里用的是中音谱号。儿童钢琴课里不常见，对着原图让老师确认孩子该看哪一行。"
    else:
        text = "谱号已经认出来了。对照左边的照片，确认孩子看的是哪一行。"
    return [{"label": "谱号", "text": text}]


def _key_facts(score) -> list[dict]:
    amounts = []
    for signature in score.recurse().getElementsByClass(key.KeySignature):
        amount = int(signature.sharps)
        if amount not in amounts:
            amounts.append(amount)
    facts = []
    for amount in amounts:
        if amount == 0:
            text = "没有升降号。从中央 C 开始，白键就是 Do Re Mi Fa Sol La Si。"
        elif amount > 0:
            names = "、".join(SHARP_ORDER[:amount])
            major = MAJOR_SHARP.get(amount, "这个升号调")
            text = f"有 {amount} 个升号，升的是 {names}。这些音要弹右边紧挨着的键。听起来是 {major}。"
        else:
            flats = -amount
            names = "、".join(FLAT_ORDER[:flats])
            major = MAJOR_FLAT.get(flats, "这个降号调")
            text = f"有 {flats} 个降号，降的是 {names}。这些音要弹左边紧挨着的键。听起来是 {major}。"
        facts.append({"label": "调号", "text": text})
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
        beat = BEAT_NAMES.get(denominator, "音符")
        extra = {
            "4/4": "可以数 1、2、3、4。",
            "3/4": "可以数 1、2、3。",
            "2/4": "可以数 1、2。",
            "6/8": "常常两下大拍，每下里面再数三下。",
            "3/8": "每小节三下，每下比较短。",
        }.get(label, "")
        text = f"{label}。每小节 {numerator} 拍，一拍是一个{beat}。{extra}".strip()
        facts.append({"label": "拍号", "text": text})
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
        "label": "速度",
        "text": f"谱上大约是每分钟 {number} 拍。刚练可以先拉慢，听熟了再回到原速。",
    }]


def _value_facts(score) -> list[dict]:
    present = set()
    for element in score.recurse().notesAndRests:
        present.add(round(float(element.quarterLength), 4))
    lines = []
    for quarters, name, how in NOTE_VALUES:
        if any(abs(item - quarters) < 1e-3 for item in present):
            lines.append(f"{name}：{how}")
    if not lines:
        return []
    return [{"label": "音符时值", "text": "。".join(lines) + "。"}]


def _dynamic_facts(score) -> list[dict]:
    seen = []
    for dynamic in score.recurse().getElementsByClass(dynamics.Dynamic):
        value = str(dynamic.value or "").lower()
        if value and value not in seen:
            seen.append(value)
    if not seen:
        return []
    parts = [f"{item} 是{DYNAMIC_TEXT.get(item, '力度记号')}" for item in seen]
    return [{"label": "力度", "text": "；".join(parts) + "。"}]


def _word_facts(score) -> list[dict]:
    lines = []
    for expression in score.recurse().getElementsByClass(expressions.TextExpression):
        content = str(expression.content or "").strip()
        meaning = WORD_TEXT.get(content.lower()) or WORD_TEXT.get(content.lower().rstrip("."))
        if meaning and meaning not in lines:
            lines.append(f"{content}：{meaning}")
    if not lines:
        return []
    return [{"label": "文字记号", "text": "。".join(lines) + "。"}]


def _fingering_facts(score) -> list[dict]:
    for element in score.recurse().notes:
        for articulation in getattr(element, "articulations", []):
            if isinstance(articulation, articulations.Fingering):
                return [{
                    "label": "指法",
                    "text": "音符旁边的小数字是用哪根手指。1 是大拇指，2 食指，3 中指，4 无名指，5 小指。左右手各自从大拇指数起。",
                }]
    return []
