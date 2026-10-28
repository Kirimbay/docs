"""Read-only TableCheck availability client for a single shop."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests

BASE_URL = "https://www.tablecheck.com"


@dataclass(frozen=True)
class TimeSlot:
    label: str
    epoch: int
    day: date

    def dubai_dt(self, tz: ZoneInfo) -> datetime:
        return datetime.fromtimestamp(self.epoch, tz=tz)


@dataclass(frozen=True)
class AvailableSlot:
    slot: TimeSlot
    raw: dict[str, Any]


class TableCheckClient:
    def __init__(self, shop_slug: str, timeout: float = 30.0) -> None:
        self.shop_slug = shop_slug
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (compatible; TableCheckAvailabilityMonitor/1.0; "
                    "+personal-read-only)"
                ),
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE_URL}/en/shops/{shop_slug}/reserve",
            }
        )

    def warm_up(self) -> None:
        url = f"{BASE_URL}/en/shops/{self.shop_slug}/reserve"
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()

    def _party_params(
        self,
        *,
        adults: int,
        children: int,
        seniors: int = 0,
        babies: int = 0,
    ) -> dict[str, str]:
        return {
            "reservation[num_people_adult]": str(adults) if adults else "",
            "reservation[num_people_child]": str(children) if children else "",
            "reservation[num_people_senior]": str(seniors) if seniors else "",
            "reservation[num_people_baby]": str(babies) if babies else "",
        }

    def fetch_sheets(
        self,
        day: date,
        *,
        adults: int,
        children: int,
        seniors: int = 0,
        babies: int = 0,
    ) -> list[TimeSlot]:
        params = {
            "reservation[start_date]": day.isoformat(),
            **self._party_params(
                adults=adults, children=children, seniors=seniors, babies=babies
            ),
        }
        url = f"{BASE_URL}/en/shops/{self.shop_slug}/sheets"
        resp = self.session.get(url, params=params, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        slots = data.get("slots") or []
        out: list[TimeSlot] = []
        for item in slots:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            label, epoch = item[0], int(item[1])
            out.append(TimeSlot(label=str(label), epoch=epoch, day=day))
        return out

    def check_available(
        self,
        slot: TimeSlot,
        *,
        adults: int,
        children: int,
        seniors: int = 0,
        babies: int = 0,
    ) -> dict[str, Any]:
        params = {
            "reservation[start_at_epoch]": str(slot.epoch),
            **self._party_params(
                adults=adults, children=children, seniors=seniors, babies=babies
            ),
        }
        url = f"{BASE_URL}/en/shops/{self.shop_slug}/available"
        resp = self.session.get(url, params=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def find_available(
        self,
        days: list[date],
        *,
        adults: int,
        children: int,
        seniors: int = 0,
        babies: int = 0,
        tz: ZoneInfo,
        min_hours_before: float = 5.0,
        meal_filter: str = "all",
    ) -> list[AvailableSlot]:
        now = datetime.now(tz)
        min_ts = now.timestamp() + min_hours_before * 3600
        found: list[AvailableSlot] = []

        for day in days:
            try:
                sheets = self.fetch_sheets(
                    day,
                    adults=adults,
                    children=children,
                    seniors=seniors,
                    babies=babies,
                )
            except requests.RequestException:
                continue

            for slot in sheets:
                if slot.epoch < min_ts:
                    continue
                if not _meal_matches(slot, tz, meal_filter):
                    continue
                try:
                    raw = self.check_available(
                        slot,
                        adults=adults,
                        children=children,
                        seniors=seniors,
                        babies=babies,
                    )
                except (requests.RequestException, ValueError):
                    continue

                status = raw.get("status")
                if status == "success":
                    found.append(AvailableSlot(slot=slot, raw=raw))
                elif status == "invalid":
                    # Outside booking window for this venue — stop scanning further days.
                    return found
        return found


def booking_days(days_ahead: int, tz: ZoneInfo) -> list[date]:
    today = datetime.now(tz).date()
    return [today + timedelta(days=i) for i in range(max(1, days_ahead))]


def _meal_matches(slot: TimeSlot, tz: ZoneInfo, meal_filter: str) -> bool:
    mode = (meal_filter or "all").strip().lower()
    if mode in ("", "all", "*"):
        return True
    hour = slot.dubai_dt(tz).hour
    if mode == "lunch":
        return hour < 16
    if mode == "dinner":
        return hour >= 16
    return True
