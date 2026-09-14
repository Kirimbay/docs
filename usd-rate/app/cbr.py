"""Курс USD с официального XML ЦБ РФ (+ зеркало JSON как запасной канал)."""

from __future__ import annotations

import logging
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

CBR_XML_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
CBR_JSON_MIRROR = "https://www.cbr-xml-daily.ru/daily_json.js"
CACHE_TTL_SEC = 5 * 60
MSK = ZoneInfo("Europe/Moscow")

_cache: Optional["UsdRate"] = None
_cache_at = 0.0


@dataclass
class UsdRate:
    value: float
    previous: float
    nominal: int
    date: str  # ДД.ММ.ГГГГ (дата курса ЦБ)
    fetched_at: str
    source: str

    @property
    def delta(self) -> float:
        return round(self.value - self.previous, 4)

    @property
    def delta_pct(self) -> float:
        if not self.previous:
            return 0.0
        return round((self.value - self.previous) / self.previous * 100, 3)

    def to_api(self) -> dict[str, Any]:
        data = asdict(self)
        data["delta"] = self.delta
        data["delta_pct"] = self.delta_pct
        data["display"] = _format_rub(self.value)
        data["previous_display"] = _format_rub(self.previous)
        data["delta_display"] = _format_delta(self.delta)
        return data


def _format_rub(value: float) -> str:
    # 84.3363 → «84,34»
    return f"{value:.2f}".replace(".", ",")


def _format_delta(delta: float) -> str:
    sign = "+" if delta > 0 else ""
    return f"{sign}{delta:.2f}".replace(".", ",")


def _parse_cbr_float(raw: str) -> float:
    return float((raw or "0").replace(",", ".").replace(" ", ""))


def _fetch_from_cbr_xml() -> UsdRate:
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        resp = client.get(CBR_XML_URL, headers={"User-Agent": "KursUSD/1.0"})
        resp.raise_for_status()
        # ЦБ отдаёт windows-1251
        text = resp.content.decode("cp1251", errors="replace")
    root = ET.fromstring(text)
    date = root.attrib.get("Date") or ""
    usd = None
    for valute in root.findall("Valute"):
        if (valute.findtext("CharCode") or "").strip() == "USD":
            usd = valute
            break
    if usd is None:
        raise RuntimeError("USD не найден в XML ЦБ РФ")
    value = _parse_cbr_float(usd.findtext("Value") or "0")
    nominal = int(usd.findtext("Nominal") or "1")
    # В XML нет previous — доберём из зеркала, иначе 0
    previous = 0.0
    try:
        mirror = _fetch_from_json_mirror(only_previous=True)
        previous = mirror.previous if mirror.value == value else mirror.value
    except Exception:  # noqa: BLE001
        previous = value
    return UsdRate(
        value=value / nominal if nominal else value,
        previous=previous / nominal if nominal and previous else previous,
        nominal=1,
        date=date,
        fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
        source="cbr.ru/XML_daily.asp",
    )


def _fetch_from_json_mirror(*, only_previous: bool = False) -> UsdRate:
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        resp = client.get(CBR_JSON_MIRROR, headers={"User-Agent": "KursUSD/1.0"})
        resp.raise_for_status()
        data = resp.json()
    usd = data["Valute"]["USD"]
    # Date: 2026-09-15T11:30:00+03:00 → 15.09.2026
    raw_date = (data.get("Date") or "")[:10]
    try:
        date = datetime.strptime(raw_date, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        date = raw_date
    rate = UsdRate(
        value=float(usd["Value"]),
        previous=float(usd["Previous"]),
        nominal=int(usd.get("Nominal") or 1),
        date=date,
        fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
        source="cbr-xml-daily.ru (зеркало ЦБ)",
    )
    if only_previous:
        return rate
    return rate


def get_usd_rate(*, force: bool = False) -> UsdRate:
    global _cache, _cache_at
    now = time.time()
    if not force and _cache is not None and now - _cache_at < CACHE_TTL_SEC:
        return _cache

    errors: list[str] = []
    rate: Optional[UsdRate] = None
    try:
        # Зеркало удобнее: сразу Value + Previous с того же дневного курса ЦБ
        rate = _fetch_from_json_mirror()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"mirror: {exc}")
        logger.warning("Зеркало ЦБ недоступно: %s", exc)
        try:
            rate = _fetch_from_cbr_xml()
        except Exception as exc2:  # noqa: BLE001
            errors.append(f"cbr: {exc2}")
            logger.exception("Официальный XML ЦБ недоступен")

    if rate is None:
        if _cache is not None:
            return _cache
        raise RuntimeError("; ".join(errors) or "Не удалось получить курс")

    _cache = rate
    _cache_at = now
    return rate
