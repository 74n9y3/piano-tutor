from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps


class OmrError(Exception):
    pass


def prepare_image(src: Path, dest: Path) -> None:
    try:
        with Image.open(src) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.mode == "RGBA":
                background = Image.new("RGB", image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1])
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            width, height = image.size
            long_edge = max(width, height)
            if long_edge > 3600:
                scale = 3600 / long_edge
                image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            image.save(dest, "PNG")
    except Exception as exc:
        raise OmrError("这张图片打不开。请换一张 JPG 或 PNG。") from exc


def find_uvx() -> str | None:
    found = shutil.which("uvx")
    if found:
        return found
    for candidate in (Path("/opt/homebrew/bin/uvx"), Path.home() / ".local" / "bin" / "uvx"):
        if candidate.is_file():
            return str(candidate)
    return None


def recognize(image_path: Path, dest_xml: Path) -> None:
    """Run homr in its own environment. The first photo downloads the models."""
    uvx = find_uvx()
    if uvx is None:
        raise OmrError("没有找到 uv，暂时不能识谱。请先安装 uv，或改用 MusicXML 导入。")
    work = image_path.parent / "omr-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    prepared = work / "page.png"
    prepare_image(image_path, prepared)
    try:
        completed = subprocess.run(
            [uvx, "--python", "3.12", "--from", "homr", "homr", str(prepared)],
            cwd=work,
            capture_output=True,
            text=True,
            timeout=1200,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise OmrError("识谱超过 20 分钟还没结束。可以先裁成一页最清楚的谱子再试。") from exc
    candidates = [
        path
        for path in work.iterdir()
        if path.suffix.lower() in {".xml", ".musicxml"} and path.is_file()
    ]
    if completed.returncode != 0 or not candidates:
        detail = _tail(completed.stderr or completed.stdout)
        message = "识谱没有成功。请换一张平整、光线均匀的照片，让五线谱尽量占满画面。"
        if detail:
            message = f"{message}\n{detail}"
        raise OmrError(message)
    best = max(candidates, key=lambda path: path.stat().st_mtime)
    dest_xml.parent.mkdir(parents=True, exist_ok=True)
    dest_xml.write_bytes(best.read_bytes())


def _tail(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or "SyntaxWarning" in stripped or stripped.startswith("warning:"):
            continue
        if "Possible attributes" in stripped:
            continue
        lines.append(stripped)
    if not lines:
        return ""
    return "\n".join(lines[-8:])[-1200:]
