"""Unit tests for QR payload and OCR heuristics."""

from app.ocr import parse_receipt_text
from app.qr_builder import PaymentFields, build_payload, rub_to_kopecks


SAMPLE_TEXT = """
ИЗВЕЩЕНИЕ
ИНН 5010029030 КПП 501001001 (Комитет по финансам и экономике г.о. Дубна
МБУДО «ДДШИ», л/с 20018UL3Z20)
казначейский счет № 03234643467180004800
ГУ Банка России по ЦФО//УФК по Московской области, г. Москва
БИК 004525987 ЕКС 40102810845370000004
КБК 00000000000000000130 ОКТМО 46718000
ОГРН 1095010001184 ОКПО 61565503
наименование платежа
Андрианова Аделина, Егорова Ксения Викторовна
Сумма платежа 1800 р
"""


def test_rub_to_kopecks():
    assert rub_to_kopecks("1800") == "180000"
    assert rub_to_kopecks("1800 р") == "180000"
    assert rub_to_kopecks("1 800,50") == "180050"


def test_build_payload_purpose_no_auto_ls():
    fields = PaymentFields(
        name="Комитет по финансам и экономике г.о. Дубна (МБУДО «ДДШИ»)",
        personal_acc="03234643467180004800",
        bank_name="ГУ Банка России по ЦФО//УФК по Московской области, г. Москва",
        bic="004525987",
        corresp_acc="40102810845370000004",
        payee_inn="5010029030",
        kpp="501001001",
        sum_rub="1800",
        purpose="СПР, Андрианова Аделина, Егорова Ксения Викторовна",
        cbc="00000000000000000130",
        oktmo="46718000",
        pers_acc="20018UL3Z20",
    )
    payload = build_payload(fields)
    assert payload.startswith("ST00012|")
    assert "Purpose=СПР, Андрианова Аделина, Егорова Ксения Викторовна" in payload
    assert "л/с" not in payload.split("Purpose=")[1].split("|")[0]
    assert "PersAcc=20018UL3Z20" in payload
    assert "Sum=180000" in payload


def test_parse_receipt_text_core_fields():
    fields = parse_receipt_text(SAMPLE_TEXT)
    assert fields.payee_inn == "5010029030"
    assert fields.kpp == "501001001"
    assert fields.bic == "004525987"
    assert fields.personal_acc == "03234643467180004800"
    assert fields.corresp_acc == "40102810845370000004"
    assert fields.cbc == "00000000000000000130"
    assert fields.oktmo == "46718000"
    assert fields.pers_acc == "20018UL3Z20"
    assert "1800" in fields.sum_rub
    assert "Комитет" in fields.name
    assert "Андрианова Аделина" in fields.purpose
    assert not fields.purpose.startswith("СПР")


def test_purpose_does_not_auto_insert_spr():
    text = SAMPLE_TEXT.replace(
        "наименование платежа\nАндрианова Аделина, Егорова Ксения Викторовна",
        "наименование платежа\nСПР\nдата",
    )
    fields = parse_receipt_text(text)
    assert fields.purpose == ""


def test_purpose_rejects_handwriting_garbage():
    text = SAMPLE_TEXT.replace(
        "наименование платежа\nАндрианова Аделина, Егорова Ксения Викторовна",
        "наименование платежа\n|~#@/\\\\ xx 3f ~~\nдата",
    )
    assert parse_receipt_text(text).purpose == ""


def test_known_eks_corrects_ocr_typo():
    text = SAMPLE_TEXT.replace(
        "ЕКС 40102810845370000004",
        "ЕКС 40102810845310000004",
    )
    fields = parse_receipt_text(text)
    assert fields.corresp_acc == "40102810845370000004"


def test_inn_ocr_mha_as_inn():
    """Tesseract часто читает «ИНН» как MHA, а «КПП» как KIH."""
    text = """
: MHA 5010029030:KIH 501001001 (Комитет по финансам и экономике г.о. Дубна
ИЗВЕЩЕНИЕ 5040029030; KITE 501001001 МБУДО «ДДШИ», л/с 20018UL3Z20)
казначейский счет № 03234643467180004800
БИК 004525987 ЕКС 40102810845370000004
КБК 00000000000000000130 ОКТМО 46718000
Сумма платежа 1800 р
"""
    fields = parse_receipt_text(text)
    assert fields.payee_inn == "5010029030"
    assert fields.kpp == "501001001"


def test_cbc_ocr_zero_as_eight():
    """OCR часто путает 0 с 8 в КБК из одних нулей + 130."""
    noisy = SAMPLE_TEXT.replace(
        "КБК 00000000000000000130",
        "КБК 00000008000000000130",
    )
    assert parse_receipt_text(noisy).cbc == "00000000000000000130"

    truncated = SAMPLE_TEXT.replace(
        "КБК 00000000000000000130",
        "KBK-0000000000000000013).",
    )
    assert parse_receipt_text(truncated).cbc == "00000000000000000130"

    last_zero_as_eight = SAMPLE_TEXT.replace(
        "КБК 00000000000000000130",
        "КБК 00000000000000000138",
    )
    assert parse_receipt_text(last_zero_as_eight).cbc == "00000000000000000130"
