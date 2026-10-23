from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def data_dir() -> Path:
    override = os.environ.get("PIANO_DATA")
    root = Path(override) if override else ROOT / "data"
    root.mkdir(parents=True, exist_ok=True)
    return root


def pieces_dir() -> Path:
    path = data_dir() / "pieces"
    path.mkdir(parents=True, exist_ok=True)
    return path


def models_dir() -> Path:
    path = data_dir() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def config_path() -> Path:
    return data_dir() / "config.json"


def env_path() -> Path:
    override = os.environ.get("PIANO_ENV_FILE")
    return Path(override) if override else ROOT / ".env"


def frontend_dist() -> Path:
    return ROOT / "frontend" / "dist"
