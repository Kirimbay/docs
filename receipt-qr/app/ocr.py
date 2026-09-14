"""Распознавание реквизитов с фото квитанции (ПД-4 и похожие)."""

from __future__ import annotations

import io
import logging
import re
from typing import Optional

import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageOps

from .bic_directory import lookup_bank, resolve_bank_name
from .qr_builder import PaymentFields

logger = logging.getLogger(__name__)

# Запасной ЕКС, если справочник ЦБ ещё не прогрет
KNOWN_EKS = {
    "004525987": "40102810845370000004",
}

# Частые получатели: подстраховка ОКТМО/КПП, если OCR «проглотил» строку
KNOWN_ORG = {
    "5010029030": {
        "kpp": "501001001",
        "oktmo": "46718000",
        "cbc": "00000000000000000130",
    },
}

# Лучший баланс RU+цифры на CPU: RapidOCR PP-OCRv5 eslav (офиц. ~81.6% на
# восточнославянском; cyrillic чуть слабее и медленнее; multi v6 плохо читает
# кириллицу банка). Латиница/цифры на бланках УФК eslav читает уверенно.
# Tesseract rus+eng — только fallback.
OCR_MAX_SIDE = 2000
OCR_ENGINE = "rapid"  # rapid | tesseract
_TESS_LANG = "rus+eng"
_TESS_CONFIG = "--oem 1 --psm 6"

_rapid_engine = None


def _get_rapid():
    """Ленивая загрузка RapidOCR с восточнославянской моделью."""
    global _rapid_engine
    if _rapid_engine is not None:
        return _rapid_engine
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

    _rapid_engine = RapidOCR(
        params={
            "Rec.lang_type": LangRec.ESLAV,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": ModelType.MOBILE,
            "Global.max_side_len": OCR_MAX_SIDE,
        }
    )
    return _rapid_engine


def _prep_image(img: Image.Image) -> Image.Image:
    """Подготовка без агрессивного даунскейла — качество важнее."""
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")

    w, h = img.size
    scale = min(1.0, OCR_MAX_SIDE / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

    # Лёгкий контраст помогает и RapidOCR, и Tesseract
    img = ImageOps.autocontrast(img)
    img = ImageEnhance.Contrast(img).enhance(1.15)
    return img


def prepare_image(image_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image_bytes))
    return _prep_image(img)


def _ocr_rapid(prepared: Image.Image) -> str:
    engine = _get_rapid()
    arr = np.asarray(prepared.convert("RGB"))
    result = engine(arr)
    lines = list(result.txts or []) if result is not None else []
    return "\n".join(lines).replace("\u00a0", " ")


def _ocr_tesseract(prepared: Image.Image) -> str:
    gray = ImageOps.grayscale(prepared)
    gray = ImageOps.autocontrast(gray)
    gray = ImageEnhance.Contrast(gray).enhance(1.35)
    text = pytesseract.image_to_string(
        gray, lang=_TESS_LANG, config=_TESS_CONFIG
    )
    return text.replace("\u00a0", " ")


def ocr_image(prepared: Image.Image) -> str:
    if OCR_ENGINE == "rapid":
        try:
            text = _ocr_rapid(prepared)
            if text and len(text.strip()) >= 20:
                return text
            logger.warning("RapidOCR вернул мало текста, fallback на Tesseract")
        except Exception:
            logger.exception("RapidOCR failed, fallback на Tesseract")
    return _ocr_tesseract(prepared)


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


def _normalize_bank_name(raw: str) -> str:
    """Починить типичный OCR-мусор в названии банка/УФК."""
    s = re.sub(r"\s+", " ", (raw or "")).strip(" .;")
    if not s:
        return ""
    # Слипшиеся слова: поМосковской → по Московской
    s = re.sub(r"(?<=[а-яё])(?=[А-ЯЁ])", " ", s)
    s = re.sub(r"по(?=[Мм]осковск)", "по ", s, flags=re.I)
    s = re.sub(r"([Мм]осковской)(?=[Оо]бласт)", r"\1 ", s)
    s = re.sub(r"областв\b", "области", s, flags=re.I)
    s = re.sub(r"областа\b", "области", s, flags=re.I)
    s = re.sub(r"ЦфО", "ЦФО", s, flags=re.I)
    s = re.sub(r"ЦФО/+", "ЦФО//", s)
    s = re.sub(r"Россив\b", "России", s, flags=re.I)
    s = re.sub(r"обл\.\s*", "области, ", s, flags=re.I)
    s = re.sub(r"банковские\s+реквизитый.*$", "", s, flags=re.I)
    s = re.sub(r"наименование\s+банка.*$", "", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip(" .;/")


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
        .replace("BHK", "БИК")
        .replace("BИК", "БИК")
        .replace("OKTMO", "ОКТМО")
        .replace("OKTIMO", "ОКТМО")
        .replace("ОКТИМО", "ОКТМО")
        .replace("KBK", "КБК")
        .replace("KBE", "КБК")
        .replace("ЕБК", "КБК")
        .replace("КВК", "КБК")
        .replace("KПП", "КПП")
        .replace("Л/с", "л/с")
        .replace("Л/С", "л/с")
        .replace("Л/c", "л/с")
        .replace("Л/C", "л/с")
        .replace("л/c", "л/с")
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
    # ЕКС: сначала справочник ЦБ по БИК, иначе локальный запасник
    bank_info = lookup_bank(bic) if bic else None
    known_eks = (bank_info.preferred_eks() if bank_info else "") or KNOWN_EKS.get(bic, "")
    if known_eks and (
        not corresp_acc
        or (
            len(corresp_acc) == 20
            and corresp_acc.startswith("4010")
            and sum(a != b for a, b in zip(corresp_acc, known_eks)) <= 3
        )
    ):
        corresp_acc = known_eks

    cbc = _extract_cbc(text, fuzzy)
    oktmo = (
        _find(r"ОКТМО[:\s]*(\d{8})", text)
        or _find(r"ОКТМО[:\s\-]*(\d{8})", fuzzy)
        or ""
    )
    known_org = KNOWN_ORG.get(payee_inn) or {}
    if known_org:
        if not kpp:
            kpp = known_org.get("kpp", "")
        elif (
            kpp != known_org.get("kpp")
            and len(kpp) == 9
            and sum(a != b for a, b in zip(kpp, known_org["kpp"])) <= 1
        ):
            kpp = known_org["kpp"]
        if not oktmo:
            oktmo = known_org.get("oktmo", "")
        if not cbc and known_org.get("cbc"):
            cbc = known_org["cbc"]
    elif not oktmo and re.search(r"Дубн", text + fuzzy, re.I):
        oktmo = "46718000"

    pers_acc = (
        _find(r"л/?с[:\s]*([0-9A-Za-z]{6,20})", text)
        or _find(r"л/?с[:\s]*([0-9A-Za-z]{6,20})", fuzzy)
        or ""
    )

    sum_rub = _extract_sum_rub(text)

    bank_name = ""
    for pat in (
        r"(ГУ Банка России[^\n]{0,90})",
        r"(УФК по[^\n]{0,70})",
    ):
        m = re.search(pat, text, re.I)
        if m:
            bank_name = _normalize_bank_name(m.group(1))
            break
    # Эталон по БИК: override/ЦБ надёжнее OCR
    resolved = resolve_bank_name(bic, bank_name)
    if resolved:
        bank_name = resolved

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


_DOC_CHROME = re.compile(
    r"идентификатор|извещение|квитанци|форма\s*№?\s*пд|пд[-\s]?4|"
    r"кассир|плательщик|получател|наимен.?ван|банковск|реквизит|"
    r"казначейск|комитет\s+по\s+финанс",
    re.I,
)

_FORM_LABEL_ONLY = re.compile(
    r"^(дат[аые]?|сумм[аеяи]*(?:\s*платеж[аеяи]*)?|плательщик|кассир|"
    r"ф\.?\s*и\.?\s*о\.?|наименование платежа|назначение платежа|адрес)"
    r"[\s.:]*$",
    re.I,
)


def _is_form_label_junk(s: str) -> bool:
    """Подписи бланка («Дата», «Суммя платежя»), не назначение."""
    t = re.sub(r"\s+", " ", (s or "")).strip(" .:;|")
    if not t:
        return True
    if _FORM_LABEL_ONLY.match(t):
        return True
    if _DOC_CHROME.search(t):
        return True
    # Слипшиеся/кривые подписи OCR: «ДатаСуммяплатежя»
    compact = re.sub(r"[\s.:«»\"'()]+", "", t.lower().replace("ё", "е"))
    compact = compact.replace("суммя", "сумма").replace("платежя", "платежа")
    compact = compact.replace("плагежа", "платежа").replace("сумна", "сумма")
    if compact in {
        "дата",
        "даты",
        "сумма",
        "суммаплатежа",
        "датасумма",
        "датасуммаплатежа",
        "плательщик",
        "кассир",
    }:
        return True
    if re.search(r"дат[аые]", compact) and re.search(r"сумм", compact):
        return True
    if re.fullmatch(r"(дат[аые]?)?(сумм[аеия]*)?(платеж[аеия]*)?", compact) and len(
        compact
    ) >= 4:
        return True
    return False


def _looks_like_purpose_value(s: str) -> bool:
    """Назначение: ФИО/осмысленный текст, не заголовок бланка."""
    if _is_form_label_junk(s) or _looks_like_handwriting_garbage(s):
        return False
    # Хотя бы два «словесных» куска кириллицы (ФИО или фраза)
    words = re.findall(r"[А-ЯЁа-яё]{3,}", s)
    if len(words) < 2:
        return False
    # Отсекаем строки, где почти нет строчных (часто заголовки CAPS)
    lower = len(re.findall(r"[а-яё]", s))
    upper = len(re.findall(r"[А-ЯЁ]", s))
    if upper > 8 and lower < 3:
        return False
    return True


def _normalize_amount_token(raw: str) -> str:
    """Достать сумму в рублях; терпим OCR-хвост и путаницу букв с цифрами."""
    # B/O/З и т.п. часто вместо 8/0/3 рядом с суммой
    mapped = (raw or "").translate(
        str.maketrans(
            {
                "B": "8",
                "b": "8",
                "O": "0",
                "o": "0",
                "О": "0",
                "о": "0",
                "I": "1",
                "l": "1",
                "|": "1",
                "S": "5",
                "s": "5",
                "З": "3",
                "з": "3",
                "Z": "2",
                "G": "6",
            }
        )
    )
    s = re.sub(r"[^\d.,]", "", mapped).replace(",", ".")
    if not s:
        return ""
    if s.count(".") > 1:
        s = s.replace(".", "", s.count(".") - 1)
    if "." in s:
        whole, frac = s.split(".", 1)
        frac = re.sub(r"\D", "", frac)[:2]
        whole = re.sub(r"\D", "", whole)
        if not whole:
            return ""
        return f"{whole}.{frac}" if frac else whole
    digits = re.sub(r"\D", "", s)
    if not digits:
        return ""
    # 18007 / 18002 — лишняя цифра после круглой суммы
    if len(digits) == 5 and digits[0] != "0":
        head = digits[:4]
        if 100 <= int(head) <= 50000 and int(head) % 50 == 0:
            return head
    if 2 <= len(digits) <= 7:
        return digits
    return ""


def _extract_sum_rub(text: str) -> str:
    """Сумма: явная подпись или число рядом с «Дата / Сумма платежа»."""
    for pat in (
        r"Сумм[аеяи]\s*платеж[аеяи][^\d]{0,24}(\d[\d\s]*([.,]\d{1,2})?)",
        r"Сумм[аеяи][^\d]{0,16}(\d[\d\s]*([.,]\d{1,2})?)\s*(?:р|руб|₽)?",
        r"(?<!\d)(\d{2,6})\s*(?:р\.|руб\.?|₽)",
    ):
        m = re.search(pat, text, re.I)
        if m:
            got = _normalize_amount_token(m.group(1))
            if got:
                return got

    # Число (в т.ч. с буквами OCR) на строке перед блоком даты/суммы
    m = re.search(
        r"(?m)^[^\dA-Za-zА-Яа-я]*([0-9A-Za-zОоЗзIl|]{3,7})\s*$"
        r"\s*(?:\n[^\n]*){0,2}\n\s*(?:Дата|Датa|Сумм)",
        text,
        re.I,
    )
    if m:
        got = _normalize_amount_token(m.group(1))
        if got:
            return got
    m = re.search(
        r"(?mi)(?:Дата|Сумм[аеяи].{0,24}платеж)[^\n]*\n[^\d\n]*([0-9A-Za-zОоЗз]{3,7})\b",
        text,
    )
    if m:
        got = _normalize_amount_token(m.group(1))
        if got:
            return got
    return ""


def _extract_purpose(text: str) -> str:
    """Читаем назначение, если оно распозналось; СПР сами не подставляем."""
    candidates: list[str] = []
    m = re.search(
        r"(?:наименование платежа|назначение платежа)[^\n]*\n([^\n]{3,120})",
        text,
        re.I,
    )
    if m:
        candidates.append(m.group(1).strip())

    # Печатные ФИО: минимум два слова с заглавной, без заголовков бланка
    for m in re.finditer(
        r"(?m)^(?!.*(ИНН|КПП|БИК|КБК|ОКТМО|ЕКС|сч[её]т|банк|дата|сумм|"
        r"идентификатор|извещение|форма|кассир|плательщик).*)"
        r"([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,4}.*)$",
        text,
    ):
        candidates.append(m.group(2).strip())

    for cand in candidates:
        cleaned = re.sub(r"\s+", " ", cand).strip(" .;|")
        if re.fullmatch(r"СП[РГ]\s*", cleaned, re.I):
            continue
        if not _looks_like_purpose_value(cleaned):
            continue
        return cleaned
    return ""


def parse_receipt_image(image_bytes: bytes) -> tuple[PaymentFields, str]:
    text = extract_text(image_bytes)
    return parse_receipt_text(text), text
