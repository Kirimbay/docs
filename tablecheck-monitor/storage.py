"""Persistent state for Uno Mas TableCheck monitor."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "state.json"
CHAT_ID_PATH = DATA_DIR / "chat_id.txt"


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {
            "monitoring_enabled": False,
            "notified": {},
            "last_check": None,
            "last_available": [],
            "owner_chat_id": None,
        }
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    data.setdefault("monitoring_enabled", False)
    data.setdefault("notified", {})
    data.setdefault("last_check", None)
    data.setdefault("last_available", [])
    data.setdefault("owner_chat_id", None)
    return data


def save_state(state: dict) -> None:
    ensure_data_dir()
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def is_monitoring_enabled() -> bool:
    return bool(load_state().get("monitoring_enabled"))


def set_monitoring_enabled(enabled: bool) -> dict:
    state = load_state()
    state["monitoring_enabled"] = bool(enabled)
    save_state(state)
    return state


def persist_chat_id(chat_id: str | int) -> None:
    ensure_data_dir()
    chat_id_s = str(chat_id).strip()
    CHAT_ID_PATH.write_text(chat_id_s + "\n", encoding="utf-8")
    state = load_state()
    state["owner_chat_id"] = chat_id_s
    save_state(state)

    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    lines = env_path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    replaced = False
    for line in lines:
        if line.startswith("TELEGRAM_CHAT_ID="):
            out.append(f"TELEGRAM_CHAT_ID={chat_id_s}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"TELEGRAM_CHAT_ID={chat_id_s}")
    env_path.write_text("\n".join(out) + "\n", encoding="utf-8")


def load_chat_id() -> str | None:
    state = load_state()
    if state.get("owner_chat_id"):
        return str(state["owner_chat_id"])
    if CHAT_ID_PATH.exists():
        return CHAT_ID_PATH.read_text(encoding="utf-8").strip() or None
    return None
