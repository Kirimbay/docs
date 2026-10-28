from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx


class HiddifyError(RuntimeError):
    pass


class HiddifyAdminClient:
    def __init__(
        self,
        base_url: str,
        admin_proxy_path: str,
        api_key: str,
        *,
        verify_tls: bool = True,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.admin_proxy_path = admin_proxy_path.strip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Accept": "application/json",
                "Hiddify-API-Key": api_key,
            },
            verify=verify_tls,
            timeout=timeout,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "HiddifyAdminClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _admin(self, path: str) -> str:
        return f"/{self.admin_proxy_path}/api/v2/admin/{path.lstrip('/')}"

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._client.request(method, self._admin(path), **kwargs)
        if response.status_code >= 400:
            raise HiddifyError(
                f"{method} {path} -> {response.status_code}: {response.text[:500]}"
            )
        if not response.content:
            return None
        ctype = response.headers.get("content-type", "")
        if "json" in ctype:
            return response.json()
        try:
            return response.json()
        except ValueError as exc:
            raise HiddifyError(f"Non-JSON response from {path}: {response.text[:200]}") from exc

    def ping(self) -> Any:
        for path in ("server_status/", "me/"):
            try:
                return self._request("GET", path)
            except HiddifyError:
                continue
        raise HiddifyError(f"Cannot reach admin API at {self.base_url}")

    def list_users(self) -> list[dict[str, Any]]:
        data = self._request("GET", "user/")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("users", "data", "items"):
                value = data.get(key)
                if isinstance(value, list):
                    return value
        raise HiddifyError(f"Unexpected user list payload: {type(data).__name__}")

    def create_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "user/", json=payload)
        return result if isinstance(result, dict) else {"raw": result}

    def patch_user(self, uuid: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("PATCH", f"user/{uuid}/", json=payload)
        return result if isinstance(result, dict) else {"raw": result}


def user_sub_url(base_url: str, user_proxy_path: str, uuid: str, suffix: str) -> str:
    suffix = suffix.lstrip("/")
    path = f"/{user_proxy_path.strip('/')}/{uuid}/{suffix}"
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
