from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from backend import omr, transcribe
from backend.align import align_performance
from backend.explain import explain_score
from backend.notate import NotateError, improv_title, notes_to_score
from backend.omr import OmrError
from backend.pages import merge_page_scores
from backend.paths import pieces_dir
from backend.score_ops import (
    ScoreError,
    assign_ids,
    build_sample,
    edit_note,
    measure_span,
    noteheads,
    parse_bytes,
    parse_file,
    remove_note,
    rename_title,
    score_bpm,
    score_title,
    write_score,
)
from backend.transcribe import TranscribeError


class Store:
    def __init__(self, root: Path | None = None):
        self.root = root or pieces_dir()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._jobs: set[str] = set()
        self._homr = threading.Lock()

    def list_pieces(self) -> list[dict]:
        pieces = []
        for path in self.root.iterdir():
            if not path.is_dir() or not (path / "meta.json").exists():
                continue
            meta = self._read_meta(path.name)
            pieces.append(self._summary(meta))
        pieces.sort(key=lambda item: item["created"], reverse=True)
        return pieces

    def create_sample(self) -> dict:
        return self._create_from_score(build_sample(), "双手五指练习")

    def create_from_musicxml(self, data: bytes, filename: str) -> dict:
        try:
            score = parse_bytes(data)
        except ScoreError:
            raise
        except Exception as exc:
            raise ScoreError("这个文件不是能打开的乐谱") from exc
        fallback = Path(filename).stem or "未命名曲子"
        return self._create_from_score(score, fallback)

    def create_from_midi(self, data: bytes, filename: str) -> dict:
        from backend.midi_score import MidiScoreError, score_from_midi

        stem = Path(filename).stem.replace("_", " ").strip()
        title = " ".join(stem.split())[:40] or "MIDI 曲子"
        try:
            score = score_from_midi(data, title)
        except MidiScoreError as exc:
            raise ScoreError(str(exc)) from exc
        return self._create_from_score(score, title, source="midi")

    def create_from_photo(self, data: bytes, filename: str, title: str | None = None) -> dict:
        return self.create_from_photos([(data, filename)], title)

    def create_from_photos(self, files: list[tuple[bytes, str]], title: str | None = None) -> dict:
        if not files:
            raise ScoreError("没有收到照片")
        if len(files) > 12:
            raise ScoreError("一次最多 12 页")
        piece_id = _new_id()
        folder = self._folder(piece_id)
        pages_dir = folder / "pages"
        pages_dir.mkdir(parents=True)
        pages = []
        try:
            for index, (data, filename) in enumerate(files, start=1):
                if not data:
                    raise ScoreError(f"第 {index} 页是空的")
                if len(data) > 12_000_000:
                    raise ScoreError(f"第 {index} 页太大了")
                suffix = Path(filename).suffix.lower()
                if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}:
                    suffix = ".img"
                original = pages_dir / f"{index:03d}{suffix}"
                original.write_bytes(data)
                omr.prepare_image(original, pages_dir / f"{index:03d}.png")
                if original.suffix != ".png":
                    original.unlink(missing_ok=True)
                pages.append(_blank_page(index))
        except (OmrError, ScoreError):
            shutil.rmtree(folder, ignore_errors=True)
            raise
        cleaned = " ".join((title or "").split())[:40]
        if not cleaned:
            cleaned = Path(files[0][1]).stem or "正在识谱"
        meta = {
            "id": piece_id,
            "title": cleaned,
            "status": "recognizing",
            "error": None,
            "created": _now(),
            "hasPhoto": True,
            "source": "score",
            "pages": pages,
        }
        self._write_meta(piece_id, meta)
        self._start_job(piece_id, lambda: self._recognize_pages(piece_id))
        return self._summary(meta)

    def create_from_improv(self, wav: bytes) -> dict:
        if len(wav) < 1000:
            raise ScoreError("录音太短了。再弹一会儿再停止。")
        if len(wav) > 25_000_000:
            raise ScoreError("录音太长了。一段先录三分钟以内。")
        piece_id = _new_id()
        folder = self._folder(piece_id)
        folder.mkdir(parents=True)
        (folder / "improv.wav").write_bytes(wav)
        title = improv_title()
        meta = {
            "id": piece_id,
            "title": title,
            "status": "recognizing",
            "error": None,
            "created": _now(),
            "hasPhoto": False,
            "source": "improv",
        }
        self._write_meta(piece_id, meta)
        threading.Thread(target=self._notate, args=(piece_id, title), daemon=True).start()
        return self._summary(meta)

    def piece(self, piece_id: str) -> dict:
        meta = self._read_meta(piece_id)
        payload = self._summary(meta)
        if not self._playable(meta) or not self.score_path(piece_id).exists():
            return payload
        score = parse_file(self.score_path(piece_id))
        assign_ids(score)
        heads = noteheads(score)
        start, end = measure_span(heads)
        payload.update(
            {
                "title": score_title(score, meta["title"]),
                "bpm": score_bpm(score),
                "notes": heads,
                "measureStart": start,
                "measureEnd": end,
                "explain": explain_score(score, score_bpm(score)),
            }
        )
        return payload

    def score_path(self, piece_id: str) -> Path:
        return self._folder(piece_id) / "score.musicxml"

    def reveal(self, piece_id: str) -> None:
        self._read_meta(piece_id)
        folder = self._folder(piece_id).resolve()
        root = self.root.resolve()
        if folder == root or not folder.is_relative_to(root) or not folder.is_dir():
            raise ScoreError("找不到这首曲子")
        if sys.platform != "darwin":
            raise ScoreError("这台电脑不能直接打开文件夹")
        try:
            subprocess.run(["open", str(folder)], check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ScoreError("文件夹没有打开") from exc

    def photo_path(self, piece_id: str, page: int | None = None) -> Path | None:
        self._read_meta(piece_id)
        if page is not None and page < 1:
            raise ScoreError("没有这一页")
        index = 1 if page is None else page
        folder = self._folder(piece_id)
        numbered = folder / "pages" / f"{index:03d}.png"
        if numbered.exists():
            return numbered
        if index == 1:
            for name in ("photo.png", "photo.jpg", "photo.jpeg"):
                path = folder / name
                if path.exists():
                    return path
        if page is not None:
            raise ScoreError("没有这一页")
        return None

    def redo_page(self, piece_id: str, page: int) -> dict:
        meta = self._read_meta(piece_id)
        self._require_page(meta, page)
        if self.photo_path(piece_id, page) is None:
            raise ScoreError("没有这一页")
        self._update_page(piece_id, page, status="waiting", error=None)
        self._start_job(piece_id, lambda: self._recognize_pages(piece_id, only=page))
        return self._summary(self._read_meta(piece_id))

    def replace_page(self, piece_id: str, page: int, data: bytes, filename: str) -> dict:
        meta = self._read_meta(piece_id)
        self._require_page(meta, page)
        if not data:
            raise ScoreError("没有收到照片")
        if len(data) > 12_000_000:
            raise ScoreError("这一页太大了")
        folder = self._folder(piece_id)
        pages_dir = folder / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}:
            suffix = ".img"
        original = pages_dir / f"{page:03d}{suffix}"
        original.write_bytes(data)
        try:
            omr.prepare_image(original, pages_dir / f"{page:03d}.png")
        finally:
            if original.suffix != ".png":
                original.unlink(missing_ok=True)
        legacy = folder / "photo.png"
        if page == 1 and legacy.exists() and legacy.resolve() != (pages_dir / "001.png").resolve():
            omr.prepare_image(pages_dir / "001.png", legacy)
        self._update_page(piece_id, page, status="waiting", error=None)
        self._start_job(piece_id, lambda: self._recognize_pages(piece_id, only=page))
        return self._summary(self._read_meta(piece_id))

    def edit(self, piece_id: str, note_id: str, semitone: int | None, duration: str | None) -> dict:
        meta = self._read_meta(piece_id)
        if not self._playable(meta):
            raise ScoreError("谱子还没准备好")
        score = parse_file(self.score_path(piece_id))
        assign_ids(score)
        score = edit_note(score, note_id, semitone=semitone, duration=duration)
        write_score(score, self.score_path(piece_id))
        title = score_title(score, meta["title"])
        self.update_meta(piece_id, title=title, status="ready", error=None)
        return self.piece(piece_id)

    def rename(self, piece_id: str, title: str) -> dict:
        cleaned = " ".join(title.split())[:40]
        if not cleaned:
            raise ScoreError("曲名不能是空的")
        meta = self._read_meta(piece_id)
        if meta.get("status") == "ready" and self.score_path(piece_id).exists():
            score = parse_file(self.score_path(piece_id))
            score = rename_title(score, cleaned)
            write_score(score, self.score_path(piece_id))
            cleaned = score_title(score, cleaned)
        self.update_meta(piece_id, title=cleaned)
        return self.piece(piece_id)

    def asks(self, piece_id: str) -> list[dict]:
        self._read_meta(piece_id)
        return self._read_asks(piece_id)

    def add_ask(self, piece_id: str, label: str, text: str, note_id: str | None) -> dict:
        self._read_meta(piece_id)
        cleaned_label = " ".join(label.split())[:80] or "记号"
        cleaned_text = text.strip()
        if not cleaned_text:
            raise ScoreError("没有可以记下的说明")
        entry = {
            "id": _new_id(),
            "at": _now(),
            "label": cleaned_label,
            "text": cleaned_text[:4000],
            "noteId": note_id,
        }
        with self._lock:
            items = self._read_asks(piece_id)
            items.insert(0, entry)
            del items[40:]
            path = self._folder(piece_id) / "asks.json"
            path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        return entry

    def _read_asks(self, piece_id: str) -> list[dict]:
        path = self._folder(piece_id) / "asks.json"
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def remove_note(self, piece_id: str, note_id: str) -> dict:
        meta = self._read_meta(piece_id)
        if not self._playable(meta):
            raise ScoreError("谱子还没准备好")
        score = parse_file(self.score_path(piece_id))
        assign_ids(score)
        score = remove_note(score, note_id)
        write_score(score, self.score_path(piece_id))
        return self.piece(piece_id)

    def delete(self, piece_id: str) -> None:
        folder = self._folder(piece_id)
        if not folder.exists():
            raise ScoreError("找不到这首曲子")
        shutil.rmtree(folder)

    def start_take(self, piece_id: str, wav: bytes, start_measure: int, end_measure: int) -> dict:
        meta = self._read_meta(piece_id)
        if not self._playable(meta):
            raise ScoreError("谱子还没准备好")
        if len(wav) < 1000:
            raise ScoreError("录音太短了。弹完选定的几小节再停止。")
        take_id = _new_id()
        folder = self._folder(piece_id) / "takes"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{take_id}.wav").write_bytes(wav)
        record = {
            "id": take_id,
            "status": "analyzing",
            "error": None,
            "startMeasure": start_measure,
            "endMeasure": end_measure,
            "result": None,
        }
        self._write_take(piece_id, take_id, record)
        threading.Thread(
            target=self._analyze,
            args=(piece_id, take_id, start_measure, end_measure),
            daemon=True,
        ).start()
        return record

    def take(self, piece_id: str, take_id: str) -> dict:
        path = self._take_path(piece_id, take_id)
        if not path.exists():
            raise ScoreError("找不到这次录音")
        return json.loads(path.read_text(encoding="utf-8"))

    def update_meta(self, piece_id: str, **changes) -> None:
        with self._lock:
            meta = self._read_meta(piece_id)
            meta.update(changes)
            self._write_meta_unlocked(piece_id, meta)

    def _create_from_score(self, score, fallback: str, source: str = "score") -> dict:
        piece_id = _new_id()
        folder = self._folder(piece_id)
        folder.mkdir(parents=True)
        assign_ids(score)
        write_score(score, folder / "score.musicxml")
        meta = {
            "id": piece_id,
            "title": score_title(score, fallback),
            "status": "ready",
            "error": None,
            "created": _now(),
            "hasPhoto": False,
            "source": source,
        }
        self._write_meta(piece_id, meta)
        return self.piece(piece_id)

    def _recognize_pages(self, piece_id: str, only: int | None = None) -> None:
        meta = self._read_meta(piece_id)
        pages = list(meta.get("pages") or [])
        if not pages:
            self.update_meta(piece_id, status="failed", error="没有可以识别的页")
            return
        if only is None:
            self.update_meta(piece_id, status="recognizing", error=None)
        for page in pages:
            if only is not None and page["index"] != only:
                continue
            self._update_page(piece_id, page["index"], status="recognizing", error=None)
            image = self.photo_path(piece_id, page["index"])
            dest = self._folder(piece_id) / "pages" / f"{page['index']:03d}.musicxml"
            try:
                if image is None:
                    raise OmrError("找不到这一页的照片")
                with self._homr:
                    omr.recognize(image, dest)
                score = parse_file(dest)
                if not noteheads(score):
                    raise OmrError("这一页没有认出音符")
                write_score(score, dest)
                self._update_page(piece_id, page["index"], status="ready", error=None)
            except Exception as exc:
                message = str(exc) if isinstance(exc, (OmrError, ScoreError)) else "这一页识谱时出了问题"
                self._update_page(
                    piece_id,
                    page["index"],
                    status="failed",
                    error=message,
                    measureStart=None,
                    measureEnd=None,
                )
        self._merge_ready_pages(piece_id)

    def _merge_ready_pages(self, piece_id: str) -> None:
        meta = self._read_meta(piece_id)
        pages = list(meta.get("pages") or [])
        ready = [page for page in pages if page.get("status") == "ready"]
        failed = [page for page in pages if page.get("status") == "failed"]
        scores = []
        kept = []
        for page in ready:
            path = self._folder(piece_id) / "pages" / f"{page['index']:03d}.musicxml"
            try:
                scores.append(parse_file(path))
                kept.append(page)
            except ScoreError as exc:
                self._update_page(
                    piece_id,
                    page["index"],
                    status="failed",
                    error=str(exc),
                    measureStart=None,
                    measureEnd=None,
                )
                failed.append({**page, "status": "failed"})
        if not scores:
            message = "；".join(
                f"第 {page['index']} 页：{page.get('error') or '没有成功'}" for page in failed
            ) or "识谱没有成功"
            self.update_meta(piece_id, status="failed", error=message)
            return
        merged, spans = merge_page_scores(scores)
        assign_ids(merged)
        title = meta.get("title") or "未命名曲子"
        if merged.metadata is None:
            from music21 import metadata as m21metadata

            merged.metadata = m21metadata.Metadata()
        merged.metadata.title = title
        write_score(merged, self.score_path(piece_id))
        for page, span in zip(kept, spans):
            if span is None:
                self._update_page(piece_id, page["index"], measureStart=None, measureEnd=None)
            else:
                self._update_page(
                    piece_id,
                    page["index"],
                    measureStart=span[0],
                    measureEnd=span[1],
                )
        if failed:
            which = "、".join(str(page["index"]) for page in failed)
            self.update_meta(
                piece_id,
                status="partial",
                error=f"第 {which} 页没有识别成功，其余页已经按顺序拼好。",
            )
        else:
            self.update_meta(piece_id, status="ready", error=None)

    def _notate(self, piece_id: str, title: str) -> None:
        try:
            events = transcribe.transcribe_wav(self._folder(piece_id) / "improv.wav", purpose="improv")
            score = notes_to_score(events, title)
            assign_ids(score)
            if not noteheads(score):
                raise NotateError("没有听出钢琴的音。把电脑靠近钢琴，再弹一遍。")
            write_score(score, self.score_path(piece_id))
            self.update_meta(piece_id, status="ready", error=None, title=score_title(score, title))
        except Exception as exc:
            message = (
                str(exc)
                if isinstance(exc, (TranscribeError, ScoreError, NotateError))
                else "没能把这段弹的写成谱，请再录一次。"
            )
            self.update_meta(piece_id, status="failed", error=message)

    def _analyze(self, piece_id: str, take_id: str, start_measure: int, end_measure: int) -> None:
        try:
            events = transcribe.transcribe_wav(self._folder(piece_id) / "takes" / f"{take_id}.wav")
            score = parse_file(self.score_path(piece_id))
            assign_ids(score)
            result = align_performance(
                noteheads(score),
                events,
                start_measure=start_measure,
                end_measure=end_measure,
            )
            record = self.take(piece_id, take_id)
            record.update({"status": "ready", "error": None, "result": result})
            self._write_take(piece_id, take_id, record)
        except Exception as exc:
            message = str(exc) if isinstance(exc, (TranscribeError, ScoreError)) else "听音分析没有完成，请再录一次。"
            record = self.take(piece_id, take_id)
            record.update({"status": "failed", "error": message, "result": None})
            self._write_take(piece_id, take_id, record)

    def _summary(self, meta: dict) -> dict:
        pages = self._pages_view(meta)
        return {
            "id": meta["id"],
            "title": meta.get("title") or "未命名曲子",
            "status": meta.get("status") or "ready",
            "error": meta.get("error"),
            "created": meta.get("created"),
            "hasPhoto": bool(meta.get("hasPhoto")) or bool(pages),
            "source": meta.get("source") or "score",
            "pageCount": len(pages),
            "pages": pages,
        }

    def _pages_view(self, meta: dict) -> list[dict]:
        stored = meta.get("pages")
        if isinstance(stored, list) and stored:
            return [dict(page) for page in stored if isinstance(page, dict)]
        piece_id = meta.get("id")
        if not piece_id:
            return []
        try:
            folder = self._folder(piece_id)
        except ScoreError:
            return []
        legacy = any((folder / name).exists() for name in ("photo.png", "photo.jpg", "photo.jpeg"))
        numbered = sorted((folder / "pages").glob("[0-9][0-9][0-9].png")) if (folder / "pages").is_dir() else []
        if not legacy and not numbered:
            return []
        status = meta.get("status") or "ready"
        if status == "recognizing":
            page_status = "recognizing"
        elif status == "failed":
            page_status = "failed"
        else:
            page_status = "ready"
        count = len(numbered) or 1
        return [
            {
                "index": index,
                "status": page_status,
                "error": meta.get("error") if page_status == "failed" else None,
                "measureStart": 1 if page_status == "ready" and count == 1 else None,
                "measureEnd": None,
            }
            for index in range(1, count + 1)
        ]

    def _playable(self, meta: dict) -> bool:
        return meta.get("status") in {"ready", "partial"}

    def _require_page(self, meta: dict, page: int) -> None:
        pages = self._pages_view(meta)
        if page < 1 or not any(item.get("index") == page for item in pages):
            raise ScoreError("没有这一页")
        if not meta.get("pages"):
            meta["pages"] = pages
            self._write_meta(meta["id"], meta)

    def _update_page(self, piece_id: str, index: int, **changes) -> None:
        with self._lock:
            meta = self._read_meta(piece_id)
            pages = meta.get("pages")
            if not isinstance(pages, list):
                pages = self._pages_view(meta)
                meta["pages"] = pages
            found = False
            for page in pages:
                if page.get("index") == index:
                    page.update(changes)
                    found = True
            if not found:
                raise ScoreError("没有这一页")
            self._write_meta_unlocked(piece_id, meta)

    def _start_job(self, piece_id: str, target) -> None:
        with self._lock:
            if piece_id in self._jobs:
                raise ScoreError("这首正在识别，请等这一轮结束。")
            self._jobs.add(piece_id)

        def run() -> None:
            try:
                target()
            finally:
                with self._lock:
                    self._jobs.discard(piece_id)

        threading.Thread(target=run, daemon=True).start()

    def _folder(self, piece_id: str) -> Path:
        if not piece_id or any(char not in "abcdef0123456789" for char in piece_id):
            raise ScoreError("找不到这首曲子")
        folder = self.root / piece_id
        if not folder.resolve().is_relative_to(self.root.resolve()):
            raise ScoreError("找不到这首曲子")
        return folder

    def _read_meta(self, piece_id: str) -> dict:
        path = self._folder(piece_id) / "meta.json"
        if not path.exists():
            raise ScoreError("找不到这首曲子")
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_meta(self, piece_id: str, meta: dict) -> None:
        with self._lock:
            self._write_meta_unlocked(piece_id, meta)

    def _write_meta_unlocked(self, piece_id: str, meta: dict) -> None:
        path = self._folder(piece_id) / "meta.json"
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    def _take_path(self, piece_id: str, take_id: str) -> Path:
        if any(char not in "abcdef0123456789" for char in take_id):
            raise ScoreError("找不到这次录音")
        return self._folder(piece_id) / "takes" / f"{take_id}.json"

    def _write_take(self, piece_id: str, take_id: str, record: dict) -> None:
        path = self._take_path(piece_id, take_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")


def _blank_page(index: int) -> dict:
    return {
        "index": index,
        "status": "waiting",
        "error": None,
        "measureStart": None,
        "measureEnd": None,
    }


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
