"""FastAPI: курсы USD / EUR / CNY / BTC — лендинг секциями."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .cbr import get_rates

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE = Path(__file__).resolve().parent
app = FastAPI(title="курс", description="USD · EUR · CNY · BTC")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    try:
        bundle = get_rates()
        payload = bundle.to_api()
        error = None
    except Exception as exc:  # noqa: BLE001
        logger.exception("Курсы недоступны")
        payload = None
        error = str(exc)
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"data": payload, "error": error},
    )


@app.get("/api/rate")
@app.get("/api/rates")
async def api_rates() -> JSONResponse:
    try:
        return JSONResponse(get_rates().to_api())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Курсы недоступны: {exc}") from exc


@app.get("/api/health")
async def health() -> dict[str, object]:
    try:
        bundle = get_rates()
        return {
            "status": "ok",
            "usd": bundle.usd.value,
            "eur": bundle.eur.value,
            "cny": bundle.cny.value,
            "btc": bundle.btc.value,
            "date": bundle.date,
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "degraded", "error": str(exc)}
