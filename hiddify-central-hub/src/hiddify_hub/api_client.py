from __future__ import annotations

import logging
import subprocess
from typing import Any

import httpx

from .models import NodeConfig

logger = logging.getLogger(__name__)


class HiddifyAPIError(Exception):
    def __init__(self, message: str, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class HiddifyClient:
    def __init__(self, node: NodeConfig, timeout: float = 30.0) -> None:
        self.node = node
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Hiddify-API-Key": self.node.api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self.node.api_base}/{path.lstrip('/')}"

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = self._url(path)
        with httpx.Client(timeout=self.timeout, verify=True) as client:
            response = client.request(method, url, headers=self._headers(), **kwargs)
        if response.status_code >= 400:
            raise HiddifyAPIError(
                f"{self.node.id}: {method} {path} failed: {response.text}",
                status_code=response.status_code,
                payload=response.text,
            )
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.text

    def ping(self) -> dict[str, Any]:
        return self.request("GET", "panel/ping/")

    def list_users(self) -> list[dict[str, Any]]:
        data = self.request("GET", "admin/user/")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("users") or data.get("items") or []
        return []

    def get_user(self, uuid: str) -> dict[str, Any] | None:
        try:
            return self.request("GET", f"admin/user/{uuid}/")
        except HiddifyAPIError as exc:
            if exc.status_code == 404:
                return None
            raise

    def create_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "admin/user/", json=payload)

    def update_user(self, uuid: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PATCH", f"admin/user/{uuid}/", json=payload)

    def delete_user(self, uuid: str) -> None:
        self.request("DELETE", f"admin/user/{uuid}/")

    def fetch_subscription(self, user_uuid: str) -> str:
        url = self.node.subscription_url(user_uuid)
        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            response = client.get(url)
        if response.status_code >= 400:
            raise HiddifyAPIError(
                f"{self.node.id}: subscription fetch failed",
                status_code=response.status_code,
                payload=response.text,
            )
        return response.text

    def apply_users_via_ssh(self) -> tuple[bool, str]:
        ssh = self.node.ssh
        if not ssh:
            return False, "SSH not configured"
        cmd = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-p",
            str(ssh.port),
        ]
        if ssh.key_path:
            cmd.extend(["-i", ssh.key_path])
        remote = (
            "/opt/hiddify-manager/common/commander.py apply-users && "
            "systemctl restart hiddify-singbox || true"
        )
        cmd.append(f"{ssh.user}@{ssh.host}")
        cmd.append(remote)
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=False)
            if result.returncode != 0:
                return False, result.stderr or result.stdout
            return True, result.stdout
        except subprocess.TimeoutExpired:
            return False, "SSH apply-users timed out"
        except OSError as exc:
            return False, str(exc)
