#!/usr/bin/env python3
"""
Монитор свободных талонов на zdrav.mosreg.ru (Московская область).

Только читает расписание и шлёт оповещение в Telegram — запись не создаёт.
Запускайте на своём компьютере или VPS в РФ: портал может быть недоступен из-за рубежа.
"""

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
from typing import Any

import requests
import urllib3
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://zdrav.mosreg.ru"
STATE_FILE = Path(__file__).resolve().parent / "state.json"
WEEKEND_TYPE = 0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("appointment-monitor")


@dataclass
class Config:
    oms_number: str
    oms_birthday: str  # DD.MM.YYYY
    department_id: str
    lpu_code: str
    doctor_id: str
    days: int
    check_interval_sec: int
    telegram_bot_token: str
    telegram_chat_id: str
    booking_url: str

    @property
    def birthday_iso(self) -> str:
        day, month, year = self.oms_birthday.split(".")
        return f"{year}-{month}-{day}"

    @classmethod
    def from_env(cls) -> "Config":
        load_dotenv()
        oms = "".join(ch for ch in os.getenv("OMS_NUMBER", "") if ch.isdigit())
        birthday = os.getenv("OMS_BIRTHDAY", "").strip()
        if not oms or not birthday:
            raise SystemExit(
                "Заполните OMS_NUMBER и OMS_BIRTHDAY в файле .env "
                "(см. .env.example)."
            )
        return cls(
            oms_number=oms,
            oms_birthday=birthday,
            department_id=os.getenv("DEPARTMENT_ID", "").strip(),
            lpu_code=os.getenv("LPU_CODE", "").strip(),
            doctor_id=os.getenv("DOCTOR_ID", "").strip(),
            days=int(os.getenv("DAYS", "21")),
            check_interval_sec=int(os.getenv("CHECK_INTERVAL_SEC", "300")),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
            telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip(),
            booking_url=os.getenv("BOOKING_URL", "https://zdrav.mosreg.ru/").strip(),
        )


class ZdravClient:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.session = requests.Session()
        self.session.verify = False
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json",
            }
        )
        self.person_guid: str | None = None

    def _params(self, **extra: Any) -> dict[str, Any]:
        params: dict[str, Any] = {
            "number": self.config.oms_number,
            "birthday": self.config.birthday_iso,
        }
        params.update({k: v for k, v in extra.items() if v not in (None, "")})
        return params

    def _get(self, path: str, **extra: Any) -> Any:
        url = f"{BASE_URL}{path}"
        response = self.session.get(url, params=self._params(**extra), timeout=45)
        if response.status_code >= 400:
            raise RuntimeError(
                f"HTTP {response.status_code} для {path}: {response.text[:500]}"
            )
        data = response.json()
        if isinstance(data, dict) and data.get("message") and not (
            data.get("items") or data.get("personGuid")
        ):
            raise RuntimeError(f"Ответ портала: {data.get('message')}")
        return data

    def auth(self) -> dict[str, Any]:
        data = self._get("/api/v2/emias/iemk/personal")
        guid = data.get("personGuid")
        if not guid:
            raise RuntimeError(
                "Не удалось авторизоваться по полису. Проверьте номер и дату рождения, "
                "а также что полис прикреплён к МО Московской области."
            )
        self.person_guid = guid
        attached = data.get("lpu") or []
        log.info("Авторизация OK, personGuid=%s", guid)
        if attached:
            for lpu in attached[:5]:
                log.info(
                    "  Прикрепление: %s (код %s, %s)",
                    lpu.get("title") or lpu.get("full_name"),
                    lpu.get("code"),
                    lpu.get("city") or lpu.get("fullAddress", ""),
                )
        return data

    def departments(self) -> list[dict[str, Any]]:
        data = self._get("/api/v2/emias/iemk/departments")
        items = data.get("items") or []
        return sorted(items, key=lambda x: int(x.get("code") or 0))

    def doctors(
        self,
        department_id: str,
        lpu_code: str | None = None,
        days: int | None = None,
    ) -> dict[str, Any]:
        return self._get(
            "/api/v2/emias/iemk/doctors",
            departmentId=department_id,
            lpuCode=lpu_code or None,
            days=days or self.config.days,
        )


def working_days(schedule: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for day in schedule or []:
        busy = day.get("docBusyType") or {}
        if busy.get("type") == WEEKEND_TYPE:
            continue
        result.append(day)
    return result


def available_slots(
    doctors_payload: dict[str, Any],
    doctor_id_filter: str = "",
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for item in doctors_payload.get("items") or []:
        lpu = item.get("lpu") or {}
        for doctor in item.get("doctors") or []:
            doc_id = str(doctor.get("id") or "")
            if doctor_id_filter and not doc_id.endswith(doctor_id_filter):
                continue
            days = []
            total = 0
            for day in working_days(doctor.get("schedule") or []):
                tickets = int(day.get("count_tickets") or 0)
                if tickets <= 0:
                    continue
                total += tickets
                days.append(
                    {
                        "date": day.get("date"),
                        "time_from": day.get("time_from"),
                        "time_to": day.get("time_to"),
                        "count_tickets": tickets,
                    }
                )
            if total <= 0:
                continue
            found.append(
                {
                    "doctor_id": doc_id,
                    "display_name": doctor.get("displayName")
                    or " ".join(
                        filter(
                            None,
                            [
                                doctor.get("family"),
                                doctor.get("name"),
                                doctor.get("surname"),
                            ],
                        )
                    ),
                    "position": doctor.get("position") or doctor.get("type_name") or "",
                    "lpu_code": lpu.get("mcod") or item.get("lpu_code"),
                    "lpu_name": lpu.get("name"),
                    "lpu_address": lpu.get("address"),
                    "count_tickets": total,
                    "days": days,
                }
            )
    return found


def format_slots(slots: list[dict[str, Any]], booking_url: str) -> str:
    lines = [
        "🎉 Появились свободные талоны!",
        f"Всего врачей со слотами: {len(slots)}",
        "",
    ]
    for slot in slots:
        lines.append(f"👨‍⚕️ {slot['display_name']}")
        if slot.get("position"):
            lines.append(f"   {slot['position']}")
        if slot.get("lpu_name"):
            lines.append(f"   🏥 {slot['lpu_name']}")
        if slot.get("lpu_address"):
            lines.append(f"   📍 {slot['lpu_address']}")
        lines.append(f"   Свободно: {slot['count_tickets']}")
        for day in slot["days"][:8]:
            date_raw = day.get("date") or ""
            try:
                date_fmt = datetime.fromisoformat(date_raw.replace("Z", "")).strftime(
                    "%d.%m.%Y"
                )
            except ValueError:
                date_fmt = date_raw
            lines.append(
                f"   • {date_fmt} {day.get('time_from', '')}–{day.get('time_to', '')} "
                f"({day.get('count_tickets')} тал.)"
            )
        lines.append("")
    lines.append(f"Записаться: {booking_url}")
    lines.append("Или бот: https://t.me/eregistratura_mo_bot")
    return "\n".join(lines).strip()


def send_telegram(token: str, chat_id: str, text: str) -> None:
    if not token or not chat_id:
        log.warning("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — только лог:")
        print(text)
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    # Telegram limit ~4096 chars
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


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"last_total": 0, "fingerprint": ""}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"last_total": 0, "fingerprint": ""}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def fingerprint(slots: list[dict[str, Any]]) -> str:
    parts = []
    for slot in sorted(slots, key=lambda s: s["doctor_id"]):
        days = ",".join(
            f"{d.get('date')}:{d.get('count_tickets')}" for d in slot.get("days") or []
        )
        parts.append(f"{slot['doctor_id']}|{slot['count_tickets']}|{days}")
    return ";".join(parts)


def cmd_departments(client: ZdravClient) -> None:
    client.auth()
    items = client.departments()
    print(f"Специальности ({len(items)}):")
    for item in items:
        print(f"  {item.get('id')}\t{item.get('title')} (код {item.get('code')})")


def cmd_hospitals(client: ZdravClient, department_id: str) -> None:
    client.auth()
    payload = client.doctors(department_id=department_id)
    seen: set[str] = set()
    print(f"Больницы для специальности {department_id}:")
    for item in payload.get("items") or []:
        lpu = item.get("lpu") or {}
        code = str(lpu.get("mcod") or item.get("lpu_code") or "")
        if not code or code in seen:
            continue
        seen.add(code)
        print(f"  {code}\t{lpu.get('name')}")
        if lpu.get("address"):
            print(f"\t{lpu.get('address')}")


def cmd_doctors(client: ZdravClient, department_id: str, lpu_code: str) -> None:
    client.auth()
    payload = client.doctors(department_id=department_id, lpu_code=lpu_code or None)
    print("Врачи и талоны:")
    slots = available_slots(payload)
    doctors_seen: set[str] = set()
    for item in payload.get("items") or []:
        for doctor in item.get("doctors") or []:
            doc_id = str(doctor.get("id") or "")
            if doc_id in doctors_seen:
                continue
            doctors_seen.add(doc_id)
            tickets = sum(
                int(d.get("count_tickets") or 0)
                for d in working_days(doctor.get("schedule") or [])
            )
            print(
                f"  {doc_id}\t{doctor.get('displayName')}\t"
                f"свободных талонов: {tickets}"
            )
    if slots:
        print("\nСвободные слоты прямо сейчас:")
        print(format_slots(slots, client.config.booking_url))
    else:
        print("\nСвободных талонов сейчас нет.")


def check_once(client: ZdravClient, config: Config, *, force_notify: bool = False) -> int:
    client.auth()
    if not config.department_id:
        raise SystemExit(
            "Для мониторинга укажите DEPARTMENT_ID в .env "
            "(сначала: python monitor.py departments)."
        )
    payload = client.doctors(
        department_id=config.department_id,
        lpu_code=config.lpu_code or None,
        days=config.days,
    )
    slots = available_slots(payload, doctor_id_filter=config.doctor_id)
    total = sum(s["count_tickets"] for s in slots)
    fp = fingerprint(slots)
    state = load_state()
    prev_total = int(state.get("last_total") or 0)
    prev_fp = state.get("fingerprint") or ""

    log.info(
        "Проверка: свободно %s талонов у %s врачей (было %s)",
        total,
        len(slots),
        prev_total,
    )

    should_notify = force_notify or (total > 0 and (total > prev_total or fp != prev_fp))
    if total == 0:
        log.info("Свободных талонов нет.")
    elif should_notify:
        text = format_slots(slots, config.booking_url)
        send_telegram(config.telegram_bot_token, config.telegram_chat_id, text)
        log.info("Оповещение отправлено.")
    else:
        log.info("Ситуация не изменилась — повторное оповещение не шлём.")

    save_state(
        {
            "last_total": total,
            "fingerprint": fp,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    return total


def cmd_watch(client: ZdravClient, config: Config) -> None:
    log.info(
        "Мониторинг каждые %s сек. Ctrl+C для остановки.",
        config.check_interval_sec,
    )
    while True:
        try:
            check_once(client, config)
        except KeyboardInterrupt:
            raise
        except Exception as exc:  # noqa: BLE001 — цикл не должен падать
            log.error("Ошибка проверки: %s", exc)
        time.sleep(config.check_interval_sec)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Монитор записи к врачу (zdrav.mosreg.ru)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("departments", help="Список специальностей")
    p_hosp = sub.add_parser("hospitals", help="Больницы для специальности")
    p_hosp.add_argument("department_id", nargs="?", default="")

    p_docs = sub.add_parser("doctors", help="Врачи и текущие талоны")
    p_docs.add_argument("department_id", nargs="?", default="")
    p_docs.add_argument("lpu_code", nargs="?", default="")

    sub.add_parser("check", help="Одна проверка + оповещение при слотах")
    sub.add_parser("watch", help="Проверять каждые CHECK_INTERVAL_SEC секунд")
    sub.add_parser("notify-test", help="Проверить отправку в Telegram")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    config = Config.from_env()
    client = ZdravClient(config)

    if args.command == "departments":
        cmd_departments(client)
    elif args.command == "hospitals":
        dep = args.department_id or config.department_id
        if not dep:
            raise SystemExit("Укажите department_id или DEPARTMENT_ID в .env")
        cmd_hospitals(client, dep)
    elif args.command == "doctors":
        dep = args.department_id or config.department_id
        lpu = args.lpu_code or config.lpu_code
        if not dep:
            raise SystemExit("Укажите department_id или DEPARTMENT_ID в .env")
        cmd_doctors(client, dep, lpu)
    elif args.command == "check":
        check_once(client, config, force_notify=True)
    elif args.command == "watch":
        cmd_watch(client, config)
    elif args.command == "notify-test":
        send_telegram(
            config.telegram_bot_token,
            config.telegram_chat_id,
            "✅ Тест: монитор записи к врачу работает.",
        )
        log.info("Тестовое сообщение отправлено (или напечатано в консоль).")
    else:
        parser.print_help()
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log.info("Остановлено.")
        raise SystemExit(0)
