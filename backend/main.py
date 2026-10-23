from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel, Field

from backend import omr, transcribe
from backend.omr import OmrError
from backend.paths import frontend_dist
from backend.notate import NotateError
from backend.score_ops import ScoreError
from backend.store import Store
from backend.i18n import lang_from_header, localize_take, set_lang, t
from backend.i18n import lang_from_header, localize_take, set_lang, t
from backend.vision import config_status, explain_marks

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/xml", ".musicxml")


class AskBody(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)
    noteId: str | None = Field(default=None, max_length=40)


class TitleBody(BaseModel):
    title: str = Field(min_length=1, max_length=40)


class EditBody(BaseModel):
    semitone: int | None = None
    duration: str | None = None


class SymbolIn(BaseModel):
    code: str = Field(max_length=40)
    detail: str | None = Field(default=None, max_length=40)


class MarkIn(BaseModel):
    kind: str
    clef: str | None = None
    time: str | None = None
    sharps: int | None = None
    name: str | None = None
    duration: str | None = None
    dots: int | None = None
    quarters: float | None = None
    accidental: str | None = None
    articulation: str | None = None
    symbols: list[SymbolIn] = Field(default_factory=list, max_length=8)
    measure: int | None = None
    hand: str | None = None


class MarksBody(BaseModel):
    marks: list[MarkIn] = Field(min_length=1, max_length=8)


def create_app(store: Store | None = None) -> FastAPI:
    app = FastAPI(title="钢琴陪练")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    pieces = store or Store()

    @app.middleware("http")
    async def use_language(request: Request, call_next):
        header = request.headers.get("x-lang") or request.headers.get("accept-language")
        set_lang(lang_from_header(header))
        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "omr": omr.find_uvx() is not None,
            "transcribe": transcribe.model_installed(),
            **config_status(),
        }

    @app.get("/api/pieces")
    def list_pieces():
        return pieces.list_pieces()

    @app.post("/api/pieces/sample")
    def create_sample():
        return pieces.create_sample()

    @app.post("/api/pieces/musicxml")
    async def create_musicxml(file: UploadFile = File(...)):
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail=t("empty_file"))
        try:
            return pieces.create_from_musicxml(data, file.filename or "score.musicxml")
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/pieces/midi")
    async def create_midi(file: UploadFile = File(...)):
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail=t("empty_file"))
        try:
            return pieces.create_from_midi(data, file.filename or "score.mid")
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/pieces/photo")
    async def create_photo(
        file: UploadFile | None = File(default=None),
        files: list[UploadFile] = File(default=[]),
        title: str = Form(default=""),
    ):
        uploads = list(files or [])
        if file is not None:
            uploads.append(file)
        if not uploads:
            raise HTTPException(status_code=400, detail=t("no_photo"))
        payload: list[tuple[bytes, str]] = []
        for upload in uploads:
            data = await upload.read()
            payload.append((data, upload.filename or "score.png"))
        try:
            return pieces.create_from_photos(payload, title)
        except (OmrError, ScoreError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/pieces/improv")
    async def create_improv(file: UploadFile = File(...)):
        data = await file.read()
        try:
            return pieces.create_from_improv(data)
        except (ScoreError, NotateError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/pieces/{piece_id}")
    def get_piece(piece_id: str):
        try:
            return pieces.piece(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/pieces/{piece_id}/folder")
    def open_piece_folder(piece_id: str, request: Request):
        host = request.client.host if request.client else ""
        if host not in {"127.0.0.1", "::1", "testclient"}:
            raise HTTPException(status_code=403, detail=t("folder_local_only"))
        try:
            pieces.reveal(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True}

    @app.get("/api/pieces/{piece_id}/score")
    def get_score(piece_id: str):
        try:
            path = pieces.score_path(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not path.exists():
            raise HTTPException(status_code=404, detail=t("score_not_ready"))
        return Response(content=path.read_bytes(), media_type="application/xml")

    @app.get("/api/pieces/{piece_id}/photo")
    def get_photo(piece_id: str, page: int | None = None):
        try:
            path = pieces.photo_path(piece_id, page)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if path is None:
            raise HTTPException(status_code=404, detail=t("no_photo_piece"))
        return FileResponse(path)

    @app.post("/api/pieces/{piece_id}/pages/{page}/recognize")
    def rerecognize_page(piece_id: str, page: int):
        try:
            return pieces.redo_page(piece_id, page)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/pieces/{piece_id}/pages/{page}/image")
    async def replace_page_image(piece_id: str, page: int, file: UploadFile = File(...)):
        data = await file.read()
        try:
            return pieces.replace_page(piece_id, page, data, file.filename or "page.png")
        except (OmrError, ScoreError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/pieces/{piece_id}/asks")
    def list_asks(piece_id: str):
        try:
            return pieces.asks(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/pieces/{piece_id}/asks")
    def create_ask(piece_id: str, body: AskBody):
        try:
            return pieces.add_ask(piece_id, body.label, body.text, body.noteId)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/pieces/{piece_id}")
    def rename_piece(piece_id: str, body: TitleBody):
        try:
            return pieces.rename(piece_id, body.title)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/pieces/{piece_id}/notes/{note_id}")
    def edit_note(piece_id: str, note_id: str, body: EditBody):
        if body.semitone not in (None, -1, 1):
            raise HTTPException(status_code=400, detail=t("one_semitone"))
        if body.duration not in (None, "whole", "half", "quarter", "eighth"):
            raise HTTPException(status_code=400, detail=t("bad_duration"))
        if body.semitone is None and body.duration is None:
            raise HTTPException(status_code=400, detail=t("nothing_to_edit"))
        try:
            return pieces.edit(piece_id, note_id, body.semitone, body.duration)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/pieces/{piece_id}/notes/{note_id}")
    def delete_note(piece_id: str, note_id: str):
        try:
            return pieces.remove_note(piece_id, note_id)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/pieces/{piece_id}/explain/marks")
    def explain_score_marks(piece_id: str, body: MarksBody):
        try:
            pieces.piece(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return explain_marks([mark.model_dump() for mark in body.marks])

    @app.post("/api/pieces/{piece_id}/takes")
    async def create_take(
        piece_id: str,
        file: UploadFile = File(...),
        start_measure: int = Form(...),
        end_measure: int = Form(...),
    ):
        data = await file.read()
        try:
            return pieces.start_take(piece_id, data, start_measure, end_measure)
        except ScoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/pieces/{piece_id}/takes/{take_id}")
    def get_take(piece_id: str, take_id: str):
        try:
            return localize_take(pieces.take(piece_id, take_id))
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/api/pieces/{piece_id}")
    def delete_piece(piece_id: str):
        try:
            pieces.delete(piece_id)
        except ScoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True}

    dist = frontend_dist()

    @app.get("/")
    def index():
        page = dist / "index.html"
        if page.exists():
            return FileResponse(page)
        return HTMLResponse(_missing_frontend())

    @app.get("/{asset_path:path}")
    def frontend_asset(asset_path: str):
        if asset_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=t("no_route"))
        file_path = _safe_file(dist, asset_path)
        if file_path is not None:
            return FileResponse(file_path)
        if "." in Path(asset_path).name:
            raise HTTPException(status_code=404, detail=t("no_file"))
        page = dist / "index.html"
        if page.exists():
            return FileResponse(page)
        return HTMLResponse(_missing_frontend(), status_code=404)

    return app


def _safe_file(dist: Path, asset_path: str) -> Path | None:
    if not dist.is_dir():
        return None
    candidate = (dist / asset_path).resolve()
    if not candidate.is_relative_to(dist.resolve()) or not candidate.is_file():
        return None
    return candidate


def _missing_frontend() -> str:
    return (
        f"<!doctype html><meta charset='utf-8'><title>{t('app_title')}</title>"
        f"<p style='font-family:sans-serif'>{t('frontend_missing')}</p>"
    )


app = create_app()
