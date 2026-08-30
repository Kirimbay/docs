from __future__ import annotations

import secrets
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Form, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from .backup import BackupManager
from .config import AppConfig
from .database import HubDatabase
from .sync import HealthChecker, SubscriptionAggregator, SyncEngine

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def create_app(config: AppConfig, config_path: Path, db: HubDatabase) -> FastAPI:
    app = FastAPI(title="Hiddify Central Hub", version="1.0.0")
    sessions: set[str] = set()
    scheduler = BackgroundScheduler()

    def auth(request: Request) -> None:
        token = request.cookies.get("hub_session")
        if not token or token not in sessions:
            raise HTTPException(status_code=401, detail="Unauthorized")

    @app.on_event("startup")
    def startup() -> None:
        def job() -> None:
            HealthChecker(config, db).check_all()

        scheduler.add_job(job, "interval", seconds=config.hub.health_check_interval, id="health")
        scheduler.start()
        job()

    @app.on_event("shutdown")
    def shutdown() -> None:
        scheduler.shutdown(wait=False)

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request) -> HTMLResponse:
        return TEMPLATES.TemplateResponse("login.html", {"request": request, "error": None})

    @app.post("/login")
    def login(request: Request, password: str = Form(...)) -> Response:
        if password != config.hub.admin_password:
            return TEMPLATES.TemplateResponse(
                "login.html",
                {"request": request, "error": "Неверный пароль"},
                status_code=401,
            )
        token = secrets.token_urlsafe(32)
        sessions.add(token)
        response = RedirectResponse("/", status_code=303)
        response.set_cookie("hub_session", token, httponly=True, samesite="lax")
        return response

    @app.get("/", response_class=HTMLResponse)
    def dashboard(request: Request, _: None = Depends(auth)) -> HTMLResponse:
        health = HealthChecker(config, db).check_all()
        users = db.list_users()
        return TEMPLATES.TemplateResponse(
            "dashboard.html",
            {
                "request": request,
                "users": users,
                "health": health,
                "public_url": config.hub.public_url.rstrip("/"),
            },
        )

    @app.post("/users/create")
    def create_user(
        request: Request,
        name: str = Form(...),
        days: int = Form(30),
        gb: float = Form(100),
        _: None = Depends(auth),
    ) -> RedirectResponse:
        SyncEngine(config, db).create_user(name, package_days=days, usage_limit_gb=gb)
        return RedirectResponse("/", status_code=303)

    @app.post("/users/{user_uuid}/renew")
    def renew_user(
        user_uuid: str,
        days: int = Form(30),
        gb: float | None = Form(None),
        _: None = Depends(auth),
    ) -> RedirectResponse:
        SyncEngine(config, db).renew_user(user_uuid, package_days=days, usage_limit_gb=gb)
        return RedirectResponse("/", status_code=303)

    @app.post("/users/{user_uuid}/disable")
    def disable_user(user_uuid: str, _: None = Depends(auth)) -> RedirectResponse:
        SyncEngine(config, db).disable_user(user_uuid)
        return RedirectResponse("/", status_code=303)

    @app.post("/sync-all")
    def sync_all(_: None = Depends(auth)) -> RedirectResponse:
        SyncEngine(config, db).sync_all_users()
        return RedirectResponse("/", status_code=303)

    @app.post("/backup")
    def backup(_: None = Depends(auth)) -> PlainTextResponse:
        path = Path("data/backups/auto-backup.tar.gz")
        BackupManager(config_path, db).export_backup(path)
        return PlainTextResponse(f"Backup created: {path}")

    @app.get("/sub/{user_uuid}")
    def unified_subscription(user_uuid: str) -> PlainTextResponse:
        try:
            body = SubscriptionAggregator(config, db).merged_subscription(user_uuid)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return PlainTextResponse(body, media_type="text/plain")

    @app.get("/health")
    def health_json() -> dict:
        return {"nodes": HealthChecker(config, db).check_all()}

    return app
