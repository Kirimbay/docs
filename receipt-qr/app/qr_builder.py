"""Сборка и генерация QR по ГОСТ Р 56042-2014 (ST00012)."""

from __future__ import annotations

import io
import re
from dataclasses import asdict, dataclass, fields
from typing import Any

import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_M

REQUIRED = ("name", "personal_acc", "bank_name", "bic", "corresp_acc")


@dataclass
class PaymentFields:
    name: str = ""
    personal_acc: str = ""
    bank_name: str = ""
    bic: str = ""
    corresp_acc: str = ""
    payee_inn: str = ""
    kpp: str = ""
    sum_rub: str = ""
    purpose: str = ""
    cbc: str = ""
    oktmo: str = ""
    pers_acc: str = ""

    def cleaned(self) -> "PaymentFields":
        data = {f.name: (getattr(self, f.name) or "").strip() for f in fields(self)}
        return PaymentFields(**data)

    def to_api(self) -> dict[str, str]:
        return asdict(self.cleaned())


def rub_to_kopecks(sum_rub: str) -> str:
    raw = (sum_rub or "").strip().lower().replace("\u00a0", " ").replace(" ", "")
    raw = re.sub(r"[^\d.,]", "", raw)
    if not raw:
        return ""
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        value = float(raw)
    except ValueError:
        digits = re.sub(r"\D", "", raw)
        return f"{int(digits) * 100}" if digits else ""
    return str(int(round(value * 100)))


def build_payload(fields_in: PaymentFields) -> str:
    f = fields_in.cleaned()
    missing = [k for k in REQUIRED if not getattr(f, k)]
    if missing:
        raise ValueError(f"Не хватает обязательных полей: {', '.join(missing)}")

    pairs: list[tuple[str, str]] = [
        ("Name", f.name),
        ("PersonalAcc", re.sub(r"\D", "", f.personal_acc)),
        ("BankName", f.bank_name),
        ("BIC", re.sub(r"\D", "", f.bic)),
        ("CorrespAcc", re.sub(r"\D", "", f.corresp_acc)),
    ]
    if f.payee_inn:
        pairs.append(("PayeeINN", re.sub(r"\D", "", f.payee_inn)))
    if f.kpp:
        pairs.append(("KPP", re.sub(r"\D", "", f.kpp)))
    kopecks = rub_to_kopecks(f.sum_rub)
    if kopecks:
        pairs.append(("Sum", kopecks))
    if f.purpose:
        pairs.append(("Purpose", f.purpose))
    if f.pers_acc:
        pairs.append(("PersAcc", f.pers_acc))
    if f.cbc:
        pairs.append(("CBC", re.sub(r"\D", "", f.cbc)))
    if f.oktmo:
        pairs.append(("OKTMO", re.sub(r"\D", "", f.oktmo)))
    return "ST00012|" + "|".join(f"{k}={v}" for k, v in pairs if v)


def make_qr_png(payload: str, box_size: int = 12) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img: Image.Image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def fields_from_dict(data: dict[str, Any]) -> PaymentFields:
    known = {f.name for f in fields(PaymentFields)}
    return PaymentFields(**{k: str(v or "") for k, v in data.items() if k in known})
