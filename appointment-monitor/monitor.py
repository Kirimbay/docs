#!/usr/bin/env python3
"""CLI-монитор (один пользователь через .env). Для бота используйте bot.py."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

from zdrav_client import (
    BOOKING_URL,
    DoctorsQuery,
    Polis,
    ZdravClient,
    available_slots,
    collect_doctors,
    collect_hospitals,
    fingerprint,
    format_slots,
    working_days,
)

STATE_FILE = Path(__file__).resolve().parent / "state.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("appointment-monitor")


@dataclass
class EnvConfig:
    polis: Polis
    query: DoctorsQuery
    check_interval_sec: int
    telegram_bot_token: str
    telegram_chat_id: str
    booking_url: str

    @classmethod
    def from_env(cls) -> "EnvConfig":
        load_dotenv()
        oms = os.getenv("OMS_NUMBER", "").strip()
        birthday = os.getenv("OMS_BIRTHDAY", "").strip()
        if not oms or not birthday:
            raise SystemExit("Заполните OMS_NUMBER и OMS_BIRTHDAY в .env")
        return cls(
            polis=Polis.parse(oms, birthday),
            query=DoctorsQuery(
                department_id=os.getenv("DEPARTMENT_ID", "").strip(),
                lpu_code=os.getenv("LPU_CODE", "").strip(),
                doctor_id=os.getenv("DOCTOR_ID", "").strip(),
                days=int(os.getenv("DAYS", "21")),
            ),
            check_interval_sec=int(os.getenv("CHECK_INTERVAL_SEC", "300")),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
            telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip(),
            booking_url=os.getenv("BOOKING_URL", BOOKING_URL).strip(),
        )


def send_telegram(token: str, chat_id: str, text: str) -> None:
    if not token or not chat_id:
        log.warning("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — только лог:")
        print(text)
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    chunks = [text[i : i + 3500] for i in range(0, len(text), 3500)] or [text]
    for chunk in chunks:
        response = requests.post(
            url,
            json={"chat_id": chat_id, "text": chunk, "disable_web_page_preview": True},
            timeout=30,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Telegram error {response.status_code}: {response.text[:300]}"
            )


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"last_total": 0, "fingerprint": ""}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"last_total": 0, "fingerprint": ""}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def check_once(config: EnvConfig, *, force_notify: bool = False) -> int:
    if not config.query.department_id:
        raise SystemExit(
            "Укажите DEPARTMENT_ID в .env (python monitor.py departments)."
        )
    client = ZdravClient(config.polis, days=config.query.days)
    client.auth()
    payload = client.doctors(config.query)
    slots = available_slots(payload, config.query.doctor_id)
    total = sum(s["count_tickets"] for s in slots)
    fp = fingerprint(slots)
    state = load_state()
    prev_total = int(state.get("last_total") or 0)
    prev_fp = state.get("fingerprint") or ""

    log.info("Свободно %s талонов у %s врачей (было %s)", total, len(slots), prev_total)
    should_notify = force_notify or (
        total > 0 and (total > prev_total or fp != prev_fp)
    )
    if should_notify and total > 0:
        send_telegram(
            config.telegram_bot_token,
            config.telegram_chat_id,
            format_slots(slots, booking_url=config.booking_url),
        )
    save_state(
        {
            "last_total": total,
            "fingerprint": fp,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="CLI монитор zdrav.mosreg.ru")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("departments")
    p_h = sub.add_parser("hospitals")
    p_h.add_argument("department_id", nargs="?", default="")
    p_d = sub.add_parser("doctors")
    p_d.add_argument("department_id", nargs="?", default="")
    p_d.add_argument("lpu_code", nargs="?", default="")
    sub.add_parser("check")
    sub.add_parser("watch")
    sub.add_parser("notify-test")
    args = parser.parse_args()
    config = EnvConfig.from_env()
    client = ZdravClient(config.polis, days=config.query.days)

    if args.command == "departments":
        client.auth()
        for item in client.departments():
            print(f"{item.get('id')}\t{item.get('title')} (код {item.get('code')})")
    elif args.command == "hospitals":
        dep = args.department_id or config.query.department_id
        if not dep:
            raise SystemExit("Укажите department_id")
        client.auth()
        payload = client.doctors(DoctorsQuery(department_id=dep, days=config.query.days))
        for h in collect_hospitals(payload):
            print(f"{h['code']}\t{h['name']}")
            if h["address"]:
                print(f"\t{h['address']}")
    elif args.command == "doctors":
        dep = args.department_id or config.query.department_id
        lpu = args.lpu_code or config.query.lpu_code
        if not dep:
            raise SystemExit("Укажите department_id")
        client.auth()
        payload = client.doctors(
            DoctorsQuery(department_id=dep, lpu_code=lpu, days=config.query.days)
        )
        for doc in collect_doctors(payload):
            print(f"{doc['id']}\t{doc['display_name']}\t{doc['tickets']}")
        slots = available_slots(payload)
        if slots:
            print("\n" + format_slots(slots, booking_url=config.booking_url))
    elif args.command == "check":
        check_once(config, force_notify=True)
    elif args.command == "watch":
        log.info("Мониторинг каждые %s сек", config.check_interval_sec)
        while True:
            try:
                check_once(config)
            except KeyboardInterrupt:
                raise
            except Exception as exc:  # noqa: BLE001
                log.error("%s", exc)
            time.sleep(config.check_interval_sec)
    elif args.command == "notify-test":
        send_telegram(
            config.telegram_bot_token,
            config.telegram_chat_id,
            "✅ Тест CLI-монитора работает.",
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log.info("Остановлено.")
        raise SystemExit(0)
