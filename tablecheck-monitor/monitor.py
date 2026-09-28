#!/usr/bin/env python3
"""Uno Mas / TableCheck availability monitor with Telegram alerts.

Read-only: checks public availability endpoints and notifies you.
Does not create reservations.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

from tablecheck_client import AvailableSlot, TableCheckClient, booking_days

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "state.json"


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    return int(raw)


def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    return float(raw)


def load_config() -> dict:
    load_dotenv(ROOT / ".env")
    shop = os.getenv("SHOP_SLUG", "centara-mirage-beach-resort-dubai-uno-mas").strip()
    return {
        "shop_slug": shop,
        "booking_url": os.getenv(
            "BOOKING_URL",
            f"https://www.tablecheck.com/en/shops/{shop}/reserve",
        ).strip(),
        "adults": env_int("NUM_ADULTS", 4),
        "children": env_int("NUM_CHILDREN", 2),
        "seniors": env_int("NUM_SENIORS", 0),
        "babies": env_int("NUM_BABIES", 0),
        "days": env_int("DAYS", 2),
        "interval": env_int("CHECK_INTERVAL_SEC", 900),
        "meal_filter": os.getenv("MEAL_FILTER", "all").strip() or "all",
        "timezone": os.getenv("TIMEZONE", "Asia/Dubai").strip() or "Asia/Dubai",
        "min_hours_before": env_float("MIN_HOURS_BEFORE", 5.0),
        "telegram_token": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        "telegram_chat_id": os.getenv("TELEGRAM_CHAT_ID", "").strip(),
    }


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"notified": {}, "last_check": None}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"notified": {}, "last_check": None}


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def slot_key(item: AvailableSlot) -> str:
    return f"{item.slot.day.isoformat()}|{item.slot.epoch}|{item.slot.label}"


def format_slots(items: list[AvailableSlot], tz: ZoneInfo) -> str:
    lines: list[str] = []
    for item in items:
        local = item.slot.dubai_dt(tz)
        lines.append(
            f"• {local.strftime('%a %Y-%m-%d %H:%M')} ({item.slot.label})"
        )
    return "\n".join(lines)


def send_telegram(token: str, chat_id: str, text: str) -> None:
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping notify")
        print(text)
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    resp = requests.post(
        url,
        json={
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": False,
        },
        timeout=30,
    )
    resp.raise_for_status()


def party_label(cfg: dict) -> str:
    parts = [f"{cfg['adults']} adults"]
    if cfg["children"]:
        parts.append(f"{cfg['children']} children")
    if cfg["seniors"]:
        parts.append(f"{cfg['seniors']} seniors")
    if cfg["babies"]:
        parts.append(f"{cfg['babies']} babies")
    return ", ".join(parts)


def run_once(cfg: dict, *, notify_empty: bool = False) -> list[AvailableSlot]:
    tz = ZoneInfo(cfg["timezone"])
    client = TableCheckClient(cfg["shop_slug"])
    client.warm_up()
    days = booking_days(cfg["days"], tz)
    found = client.find_available(
        days,
        adults=cfg["adults"],
        children=cfg["children"],
        seniors=cfg["seniors"],
        babies=cfg["babies"],
        tz=tz,
        min_hours_before=cfg["min_hours_before"],
        meal_filter=cfg["meal_filter"],
    )

    now = datetime.now(tz)
    print(
        f"[{now.isoformat(timespec='seconds')}] "
        f"checked {days[0]}..{days[-1]} for {party_label(cfg)} "
        f"meal={cfg['meal_filter']}: {len(found)} available"
    )
    if found:
        print(format_slots(found, tz))
    elif notify_empty:
        print("No available slots in the current booking window.")
    return found


def notify_new(cfg: dict, found: list[AvailableSlot]) -> None:
    tz = ZoneInfo(cfg["timezone"])
    state = load_state()
    notified: dict = state.setdefault("notified", {})
    new_items = [item for item in found if slot_key(item) not in notified]

    # Drop stale keys older than 3 days
    cutoff = datetime.now(tz).timestamp() - 3 * 24 * 3600
    for key in list(notified):
        try:
            epoch = int(key.split("|")[1])
        except (IndexError, ValueError):
            del notified[key]
            continue
        if epoch < cutoff:
            del notified[key]

    if new_items:
        text = (
            "Uno Mas — появились свободные столики!\n"
            f"Состав: {party_label(cfg)}\n"
            f"{format_slots(new_items, tz)}\n\n"
            f"Бронировать: {cfg['booking_url']}\n"
            "Окно бронирования обычно ~24 часа до визита."
        )
        send_telegram(cfg["telegram_token"], cfg["telegram_chat_id"], text)
        for item in new_items:
            notified[slot_key(item)] = datetime.now(tz).isoformat(timespec="seconds")
        print(f"Notified about {len(new_items)} new slot(s).")
    else:
        print("No new slots since last notification.")

    state["last_check"] = datetime.now(tz).isoformat(timespec="seconds")
    state["last_available"] = [slot_key(i) for i in found]
    save_state(state)


def cmd_check(cfg: dict) -> int:
    found = run_once(cfg, notify_empty=True)
    return 0 if found is not None else 1


def cmd_watch(cfg: dict) -> int:
    print(
        f"Watching {cfg['shop_slug']} every {cfg['interval']}s "
        f"for {party_label(cfg)} (Ctrl+C to stop)"
    )
    while True:
        try:
            found = run_once(cfg)
            notify_new(cfg, found)
        except Exception as exc:  # noqa: BLE001 — keep watcher alive
            print(f"Check failed: {exc}", file=sys.stderr)
        time.sleep(max(60, cfg["interval"]))


def cmd_notify_test(cfg: dict) -> int:
    send_telegram(
        cfg["telegram_token"],
        cfg["telegram_chat_id"],
        "Uno Mas monitor: test message OK",
    )
    print("Test message sent.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Monitor Uno Mas (TableCheck) table availability"
    )
    parser.add_argument(
        "command",
        choices=("check", "watch", "notify-test"),
        help="check once | watch loop | send Telegram test",
    )
    args = parser.parse_args(argv)
    cfg = load_config()

    if args.command == "check":
        return cmd_check(cfg)
    if args.command == "watch":
        return cmd_watch(cfg)
    if args.command == "notify-test":
        return cmd_notify_test(cfg)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
