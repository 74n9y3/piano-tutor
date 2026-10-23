from __future__ import annotations

import re
from contextvars import ContextVar

_lang: ContextVar[str] = ContextVar("piano_lang", default="zh")

_PAGE = re.compile(r"^第 (\d+) 页(是空的|太大了|：.*|没有识别成功.*)$")
_PAGE_FAIL = re.compile(r"^第 (.+) 页没有识别成功，其余页已经按顺序拼好。$")
_PAGE_LINE = re.compile(r"^第 (\d+) 页：(.*)$")


def normalize_lang(value: str | None) -> str:
    text = (value or "").strip().lower()
    if text.startswith("en"):
        return "en"
    return "zh"


def lang() -> str:
    return _lang.get()


def set_lang(value: str | None) -> None:
    _lang.set(normalize_lang(value))


def lang_from_header(value: str | None) -> str:
    if not value:
        return "zh"
    first = value.split(",")[0].strip()
    return normalize_lang(first)


ZH = {
    "empty_file": "文件是空的",
    "no_photo": "没有收到照片",
    "folder_local_only": "只能在这台电脑上打开文件夹",
    "score_not_ready": "谱子还没准备好",
    "no_photo_piece": "这首曲子没有照片",
    "one_semitone": "一次只能升或降半音",
    "bad_duration": "只能改成全音符、二分音符、四分音符或八分音符",
    "nothing_to_edit": "没有要修改的内容",
    "no_route": "没有这个接口",
    "no_file": "没有这个文件",
    "frontend_missing": "界面还没有构建。请在 frontend 目录运行 npm install 和 npm run build。",
    "app_title": "钢琴陪练",
    "not_a_score": "这个文件不是能打开的乐谱",
    "untitled": "未命名曲子",
    "midi_piece": "MIDI 曲子",
    "too_many_pages": "一次最多 12 页",
    "empty_page": "第 {index} 页是空的",
    "page_too_big": "第 {index} 页太大了",
    "recognizing_title": "正在识谱",
    "take_too_short": "录音太短了。再弹一会儿再停止。",
    "take_too_long": "录音太长了。一段先录三分钟以内。",
    "piece_missing": "找不到这首曲子",
    "folder_unsupported": "这台电脑不能直接打开文件夹",
    "folder_failed": "文件夹没有打开",
    "no_such_page": "没有这一页",
    "page_too_big_one": "这一页太大了",
    "empty_title": "曲名不能是空的",
    "empty_note": "没有可以记下的说明",
    "mark": "记号",
    "take_too_short_range": "录音太短了。弹完选定的几小节再停止。",
    "take_missing": "找不到这次录音",
    "no_pages": "没有可以识别的页",
    "page_image_missing": "找不到这一页的照片",
    "page_no_notes": "这一页没有认出音符",
    "page_failed": "这一页识谱时出了问题",
    "recognize_failed": "识谱没有成功",
    "partial_fail": "第 {which} 页没有识别成功，其余页已经按顺序拼好。",
    "page_error_line": "第 {index} 页：{error}",
    "no_piano": "没有听出钢琴的音。把电脑靠近钢琴，再弹一遍。",
    "notate_failed": "没能把这段弹的写成谱，请再录一次。",
    "analyze_failed": "听音分析没有完成，请再录一次。",
    "job_busy": "这首正在识别，请等这一轮结束。",
    "nothing_to_merge": "没有可以拼起来的谱",
    "no_staves": "这些页里没有谱表",
    "no_measures": "这些页里没有小节",
    "not_midi": "这不是 MIDI 文件。请选择以 .mid 结尾的文件。",
    "midi_too_big": "这个 MIDI 太大了。请选一首短一些的。",
    "midi_no_notes": "这个 MIDI 里没有找到音符。",
    "midi_too_long": "这首太长了。请选 160 个小节以内的 MIDI。",
    "midi_unreadable": "这个 MIDI 读不出来。请换一个 .mid 文件。",
    "no_notes_in_score": "这份谱里没有找到音符",
    "title_empty": "标题不能是空的",
    "title_too_long": "标题最多 40 个字",
    "note_missing": "找不到这个音，请重新点一次",
    "pitch_locked": "这个记号不能改音高",
    "sample_title": "双手五指练习",
    "right_hand": "右手",
    "left_hand": "左手",
    "missed_note": "这一音没有听到",
    "rushed_or_late": "音高对了，但这一下明显抢了或拖了",
    "heard_other": "谱上是 {printed}，听到的是 {heard}",
    "no_mark_hit": "没有点到谱号、拍号或音符。点一下音符，或音符旁边的记号。",
    "model_download_failed": "钢琴听音模型下载失败，请检查网络后再录一次。",
    "model_incomplete": "钢琴听音模型没有下完整，请再录一次。",
    "model_missing": "还没有安装钢琴听音组件。在项目目录运行：uv pip install -r requirements-ml.txt",
    "wav_unreadable": "这段录音读不出来，请再录一次。",
    "image_unreadable": "这张图片打不开。请换一张 JPG 或 PNG。",
    "uv_missing": "没有找到 uv，暂时不能识谱。请先安装 uv，或改用 MusicXML 导入。",
    "omr_timeout": "识谱超过 20 分钟还没结束。可以先裁成一页最清楚的谱子再试。",
    "omr_failed": "识谱没有成功。请换一张平整、光线均匀的照片，让五线谱尽量占满画面。",
}

EN = {
    "empty_file": "The file is empty.",
    "no_photo": "No photo was received.",
    "folder_local_only": "Folders can only be opened on this computer.",
    "score_not_ready": "The score is not ready yet.",
    "no_photo_piece": "This piece has no photo.",
    "one_semitone": "You can only raise or lower by one semitone at a time.",
    "bad_duration": "Duration can only be a whole, half, quarter, or eighth note.",
    "nothing_to_edit": "Nothing to change.",
    "no_route": "That address does not exist.",
    "no_file": "That file does not exist.",
    "frontend_missing": "The page has not been built yet. In the frontend folder, run npm install and npm run build.",
    "app_title": "Piano Tutor",
    "not_a_score": "This file is not a score that can be opened.",
    "untitled": "Untitled piece",
    "midi_piece": "MIDI piece",
    "too_many_pages": "You can add at most 12 pages at once.",
    "empty_page": "Page {index} is empty.",
    "page_too_big": "Page {index} is too large.",
    "recognizing_title": "Reading the score",
    "take_too_short": "That recording is too short. Play a little longer, then stop.",
    "take_too_long": "That recording is too long. Keep one take under three minutes.",
    "piece_missing": "That piece could not be found.",
    "folder_unsupported": "This computer cannot open the folder directly.",
    "folder_failed": "The folder did not open.",
    "no_such_page": "That page does not exist.",
    "page_too_big_one": "This page is too large.",
    "empty_title": "The title cannot be empty.",
    "empty_note": "There is no explanation to save.",
    "mark": "Marking",
    "take_too_short_range": "That recording is too short. Play the selected measures, then stop.",
    "take_missing": "That recording could not be found.",
    "no_pages": "There are no pages to read.",
    "page_image_missing": "The photo for this page is missing.",
    "page_no_notes": "No notes were found on this page.",
    "page_failed": "Something went wrong while reading this page.",
    "recognize_failed": "The score could not be read.",
    "partial_fail": "Page {which} could not be read. The other pages were joined in order.",
    "page_error_line": "Page {index}: {error}",
    "no_piano": "No piano notes were heard. Move the computer closer to the piano and try again.",
    "notate_failed": "That playing could not be written as a score. Please record it again.",
    "analyze_failed": "The recording could not be checked. Please record it again.",
    "job_busy": "This piece is already being read. Wait for this round to finish.",
    "nothing_to_merge": "There is no score to join.",
    "no_staves": "These pages have no staves.",
    "no_measures": "These pages have no measures.",
    "not_midi": "This is not a MIDI file. Choose a file that ends in .mid.",
    "midi_too_big": "This MIDI file is too large. Choose a shorter one.",
    "midi_no_notes": "No notes were found in this MIDI file.",
    "midi_too_long": "This piece is too long. Choose a MIDI file of 160 measures or fewer.",
    "midi_unreadable": "This MIDI file could not be read. Try another .mid file.",
    "no_notes_in_score": "No notes were found in this score.",
    "title_empty": "The title cannot be empty.",
    "title_too_long": "The title can be at most 40 characters.",
    "note_missing": "That note could not be found. Click it again.",
    "pitch_locked": "The pitch of this marking cannot be changed.",
    "sample_title": "Five-finger exercise",
    "right_hand": "Right hand",
    "left_hand": "Left hand",
    "missed_note": "This note was not heard.",
    "rushed_or_late": "The pitch was right, but this note was clearly early or late.",
    "heard_other": "The score says {printed}, but we heard {heard}.",
    "no_mark_hit": "No clef, time signature, or note was selected. Click a note, or a marking beside it.",
    "model_download_failed": "The piano listening model could not be downloaded. Check the network and record again.",
    "model_incomplete": "The piano listening model did not finish downloading. Record again.",
    "model_missing": "The piano listening components are not installed. In the project folder run: uv pip install -r requirements-ml.txt",
    "wav_unreadable": "This recording could not be read. Please record it again.",
    "image_unreadable": "This picture could not be opened. Use a JPG or PNG.",
    "uv_missing": "uv was not found, so the photo cannot be read yet. Install uv, or import MusicXML instead.",
    "omr_timeout": "Reading the score took more than 20 minutes. Crop to one clear page and try again.",
    "omr_failed": "The score could not be read. Take a flat, evenly lit photo with the staves filling most of the frame.",
}

_ZH_TO_EN = {value: EN[key] for key, value in ZH.items() if "{" not in value}


def t(key: str, **params: object) -> str:
    table = EN if lang() == "en" else ZH
    text = table[key]
    return text.format(**params) if params else text


def localize_take(record: dict) -> dict:
    if lang() != "en":
        return record
    copied = dict(record)
    copied["error"] = localize_stored(copied.get("error"))
    result = copied.get("result")
    if isinstance(result, dict):
        result = dict(result)
        notes = []
        for note in result.get("notes") or []:
            if isinstance(note, dict):
                item = dict(note)
                item["detail"] = localize_stored(item.get("detail")) or ""
                notes.append(item)
            else:
                notes.append(note)
        result["notes"] = notes
        copied["result"] = result
    return copied


def localize_stored(text: str | None) -> str | None:
    if not text or lang() != "en":
        return text
    if text in _ZH_TO_EN:
        return _ZH_TO_EN[text]
    page_fail = _PAGE_FAIL.fullmatch(text)
    if page_fail:
        return t("partial_fail", which=page_fail.group(1))
    page_line = _PAGE_LINE.fullmatch(text)
    if page_line:
        return t("page_error_line", index=page_line.group(1), error=localize_stored(page_line.group(2)) or page_line.group(2))
    empty = re.fullmatch(r"第 (\d+) 页是空的", text)
    if empty:
        return t("empty_page", index=empty.group(1))
    large = re.fullmatch(r"第 (\d+) 页太大了", text)
    if large:
        return t("page_too_big", index=large.group(1))
    heard = re.fullmatch(r"谱上是 (.+)，听到的是 (.+)", text)
    if heard:
        return t("heard_other", printed=heard.group(1), heard=heard.group(2))
    return text
