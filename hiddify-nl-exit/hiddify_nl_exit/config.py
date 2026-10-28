from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class SwedenPanel:
    id: str
    base_url: str
    admin_proxy_path: str
    admin_api_key: str
    user_proxy_path: str
    origin_url: str
    server_names: list[str] = field(default_factory=list)
    verify_tls: bool = True


@dataclass(frozen=True)
class NetherlandsPanel:
    base_url: str
    admin_proxy_path: str
    admin_api_key: str
    user_proxy_path: str
    added_by_uuid: str
    verify_tls: bool = True
    usage_limit_gb: float = 9000.0
    package_days: int = 3650
    mode: str = "no_reset"
    apply_users_command: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AppConfig:
    sweden: list[SwedenPanel]
    netherlands: NetherlandsPanel
    listen_host: str = "127.0.0.1"
    listen_port: int = 8471
    fetch_timeout_sec: float = 8.0
    dry_run: bool = False


def _require(data: dict[str, Any], key: str) -> Any:
    if key not in data or data[key] in (None, ""):
        raise ValueError(f"Missing required config field: {key}")
    return data[key]


def load_config(path: str | Path) -> AppConfig:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    nl_raw = _require(raw, "netherlands")
    sweden_raw = _require(raw, "sweden")
    if not isinstance(sweden_raw, list) or not sweden_raw:
        raise ValueError("config.sweden must be a non-empty list")

    sweden = [
        SwedenPanel(
            id=str(_require(item, "id")),
            base_url=str(_require(item, "base_url")).rstrip("/"),
            admin_proxy_path=str(_require(item, "admin_proxy_path")).strip("/"),
            admin_api_key=str(_require(item, "admin_api_key")),
            user_proxy_path=str(_require(item, "user_proxy_path")).strip("/"),
            origin_url=str(item.get("origin_url") or item["base_url"]).rstrip("/"),
            server_names=[str(n).lower() for n in item.get("server_names") or []],
            verify_tls=bool(item.get("verify_tls", True)),
        )
        for item in sweden_raw
    ]
    cmd = nl_raw.get("apply_users_command") or []
    if isinstance(cmd, str):
        cmd = [cmd]
    netherlands = NetherlandsPanel(
        base_url=str(_require(nl_raw, "base_url")).rstrip("/"),
        admin_proxy_path=str(_require(nl_raw, "admin_proxy_path")).strip("/"),
        admin_api_key=str(_require(nl_raw, "admin_api_key")),
        user_proxy_path=str(_require(nl_raw, "user_proxy_path")).strip("/"),
        added_by_uuid=str(nl_raw.get("added_by_uuid") or nl_raw["admin_api_key"]),
        verify_tls=bool(nl_raw.get("verify_tls", True)),
        usage_limit_gb=float(nl_raw.get("usage_limit_gb", 9000)),
        package_days=int(nl_raw.get("package_days", 3650)),
        mode=str(nl_raw.get("mode", "no_reset")),
        apply_users_command=[str(x) for x in cmd],
    )
    listen = raw.get("listen") or {}
    return AppConfig(
        sweden=sweden,
        netherlands=netherlands,
        listen_host=str(listen.get("host", "127.0.0.1")),
        listen_port=int(listen.get("port", 8471)),
        fetch_timeout_sec=float(raw.get("fetch_timeout_sec", 8)),
        dry_run=bool(raw.get("dry_run", False)),
    )


def panel_by_host(cfg: AppConfig, host: str) -> SwedenPanel | None:
    hostname = (host or "").split(":")[0].lower()
    for panel in cfg.sweden:
        names = panel.server_names or []
        if hostname in names:
            return panel
    if len(cfg.sweden) == 1:
        return cfg.sweden[0]
    return None
