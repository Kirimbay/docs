"""Клиент API zdrav.mosreg.ru и логика поиска свободных талонов."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://zdrav.mosreg.ru"
BOOKING_URL = "https://zdrav.mosreg.ru/"
WEEKEND_TYPE = 0
DEFAULT_DAYS = 21


@dataclass
class Polis:
    number: str
    birthday: str  # DD.MM.YYYY

    @property
    def birthday_iso(self) -> str:
        day, month, year = self.birthday.split(".")
        return f"{year}-{month}-{day}"

    @classmethod
    def parse(cls, number_raw: str, birthday: str) -> "Polis":
        number = "".join(ch for ch in number_raw if ch.isdigit())
        if not number:
            raise ValueError("Номер полиса не распознан")
        if not birthday or not _BIRTHDAY_RE.match(birthday):
            raise ValueError("Дата рождения должна быть в формате ДД.ММ.ГГГГ")
        return cls(number=number, birthday=birthday)


_BIRTHDAY_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")


@dataclass
class DoctorsQuery:
    department_id: str
    lpu_code: str = ""
    doctor_id: str = ""
    days: int = DEFAULT_DAYS


class ZdravClient:
    def __init__(self, polis: Polis, days: int = DEFAULT_DAYS) -> None:
        self.polis = polis
        self.days = days
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
            "number": self.polis.number,
            "birthday": self.polis.birthday_iso,
        }
        params.update({k: v for k, v in extra.items() if v not in (None, "")})
        return params

    def _get(self, path: str, **extra: Any) -> Any:
        response = self.session.get(
            f"{BASE_URL}{path}",
            params=self._params(**extra),
            timeout=45,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"HTTP {response.status_code} для {path}: {response.text[:500]}"
            )
        data = response.json()
        if isinstance(data, dict) and data.get("message") and not (
            data.get("items") or data.get("personGuid")
        ):
            raise RuntimeError(str(data.get("message")))
        return data

    def auth(self) -> dict[str, Any]:
        data = self._get("/api/v2/emias/iemk/personal")
        guid = data.get("personGuid")
        if not guid:
            raise RuntimeError(
                "Не удалось авторизоваться по полису. Проверьте номер и дату рождения "
                "и что полис прикреплён к МО Московской области."
            )
        self.person_guid = guid
        return data

    def departments(self) -> list[dict[str, Any]]:
        data = self._get("/api/v2/emias/iemk/departments")
        items = data.get("items") or []
        return sorted(items, key=lambda x: int(x.get("code") or 0))

    def doctors(self, query: DoctorsQuery) -> dict[str, Any]:
        return self._get(
            "/api/v2/emias/iemk/doctors",
            departmentId=query.department_id,
            lpuCode=query.lpu_code or None,
            doctorId=query.doctor_id or None,
            days=query.days or self.days,
        )


def working_days(schedule: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for day in schedule or []:
        busy = day.get("docBusyType") or {}
        if busy.get("type") == WEEKEND_TYPE:
            continue
        result.append(day)
    return result


def doctor_ticket_count(doctor: dict[str, Any]) -> int:
    return sum(
        int(d.get("count_tickets") or 0)
        for d in working_days(doctor.get("schedule") or [])
    )


def available_slots(
    doctors_payload: dict[str, Any],
    doctor_id_filter: str = "",
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for item in doctors_payload.get("items") or []:
        lpu = item.get("lpu") or {}
        for doctor in item.get("doctors") or []:
            doc_id = str(doctor.get("id") or "")
            if doctor_id_filter and not (
                doc_id == doctor_id_filter or doc_id.endswith(doctor_id_filter)
            ):
                continue
            days: list[dict[str, Any]] = []
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
                    "lpu_code": str(lpu.get("mcod") or item.get("lpu_code") or ""),
                    "lpu_name": lpu.get("name") or "",
                    "lpu_address": lpu.get("address") or "",
                    "count_tickets": total,
                    "days": days,
                }
            )
    return found


def fingerprint(slots: list[dict[str, Any]]) -> str:
    parts = []
    for slot in sorted(slots, key=lambda s: s["doctor_id"]):
        days = ",".join(
            f"{d.get('date')}:{d.get('count_tickets')}" for d in slot.get("days") or []
        )
        parts.append(f"{slot['doctor_id']}|{slot['count_tickets']}|{days}")
    return ";".join(parts)


def format_slots(
    slots: list[dict[str, Any]],
    *,
    title: str = "Появились свободные талоны!",
    booking_url: str = BOOKING_URL,
) -> str:
    lines = [f"🎉 {title}", f"Врачей со слотами: {len(slots)}", ""]
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
    lines.append("Или: https://t.me/eregistratura_mo_bot")
    return "\n".join(lines).strip()


def collect_hospitals(payload: dict[str, Any]) -> list[dict[str, str]]:
    seen: set[str] = set()
    hospitals: list[dict[str, str]] = []
    for item in payload.get("items") or []:
        lpu = item.get("lpu") or {}
        code = str(lpu.get("mcod") or item.get("lpu_code") or "")
        if not code or code in seen:
            continue
        seen.add(code)
        hospitals.append(
            {
                "code": code,
                "name": lpu.get("name") or code,
                "address": lpu.get("address") or "",
            }
        )
    return hospitals


def collect_doctors(payload: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    doctors: list[dict[str, Any]] = []
    for item in payload.get("items") or []:
        for doctor in item.get("doctors") or []:
            doc_id = str(doctor.get("id") or "")
            if not doc_id or doc_id in seen:
                continue
            seen.add(doc_id)
            doctors.append(
                {
                    "id": doc_id,
                    "display_name": doctor.get("displayName") or doc_id,
                    "tickets": doctor_ticket_count(doctor),
                }
            )
    return doctors


def subscription_key(query: DoctorsQuery) -> str:
    return "__".join(
        part
        for part in (query.lpu_code or "", query.department_id, query.doctor_id or "")
        if part
    ) or query.department_id
