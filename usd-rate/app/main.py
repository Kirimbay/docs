"""FastAPI: курс доллара ЦБ РФ — чистый полноэкранный лендинг."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .cbr import get_usd_rate

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE = Path(__file__).resolve().parent
app = FastAPI(title="курс", description="Доллар США — курс ЦБ РФ")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    try:
        rate = get_usd_rate()
        payload = rate.to_api()
        error = None
    except Exception as exc:  # noqa: BLE001
        logger.exception("Курс недоступен")
        payload = None
        error = str(exc)
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "rate": payload, "error": error},
    )


@app.get("/api/rate")
async def api_rate() -> JSONResponse:
    try:
        return JSONResponse(get_usd_rate().to_api())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Курс ЦБ недоступен: {exc}") from exc


@app.get("/api/health")
async def health() -> dict[str, object]:
    try:
        rate = get_usd_rate()
        return {"status": "ok", "usd": rate.value, "date": rate.date}
    except Exception as exc:  # noqa: BLE001
        return {"status": "degraded", "error": str(exc)}
