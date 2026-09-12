from __future__ import annotations

import os
from pathlib import Path

import yaml

from .models import AppConfig

DEFAULT_CONFIG_PATH = Path(os.environ.get("HIDDIFY_HUB_CONFIG", "config/servers.yaml"))


def load_config(path: Path | None = None) -> AppConfig:
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        example = config_path.parent / "servers.example.yaml"
        raise FileNotFoundError(
            f"Config not found: {config_path}. Copy {example} to {config_path} and edit it."
        )
    with config_path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return AppConfig.model_validate(raw)


def config_to_dict(config: AppConfig) -> dict:
    return config.model_dump()
