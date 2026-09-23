"""Курсы валют: USD/EUR/CNY с ЦБ РФ + BTC (CoinGecko), кэш ~5 мин."""

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
COINGECKO_BTC_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=rub&include_24hr_change=true"
)
CACHE_TTL_SEC = 5 * 60
MSK = ZoneInfo("Europe/Moscow")

_cache: Optional["RatesBundle"] = None
_cache_at = 0.0


@dataclass
class Rate:
    code: str
    name: str
    pair: str
    unit: str
    value: float
    previous: float
    date: str
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
        today = datetime.now(MSK).strftime("%d.%m.%Y")
        # BTC — целые рубли с пробелами (без копеек/запятой)
        if self.code == "BTC":
            data["display"] = _format_rub(self.value, digits=0)
            data["previous_display"] = _format_rub(self.previous, digits=0)
            data["delta_display"] = _format_delta(self.delta, digits=0)
            data["unit"] = "₽ за 1 биткоин"
            data["meta"] = f"CoinGecko · {today}"
        else:
            data["display"] = _format_rub(self.value)
            data["previous_display"] = _format_rub(self.previous)
            data["delta_display"] = _format_delta(self.delta)
            # Не светим «курс на завтра» от ЦБ — путает; показываем дату обновления
            data["meta"] = f"ЦБ РФ · обновлено {today}"
        return data

@dataclass
class RatesBundle:
    usd: Rate
    eur: Rate
    cny: Rate
    btc: Rate
    date: str
    fetched_at: str

    def to_api(self) -> dict[str, Any]:
        today = datetime.now(MSK).strftime("%d.%m.%Y")
        return {
            "date": self.date,
            "fetched_at": self.fetched_at,
            "rates": {
                "usd": self.usd.to_api(),
                "eur": self.eur.to_api(),
                "cny": self.cny.to_api(),
                "btc": self.btc.to_api(),
            },
            "sections": [
                self.usd.to_api(),
                self.eur.to_api(),
                self.cny.to_api(),
                self.btc.to_api(),
            ],
            "footer": {
                "fiat": f"USD EUR CNY · ЦБ РФ на {today}",
                "btc": f"BTC · CoinGecko на {today}",
            },
        }


def _format_rub(value: float, *, digits: int = 2) -> str:
    if digits == 0:
        # 7654321 → «7 654 321»
        return f"{value:,.0f}".replace(",", " ")
    return f"{value:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", " ")


def _format_delta(delta: float, *, digits: int = 2) -> str:
    sign = "+" if delta > 0 else ""
    if digits == 0:
        return f"{sign}{delta:,.0f}".replace(",", " ")
    body = f"{abs(delta):,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", " ")
    if delta < 0:
        return f"-{body}"
    return f"{sign}{body}"


def _parse_cbr_float(raw: str) -> float:
    return float((raw or "0").replace(",", ".").replace(" ", ""))


def _cbr_date_from_iso(raw: str) -> str:
    raw_date = (raw or "")[:10]
    try:
        return datetime.strptime(raw_date, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return raw_date


def _rate_from_cbr_valute(
    code: str,
    name: str,
    pair: str,
    unit: str,
    valute: dict[str, Any],
    *,
    date: str,
    source: str,
) -> Rate:
    nominal = int(valute.get("Nominal") or 1) or 1
    value = float(valute["Value"]) / nominal
    previous = float(valute["Previous"]) / nominal
    return Rate(
        code=code,
        name=name,
        pair=pair,
        unit=unit,
        value=value,
        previous=previous,
        date=date,
        fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
        source=source,
    )


def _fetch_cbr_json() -> dict[str, Rate]:
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        resp = client.get(CBR_JSON_MIRROR, headers={"User-Agent": "Kurs/1.0"})
        resp.raise_for_status()
        data = resp.json()
    date = _cbr_date_from_iso(data.get("Date") or "")
    source = "cbr-xml-daily.ru (зеркало ЦБ)"
    valutes = data["Valute"]
    return {
        "USD": _rate_from_cbr_valute(
            "USD", "USD", "USD → RUB", "₽ за 1 доллар США",
            valutes["USD"], date=date, source=source,
        ),
        "EUR": _rate_from_cbr_valute(
            "EUR", "EUR", "EUR → RUB", "₽ за 1 евро",
            valutes["EUR"], date=date, source=source,
        ),
        "CNY": _rate_from_cbr_valute(
            "CNY", "CNY", "CNY → RUB", "₽ за 1 китайский юань",
            valutes["CNY"], date=date, source=source,
        ),
    }


def _fetch_cbr_xml() -> dict[str, Rate]:
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        resp = client.get(CBR_XML_URL, headers={"User-Agent": "Kurs/1.0"})
        resp.raise_for_status()
        text = resp.content.decode("cp1251", errors="replace")
    root = ET.fromstring(text)
    date = root.attrib.get("Date") or ""
    wanted = {
        "USD": ("USD", "USD → RUB", "₽ за 1 доллар США"),
        "EUR": ("EUR", "EUR → RUB", "₽ за 1 евро"),
        "CNY": ("CNY", "CNY → RUB", "₽ за 1 китайский юань"),
    }
    found: dict[str, Rate] = {}
    for valute in root.findall("Valute"):
        code = (valute.findtext("CharCode") or "").strip()
        if code not in wanted:
            continue
        name, pair, unit = wanted[code]
        nominal = int(valute.findtext("Nominal") or "1") or 1
        value = _parse_cbr_float(valute.findtext("Value") or "0") / nominal
        found[code] = Rate(
            code=code,
            name=name,
            pair=pair,
            unit=unit,
            value=value,
            previous=value,
            date=date,
            fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
            source="cbr.ru/XML_daily.asp",
        )
    missing = [c for c in wanted if c not in found]
    if missing:
        raise RuntimeError(f"В XML ЦБ нет: {', '.join(missing)}")
    return found


def _fetch_btc() -> Rate:
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        resp = client.get(COINGECKO_BTC_URL, headers={"User-Agent": "Kurs/1.0"})
        resp.raise_for_status()
        data = resp.json()["bitcoin"]
    value = float(data["rub"])
    change_pct = float(data.get("rub_24h_change") or 0.0)
    # previous ≈ value / (1 + change/100)
    previous = value / (1 + change_pct / 100) if change_pct != -100 else value
    now = datetime.now(MSK)
    return Rate(
        code="BTC",
        name="BTC",
        pair="BTC → RUB",
        unit="₽ за 1 биткоин",
        value=value,
        previous=previous,
        date=now.strftime("%d.%m.%Y"),
        fetched_at=now.isoformat(timespec="seconds"),
        source="coingecko.com",
    )


def get_rates(*, force: bool = False) -> RatesBundle:
    global _cache, _cache_at
    now = time.time()
    if not force and _cache is not None and now - _cache_at < CACHE_TTL_SEC:
        return _cache

    errors: list[str] = []
    cbr: Optional[dict[str, Rate]] = None
    try:
        cbr = _fetch_cbr_json()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"cbr-mirror: {exc}")
        logger.warning("Зеркало ЦБ недоступно: %s", exc)
        try:
            cbr = _fetch_cbr_xml()
        except Exception as exc2:  # noqa: BLE001
            errors.append(f"cbr-xml: {exc2}")
            logger.exception("XML ЦБ недоступен")

    btc: Optional[Rate] = None
    try:
        btc = _fetch_btc()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"btc: {exc}")
        logger.warning("BTC недоступен: %s", exc)
        if _cache is not None:
            btc = _cache.btc

    if cbr is None:
        if _cache is not None:
            return _cache
        raise RuntimeError("; ".join(errors) or "Не удалось получить курсы")

    if btc is None:
        # placeholder so page still renders fiat
        btc = Rate(
            code="BTC",
            name="BTC",
            pair="BTC → RUB",
            unit="₽ за 1 биткоин",
            value=0.0,
            previous=0.0,
            date=cbr["USD"].date,
            fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
            source="unavailable",
        )

    bundle = RatesBundle(
        usd=cbr["USD"],
        eur=cbr["EUR"],
        cny=cbr["CNY"],
        btc=btc,
        date=cbr["USD"].date,
        fetched_at=datetime.now(MSK).isoformat(timespec="seconds"),
    )
    _cache = bundle
    _cache_at = now
    return bundle


# Обратная совместимость для старых импортов/тестов
UsdRate = Rate


def get_usd_rate(*, force: bool = False) -> Rate:
    return get_rates(force=force).usd
