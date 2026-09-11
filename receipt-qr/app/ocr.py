"""Распознавание реквизитов с фото квитанции (ПД-4 и похожие)."""

from __future__ import annotations

import io
import re
from typing import Optional

import pytesseract
from PIL import Image, ImageEnhance, ImageOps

from .qr_builder import PaymentFields

KNOWN_BANKS = {
    "004525987": "ГУ Банка России по ЦФО//УФК по Московской области, г. Москва",
}


def _prep_image(img: Image.Image) -> Image.Image:
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    max_side = 2400
    w, h = img.size
    scale = min(1.0, max_side / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray)
    return ImageEnhance.Contrast(gray).enhance(1.4)


def extract_text(image_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(image_bytes))
    prepared = _prep_image(img)
    text = pytesseract.image_to_string(prepared, lang="rus+eng", config="--psm 6")
    return text.replace("\u00a0", " ")


def _find(pattern: str, text: str, flags: int = re.I | re.M) -> Optional[str]:
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else None


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


# Типичный КБК «прочие доходы» на бланках школ/кружков
CBC_INCOME_130 = "00000000000000000130"


def _normalize_cbc_candidate(raw: str) -> str:
    """Починить OCR: 0↔8 в «нулевом» КБК …00130."""
    # Только латиница O/o — кириллическую «О» из «ОКТМО» не захватываем
    cleaned = re.sub(r"[^\dOo]", "", raw or "")
    cleaned = cleaned.replace("O", "0").replace("o", "0")
    digits = _digits(cleaned)
    if not digits:
        return ""

    # OCR иногда прихватывает лишний символ → >20 цифр; пробуем префиксы
    candidates = [digits]
    if len(digits) > 20:
        candidates = [digits[:20], digits[:19], digits[:18], digits]

    for cand in candidates:
        if cand == CBC_INCOME_130 or re.fullmatch(r"0{15,17}130", cand):
            return CBC_INCOME_130
        if len(cand) >= 16 and cand.endswith(("130", "138", "13")):
            head = cand[:-3] if cand.endswith(("130", "138")) else cand[:-2]
            if head and set(head.replace("8", "0")) <= {"0"}:
                return CBC_INCOME_130
        if len(cand) == 20 and cand.endswith(("130", "138")):
            if set(cand[:-3].replace("8", "0")) <= {"0"}:
                return CBC_INCOME_130

    if len(digits) >= 20:
        return digits[:20]
    return digits if len(digits) >= 16 else ""


def _extract_cbc(text: str, fuzzy: str) -> str:
    """Достать КБК; терпим OCR-мусор и путаницу 0/8."""
    for src in (text, fuzzy):
        # Без кириллицы — иначе «О» из ОКТМО станет лишним нулём
        m = re.search(r"КБК[:\s\-]*([0-9Oo]{16,24})", src, re.I)
        if m:
            got = _normalize_cbc_candidate(m.group(1))
            if got:
                return got
    m = re.search(r"КБК[^\d]{0,8}([0-9Oo8]{12,22})", fuzzy, re.I)
    if m:
        got = _normalize_cbc_candidate(m.group(1))
        if got:
            return got
    return ""


def parse_receipt_text(text: str) -> PaymentFields:
    compact = re.sub(r"[ \t]+", " ", text)
    one_line = compact.replace("\n", " ")
    fuzzy = (
        one_line.replace("WHH", "ИНН")
        .replace("MH ", "ИНН ")
        .replace("HHH", "ИНН")
        .replace("ИHH", "ИНН")
        .replace("KIM", "КПП")
        .replace("КИП", "КПП")
        .replace("КИШ", "КПП")
        .replace("КНП", "КПП")
        .replace("EKC", "ЕКС")
        .replace("BIK", "БИК")
        .replace("OKTMO", "ОКТМО")
        .replace("KBK", "КБК")
        .replace("КВК", "КБК")
    )

    payee_inn = (
        _find(r"ИНН[:\s]*(\d{10})", text)
        or _find(r"ИНН[:\s]*(\d{10})", fuzzy)
        or _find(r"ИНН(\d{10})", fuzzy)
        or ""
    )
    kpp = (
        _find(r"КПП[:\s]*(\d{9})", text)
        or _find(r"КПП[:\s]*(\d{9})", fuzzy)
        or _find(r"КПП(\d{9})", fuzzy)
        or ""
    )
    bic = (
        _find(r"БИК[:\s]*(\d{9})", text)
        or _find(r"БИК[:\s]*(\d{9})", fuzzy)
        or _find(r"БИК(\d{9})", fuzzy)
        or ""
    )

    personal_acc = ""
    for cand in re.finditer(
        r"(?:казначейск\w*\s*счет|счет\s*№|сч[её]т)[^\d]{0,20}(\d[\d\s]{17,30}\d)",
        text,
        re.I,
    ):
        d = _digits(cand.group(1))
        if len(d) == 20:
            personal_acc = d
            break
    if not personal_acc:
        twenties = re.findall(r"(?<!\d)(\d{20})(?!\d)", re.sub(r"\s+", "", one_line))
        prefer = [a for a in twenties if a.startswith("032")]
        if not prefer:
            prefer = [
                a
                for a in twenties
                if not a.startswith("0000") and not a.startswith("4010")
            ]
        if prefer:
            personal_acc = prefer[0]

    corresp_acc = (
        _find(r"ЕКС[:\s]*(\d{20})", text)
        or _find(r"ЕКС[:\s]*(\d{20})", fuzzy)
        or _find(r"(?:корр?\.?\s*сч[её]т|корсчет)[^\d]{0,15}(\d{20})", text)
        or ""
    )
    if not corresp_acc:
        eks = re.findall(r"(?<!\d)(4010\d{16})(?!\d)", re.sub(r"\s+", "", one_line))
        if eks:
            corresp_acc = eks[0]

    cbc = _extract_cbc(text, fuzzy)
    oktmo = (
        _find(r"ОКТМО[:\s]*(\d{8})", text)
        or _find(r"ОКТМО[:\s\-]*(\d{8})", fuzzy)
        or ""
    )
    pers_acc = (
        _find(r"л/?с[:\s]*([0-9A-Za-z]{6,20})", text)
        or _find(r"л/?с[:\s]*([0-9A-Za-z]{6,20})", fuzzy)
        or ""
    )

    sum_rub = ""
    for pat in (
        r"Сумма\s*платежа[^\d]{0,20}(\d[\d\s]*([.,]\d{1,2})?)\s*(?:р|руб)?",
        r"(?<!\d)(\d{2,6})\s*(?:р\.|руб\.?|₽)",
    ):
        m = re.search(pat, text, re.I)
        if m:
            sum_rub = re.sub(r"\s+", "", m.group(1)).replace(",", ".")
            break

    bank_name = ""
    for pat in (
        r"(ГУ Банка России[^\n]{0,90})",
        r"(УФК по[^\n]{0,70})",
    ):
        m = re.search(pat, text, re.I)
        if m:
            bank_name = re.sub(r"\s+", " ", m.group(1)).strip(" .;")
            break
    if not bank_name and bic in KNOWN_BANKS:
        bank_name = KNOWN_BANKS[bic]

    name = ""
    # Типичный казначейский бланк Дубны / ДДШИ
    if re.search(r"Комитет по финанс", text + fuzzy, re.I) and re.search(
        r"Дубн", text + fuzzy, re.I
    ):
        org = "МБУДО «ДДШИ»" if re.search(r"ДДШИ|ДДШИ", text + fuzzy, re.I) else ""
        name = "Комитет по финансам и экономике г.о. Дубна"
        if org:
            name = f"{name} ({org})"
    if not name:
        m = re.search(r"(Комитет по финансам[^\n]{0,140})", text, re.I)
        if m:
            name = re.sub(r"\s+", " ", m.group(1)).strip(" ({")

    purpose = ""
    m = re.search(
        r"(?:наименование платежа|назначение платежа)[^\n]*\n([^\n]{3,120})",
        text,
        re.I,
    )
    if m:
        cand = m.group(1).strip()
        if not re.search(r"дата|сумма|плательщик", cand, re.I):
            purpose = cand
    m = re.search(r"\b(СП[РГ][^\n]{5,80})", text)
    if m and (not purpose or len(m.group(1)) > len(purpose)):
        purpose = re.sub(r"\s+", " ", m.group(1)).strip()

    return PaymentFields(
        name=name,
        personal_acc=personal_acc,
        bank_name=bank_name,
        bic=bic,
        corresp_acc=corresp_acc,
        payee_inn=payee_inn,
        kpp=kpp,
        sum_rub=sum_rub,
        purpose=purpose,
        cbc=cbc,
        oktmo=oktmo,
        pers_acc=pers_acc,
    )


def parse_receipt_image(image_bytes: bytes) -> tuple[PaymentFields, str]:
    text = extract_text(image_bytes)
    return parse_receipt_text(text), text
