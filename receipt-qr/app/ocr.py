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


def prepare_image(image_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image_bytes))
    return _prep_image(img)


def ocr_image(prepared: Image.Image) -> str:
    text = pytesseract.image_to_string(prepared, lang="rus+eng", config="--psm 6")
    return text.replace("\u00a0", " ")


def extract_text(image_bytes: bytes) -> str:
    return ocr_image(prepare_image(image_bytes))


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


def _normalize_inn_digits(raw: str) -> str:
    """Оставить 10 цифр; лат. O/o → 0 (частая путаница OCR)."""
    cleaned = (raw or "").replace("O", "0").replace("o", "0")
    digits = _digits(cleaned)
    return digits[:10] if len(digits) >= 10 else ""


def _normalize_kpp_digits(raw: str) -> str:
    cleaned = (raw or "").replace("O", "0").replace("o", "0")
    digits = _digits(cleaned)
    return digits[:9] if len(digits) >= 9 else ""


# OCR часто ломает подписи: ИНН→MHA, КПП→KIH/KITE/КИЕН
_INN_LABEL = r"(?:ИНН|INN|MHA|MHА|ИHН|ИHH|WHH|HHH|ИНА|MH\s*A)"
_KPP_LABEL = r"(?:КПП|KPP|KIH|KITE|КИЕН|КИП|КИШ|КНП|КПИ|KПП|KIM)"


def _extract_inn_kpp(text: str, fuzzy: str) -> tuple[str, str]:
    """Достать ИНН (10) и КПП (9); терпим кривые подписи OCR."""
    inn, kpp = "", ""
    for src in (text, fuzzy):
        # Пара ИНН+КПП — самый надёжный якорь на бланках УФК
        m = re.search(
            rf"{_INN_LABEL}[:\s]*(\d[\dOo\s]{{8,16}}\d)"
            rf"[:\s\-;]*{_KPP_LABEL}[:\s]*(\d[\dOo\s]{{7,14}}\d)",
            src,
            re.I,
        )
        if m:
            inn = _normalize_inn_digits(m.group(1)) or inn
            kpp = _normalize_kpp_digits(m.group(2)) or kpp
            if inn and kpp:
                return inn, kpp

        # Без подписи ИНН: 10 цифр сразу перед кривым «КПП»
        m = re.search(
            rf"(?<!\d)(\d{{10}})[:\s\-;]*{_KPP_LABEL}[:\s]*(\d{{9}})(?!\d)",
            src,
            re.I,
        )
        if m:
            inn = inn or m.group(1)
            kpp = kpp or m.group(2)
            if inn and kpp:
                return inn, kpp

        if not inn:
            m = re.search(rf"{_INN_LABEL}[:\s]*(\d[\dOo\s]{{8,16}}\d)", src, re.I)
            if m:
                inn = _normalize_inn_digits(m.group(1))
        if not kpp:
            m = re.search(rf"{_KPP_LABEL}[:\s]*(\d[\dOo\s]{{7,14}}\d)", src, re.I)
            if m:
                kpp = _normalize_kpp_digits(m.group(1))
        if inn and kpp:
            return inn, kpp
    return inn, kpp


def parse_receipt_text(text: str) -> PaymentFields:
    compact = re.sub(r"[ \t]+", " ", text)
    one_line = compact.replace("\n", " ")
    fuzzy = (
        one_line.replace("WHH", "ИНН")
        .replace("MH ", "ИНН ")
        .replace("MHA", "ИНН")
        .replace("MHА", "ИНН")
        .replace("HHH", "ИНН")
        .replace("ИHH", "ИНН")
        .replace("ИHН", "ИНН")
        .replace("KIH", "КПП")
        .replace("KITE", "КПП")
        .replace("KIM", "КПП")
        .replace("КИЕН", "КПП")
        .replace("КИП", "КПП")
        .replace("КИШ", "КПП")
        .replace("КНП", "КПП")
        .replace("КПИ", "КПП")
        .replace("EKC", "ЕКС")
        .replace("EKG", "ЕКС")
        .replace("BIK", "БИК")
        .replace("OKTMO", "ОКТМО")
        .replace("KBK", "КБК")
        .replace("KBE", "КБК")
        .replace("КВК", "КБК")
    )

    payee_inn, kpp = _extract_inn_kpp(text, fuzzy)
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

    purpose = _extract_purpose(text)

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


def _looks_like_handwriting_garbage(s: str) -> bool:
    """OCR рукописи обычно даёт кашу из символов без нормальных слов."""
    t = (s or "").strip()
    if len(t) < 3:
        return True
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", t)
    digits = re.findall(r"\d", t)
    if len(letters) < 6 and len(digits) < 4:
        return True
    # Мало пробелов при длинной строке — типичный мусор OCR
    if len(t) > 18 and t.count(" ") + t.count(",") < 1:
        return True
    # Слишком много «странных» символов
    weird = len(re.findall(r"[^\w\s,.\-«»\"'()№/]", t, re.UNICODE))
    if weird >= max(3, len(t) // 6):
        return True
    # Нет ни одного «словесного» куска из 3+ букв
    if not re.search(r"[A-Za-zА-Яа-яЁё]{3,}", t):
        return True
    return False


def _extract_purpose(text: str) -> str:
    """Читаем назначение, если оно распозналось; СПР сами не подставляем."""
    candidates: list[str] = []
    m = re.search(
        r"(?:наименование платежа|назначение платежа)[^\n]*\n([^\n]{3,120})",
        text,
        re.I,
    )
    if m:
        cand = m.group(1).strip()
        if not re.search(r"^(дата|сумма|плательщик)\b", cand, re.I):
            candidates.append(cand)

    # Печатные/читаемые строки с ФИО рядом с назначением — без автодобавления «СПР»
    for m in re.finditer(
        r"(?m)^(?!.*(ИНН|КПП|БИК|КБК|ОКТМО|ЕКС|сч[её]т|банк).*)"
        r"([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,4}.*)$",
        text,
    ):
        cand = m.group(2).strip()
        if 6 <= len(cand) <= 100:
            candidates.append(cand)

    for cand in candidates:
        cleaned = re.sub(r"\s+", " ", cand).strip(" .;|")
        # Не оставляем одно только «СПР» / «СПГ» без остального текста
        if re.fullmatch(r"СП[РГ]\s*", cleaned, re.I):
            continue
        if _looks_like_handwriting_garbage(cleaned):
            continue
        return cleaned
    return ""


def parse_receipt_image(image_bytes: bytes) -> tuple[PaymentFields, str]:
    text = extract_text(image_bytes)
    return parse_receipt_text(text), text
