from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SSHConfig(BaseModel):
    host: str
    user: str = "root"
    port: int = 22
    key_path: str | None = None
    password: str | None = None


class NodeConfig(BaseModel):
    id: str
    name: str
    country: str
    enabled: bool = True
    base_url: str
    admin_proxy_path: str
    api_key: str
    user_proxy_path: str
    ssh: SSHConfig | None = None

    @property
    def api_base(self) -> str:
        base = self.base_url.rstrip("/")
        path = self.admin_proxy_path.strip("/")
        return f"{base}/{path}/api/v2"

    def subscription_url(self, user_uuid: str) -> str:
        base = self.base_url.rstrip("/")
        path = self.user_proxy_path.strip("/")
        return f"{base}/{path}/{user_uuid}/"


class HubConfig(BaseModel):
    admin_password: str
    listen_host: str = "0.0.0.0"
    listen_port: int = 8080
    public_url: str
    health_check_interval: int = 120
    auto_apply_users: bool = True


class DefaultsConfig(BaseModel):
    package_days: int = 30
    usage_limit_gb: float = 100
    mode: str = "no_reset"
    enable: bool = True


class AppConfig(BaseModel):
    hub: HubConfig
    nodes: list[NodeConfig]
    defaults: DefaultsConfig = Field(default_factory=DefaultsConfig)

    def enabled_nodes(self) -> list[NodeConfig]:
        return [n for n in self.nodes if n.enabled]


class UserRecord(BaseModel):
    uuid: str
    name: str
    comment: str = ""
    package_days: int
    usage_limit_gb: float
    mode: str = "no_reset"
    enable: bool = True
    start_date: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    node_sync: dict[str, str] = Field(default_factory=dict)


class NodeHealth(BaseModel):
    node_id: str
    healthy: bool
    latency_ms: float | None = None
    error: str | None = None
    checked_at: datetime


class BackupPayload(BaseModel):
    version: str = "1.0"
    exported_at: str
    config: dict[str, Any]
    users: list[dict[str, Any]]
    node_health: list[dict[str, Any]] = Field(default_factory=list)
