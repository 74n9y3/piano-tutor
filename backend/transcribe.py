from __future__ import annotations

import shutil
import threading
import urllib.request
from pathlib import Path

from backend.i18n import t
from backend.i18n import t
from backend.paths import models_dir

MODEL_URL = (
    "https://zenodo.org/records/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
MIN_BYTES = 160_000_000

_lock = threading.Lock()
_transcriber = None


class TranscribeError(Exception):
    pass


def checkpoint_path() -> Path:
    return models_dir() / "note_F1=0.9677_pedal_F1=0.9186.pth"


def ensure_checkpoint() -> Path:
    path = checkpoint_path()
    if path.exists() and path.stat().st_size >= MIN_BYTES:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".part")
    request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "piano-tutor"})
    try:
        with urllib.request.urlopen(request, timeout=600) as response, temporary.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise TranscribeError(t("model_download_failed")) from exc
    if temporary.stat().st_size < MIN_BYTES:
        temporary.unlink(missing_ok=True)
        raise TranscribeError(t("model_incomplete"))
    temporary.replace(path)
    return path


def transcribe_wav(path: Path, *, purpose: str = "practice") -> list[dict]:
    try:
        import torch
        from piano_transcription_inference import PianoTranscription, sample_rate
    except ImportError as exc:
        raise TranscribeError(
            t("model_missing")
        ) from exc

    _patch_torch_load(torch)
    checkpoint = ensure_checkpoint()
    try:
        audio = _read_wav(path, sample_rate)
    except TranscribeError:
        raise
    except Exception as exc:
        raise TranscribeError(t("wav_unreadable")) from exc
    if audio is None or len(audio) < sample_rate * 0.25:
        if purpose == "improv":
            raise TranscribeError(t("take_too_short"))
        raise TranscribeError(t("take_too_short_range"))

    global _transcriber
    with _lock:
        if _transcriber is None:
            _transcriber = PianoTranscription(device=torch.device("cpu"), checkpoint_path=str(checkpoint))
        midi_path = str(path.with_suffix(".mid"))
        result = _transcriber.transcribe(audio, midi_path)

    events = []
    for item in result.get("est_note_events") or []:
        event = {
            "midi": int(item["midi_note"]),
            "onset": float(item["onset_time"]),
            "offset": float(item["offset_time"]),
        }
        if "velocity" in item:
            event["velocity"] = int(item["velocity"])
        events.append(event)
    events.sort(key=lambda item: (item["onset"], item["midi"]))
    return events


def _read_wav(path: Path, target_rate: int):
    import wave

    import numpy as np

    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width != 2 or channels < 1:
        raise TranscribeError(t("wav_unreadable"))
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != target_rate:
        audio = _resample(np.ascontiguousarray(audio), rate, target_rate)
    return np.ascontiguousarray(audio, dtype=np.float32)


def _resample(audio, orig_sr: int, target_sr: int):
    """Resample without librosa. Its first import asks numba for a source cache."""
    from math import gcd

    import numpy as np
    from scipy.signal import resample_poly

    divisor = gcd(int(orig_sr), int(target_sr))
    converted = resample_poly(audio, int(target_sr) // divisor, int(orig_sr) // divisor)
    return np.ascontiguousarray(converted, dtype=np.float32)


def model_installed() -> bool:
    try:
        import piano_transcription_inference  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def _patch_torch_load(torch_module) -> None:
    if getattr(torch_module.load, "_piano_tutor_patched", False):
        return
    original = torch_module.load

    def load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original(*args, **kwargs)

    load._piano_tutor_patched = True
    torch_module.load = load
