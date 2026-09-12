"""Справочник банков по БИК — официальный ED807 Банка России.

Источник: https://www.cbr.ru/s/newbik (ZIP с XML ED807).
Кэш на диске, фоновое обновление каждый час.
"""

from __future__ import annotations

import io
import json
import logging
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

CBR_NEWBIK_URL = "https://www.cbr.ru/s/newbik"
CACHE_TTL_SEC = 60 * 60  # каждый час
_CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "bic_ed807.json"

# Курируемые длинные названия для казначейских бланков (как печатают на ПД-4).
BANK_NAME_OVERRIDES: dict[str, str] = {
    "004525987": "ГУ Банка России по ЦФО//УФК по Московской области, г. Москва",
}

_lock = threading.Lock()
_mem: dict[str, "BankInfo"] | None = None
_mem_loaded_at = 0.0
_refresh_thread: threading.Thread | None = None


@dataclass
class BankInfo:
    bic: str
    name: str
    city: str = ""
    accounts: tuple[str, ...] = ()

    def display_name(self) -> str:
        if self.bic in BANK_NAME_OVERRIDES:
            return BANK_NAME_OVERRIDES[self.bic]
        name = _pretty_ru_name(self.name)
        if self.city and self.city.lower() not in name.lower():
            name = f"{name}, г. {self.city}"
        return name

    def preferred_eks(self) -> str:
        """ЕКС/корсчёт УФК (4010…) если есть в справочнике."""
        for acc in self.accounts:
            if acc.startswith("4010") and len(acc) == 20:
                return acc
        return self.accounts[0] if self.accounts else ""


def _pretty_ru_name(name: str) -> str:
    """«УФК ПО МОСКОВСКОЙ ОБЛАСТИ» → «УФК по Московской области»."""
    s = (name or "").strip()
    if not s:
        return ""
    if not s.isupper():
        return s
    small = {"по", "и", "на", "в", "г", "им", "для", "с"}
    parts: list[str] = []
    for i, w in enumerate(s.lower().split()):
        if i > 0 and w in small:
            parts.append(w)
        else:
            parts.append(w[:1].upper() + w[1:] if w else w)
    return " ".join(parts)


def _download_ed807() -> bytes:
    req = urllib.request.Request(
        CBR_NEWBIK_URL,
        headers={"User-Agent": "KvitQR/1.0 (+https://qr.vele.uk)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def _parse_ed807_zip(zip_bytes: bytes) -> dict[str, BankInfo]:
    out: dict[str, BankInfo] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_name = next(n for n in zf.namelist() if n.lower().endswith(".xml"))
        raw = zf.read(xml_name)

    for _event, elem in ET.iterparse(io.BytesIO(raw), events=("end",)):
        tag = elem.tag.rsplit("}", 1)[-1]
        if tag != "BICDirectoryEntry":
            continue
        bic = (elem.attrib.get("BIC") or "").strip()
        if len(bic) != 9 or not bic.isdigit():
            elem.clear()
            continue
        name = ""
        city = ""
        accounts: list[str] = []
        for child in elem:
            ct = child.tag.rsplit("}", 1)[-1]
            if ct == "ParticipantInfo":
                name = (
                    child.attrib.get("NameP") or child.attrib.get("Name") or ""
                ).strip()
                city = (child.attrib.get("Nnp") or "").strip()
            elif ct == "Accounts":
                acc = (child.attrib.get("Account") or "").strip()
                if len(acc) == 20 and acc.isdigit():
                    accounts.append(acc)
        if bic and name:
            out[bic] = BankInfo(
                bic=bic, name=name, city=city, accounts=tuple(accounts)
            )
        elem.clear()
    return out


def _save_cache(mapping: dict[str, BankInfo]) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fetched_at": time.time(),
        "source": CBR_NEWBIK_URL,
        "banks": {bic: asdict(info) for bic, info in mapping.items()},
    }
    tmp = _CACHE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_CACHE_PATH)


def _load_cache() -> tuple[dict[str, BankInfo], float] | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        fetched = float(payload.get("fetched_at") or 0)
        banks: dict[str, BankInfo] = {}
        for _bic, row in (payload.get("banks") or {}).items():
            banks[row["bic"]] = BankInfo(
                bic=row["bic"],
                name=row["name"],
                city=row.get("city") or "",
                accounts=tuple(row.get("accounts") or ()),
            )
        return banks, fetched
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось прочитать кэш БИК")
        return None


def refresh_directory(force: bool = False) -> dict[str, BankInfo]:
    """Скачать/обновить справочник ЦБ. Потокобезопасно."""
    global _mem, _mem_loaded_at
    with _lock:
        cached = _load_cache()
        if cached and not force:
            banks, fetched = cached
            if time.time() - fetched < CACHE_TTL_SEC and banks:
                _mem = banks
                _mem_loaded_at = fetched
                return banks

        logger.info("Загрузка справочника БИК ЦБ РФ…")
        zip_bytes = _download_ed807()
        banks = _parse_ed807_zip(zip_bytes)
        if not banks:
            raise RuntimeError("Пустой справочник БИК от ЦБ")
        _save_cache(banks)
        _mem = banks
        _mem_loaded_at = time.time()
        logger.info("Справочник БИК: %s записей", len(banks))
        return banks


def get_directory() -> dict[str, BankInfo]:
    global _mem, _mem_loaded_at
    if _mem is not None and time.time() - _mem_loaded_at < CACHE_TTL_SEC:
        return _mem
    cached = _load_cache()
    if cached:
        banks, fetched = cached
        if banks and time.time() - fetched < CACHE_TTL_SEC:
            _mem = banks
            _mem_loaded_at = fetched
            return banks
    try:
        return refresh_directory(force=False)
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось обновить справочник БИК, пробуем старый кэш")
        if cached and cached[0]:
            _mem = cached[0]
            _mem_loaded_at = cached[1]
            return cached[0]
        if _mem:
            return _mem
        return {}


def lookup_bank(bic: str) -> Optional[BankInfo]:
    bic = (bic or "").strip()
    if len(bic) != 9 or not bic.isdigit():
        return None
    return get_directory().get(bic)


def resolve_bank_name(bic: str, ocr_name: str = "") -> str:
    """Эталонное имя банка: override → ЦБ → OCR."""
    bic = (bic or "").strip()
    if bic in BANK_NAME_OVERRIDES:
        return BANK_NAME_OVERRIDES[bic]
    info = lookup_bank(bic)
    if info:
        return info.display_name()
    return (ocr_name or "").strip()


def start_hourly_refresh() -> None:
    """Фоновый поток: раз в час тянет свежий ED807 с сайта ЦБ."""
    global _refresh_thread
    if _refresh_thread is not None and _refresh_thread.is_alive():
        return

    def _loop() -> None:
        # первая загрузка сразу
        try:
            refresh_directory(force=True)
        except Exception:  # noqa: BLE001
            logger.exception("Первичная загрузка справочника БИК не удалась")
        while True:
            time.sleep(CACHE_TTL_SEC)
            try:
                refresh_directory(force=True)
            except Exception:  # noqa: BLE001
                logger.exception("Фоновое обновление справочника БИК не удалось")

    _refresh_thread = threading.Thread(
        target=_loop, name="bic-directory-refresh", daemon=True
    )
    _refresh_thread.start()
