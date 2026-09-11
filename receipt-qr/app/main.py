"""FastAPI: загрузка квитанции → поля → QR."""

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ocr import ocr_image, parse_receipt_image, parse_receipt_text, prepare_image
from .qr_builder import PaymentFields, build_payload, fields_from_dict, make_qr_png

BASE = Path(__file__).resolve().parent

app = FastAPI(title="КвитQR", description="Квитанция → банковский QR ST00012")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")

MAX_UPLOAD_MB = 12


class FieldsIn(BaseModel):
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


def _event(pct: int, stage: str, label: str, **extra) -> str:
    return json.dumps(
        {"pct": pct, "stage": stage, "label": label, **extra},
        ensure_ascii=False,
    ) + "\n"


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (BASE / "templates" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.post("/api/parse")
async def api_parse(file: UploadFile = File(...)) -> JSONResponse:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Нужно изображение (фото квитанции)")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(400, f"Файл больше {MAX_UPLOAD_MB} МБ")
    if not data:
        raise HTTPException(400, "Пустой файл")

    try:
        fields, raw_text = parse_receipt_image(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Не удалось распознать: {exc}") from exc

    return JSONResponse(
        {
            "fields": fields.to_api(),
            "raw_text": raw_text,
            "hints": _hints(fields),
        }
    )


@app.post("/api/process")
async def api_process(file: UploadFile = File(...)) -> StreamingResponse:
    """NDJSON-поток с реальными этапами. 100% только когда всё готово."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Нужно изображение (фото квитанции)")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(400, f"Файл больше {MAX_UPLOAD_MB} МБ")
    if not data:
        raise HTTPException(400, "Пустой файл")

    async def generate():
        try:
            yield _event(12, "received", "Файл получен")
            await asyncio.sleep(0)

            prepared = await asyncio.to_thread(prepare_image, data)
            yield _event(22, "preprocess", "Подготовка изображения")
            await asyncio.sleep(0)

            # Долгий OCR: клиент анимирует до ~68%, не доходя до 70
            yield _event(28, "ocr", "Распознавание текста")
            await asyncio.sleep(0)
            raw_text = await asyncio.to_thread(ocr_image, prepared)
            yield _event(70, "ocr_done", "Текст распознан")
            await asyncio.sleep(0)

            fields = await asyncio.to_thread(parse_receipt_text, raw_text)
            yield _event(
                82,
                "parsed",
                "Реквизиты собраны",
                fields=fields.to_api(),
                hints=_hints(fields),
            )
            await asyncio.sleep(0)

            qr_error = None
            data_url = ""
            payload = ""
            try:
                payload = build_payload(fields)
                png = make_qr_png(payload)
                data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
                yield _event(94, "qr", "QR собран")
            except ValueError as exc:
                qr_error = str(exc)
                yield _event(94, "qr_skip", "QR после проверки полей")
            await asyncio.sleep(0)

            yield _event(
                100,
                "done",
                "Готово",
                fields=fields.to_api(),
                hints=_hints(fields),
                raw_text=raw_text,
                payload=payload,
                data_url=data_url,
                qr_error=qr_error,
            )
        except Exception as exc:  # noqa: BLE001
            yield _event(100, "error", "Ошибка обработки", error=str(exc))

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/qr")
async def api_qr(body: FieldsIn) -> JSONResponse:
    fields = fields_from_dict(body.model_dump())
    try:
        payload = build_payload(fields)
        png = make_qr_png(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Ошибка QR: {exc}") from exc

    b64 = base64.b64encode(png).decode("ascii")
    return JSONResponse(
        {
            "payload": payload,
            "png_base64": b64,
            "data_url": f"data:image/png;base64,{b64}",
        }
    )


@app.post("/api/qr.png")
async def api_qr_png(body: FieldsIn) -> Response:
    fields = fields_from_dict(body.model_dump())
    try:
        payload = build_payload(fields)
        png = make_qr_png(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="payment-qr.png"'},
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _hints(fields: PaymentFields) -> list[str]:
    hints: list[str] = []
    if not fields.purpose:
        hints.append("Назначение платежа часто рукописное — проверьте и допишите вручную.")
    missing = [
        label
        for key, label in (
            ("name", "получатель"),
            ("personal_acc", "счёт"),
            ("bank_name", "банк"),
            ("bic", "БИК"),
            ("corresp_acc", "ЕКС / корсчёт"),
        )
        if not getattr(fields, key)
    ]
    if missing:
        hints.append("Не нашлись поля: " + ", ".join(missing) + ". Заполните вручную.")
    if fields.sum_rub:
        hints.append(f"Сумма распознана как {fields.sum_rub} ₽ — сверьте.")
    return hints
