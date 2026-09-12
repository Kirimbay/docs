from __future__ import annotations

import base64
import logging
import time
from datetime import date

import httpx

from .api_client import HiddifyAPIError, HiddifyClient
from .database import HubDatabase
from .models import AppConfig, DefaultsConfig, NodeConfig, UserRecord

logger = logging.getLogger(__name__)


def _today() -> str:
    return date.today().isoformat()


def user_to_hiddify_payload(user: UserRecord) -> dict:
    return {
        "uuid": user.uuid,
        "name": user.name,
        "comment": user.comment,
        "package_days": user.package_days,
        "usage_limit_GB": user.usage_limit_gb,
        "mode": user.mode,
        "enable": user.enable,
        "start_date": user.start_date or _today(),
    }


class SyncEngine:
    def __init__(self, config: AppConfig, db: HubDatabase) -> None:
        self.config = config
        self.db = db

    def create_user(
        self,
        name: str,
        *,
        uuid: str | None = None,
        comment: str = "",
        package_days: int | None = None,
        usage_limit_gb: float | None = None,
        mode: str | None = None,
        nodes: list[str] | None = None,
    ) -> UserRecord:
        defaults: DefaultsConfig = self.config.defaults
        import uuid as uuid_lib

        user = UserRecord(
            uuid=uuid or str(uuid_lib.uuid4()),
            name=name,
            comment=comment,
            package_days=package_days if package_days is not None else defaults.package_days,
            usage_limit_gb=usage_limit_gb if usage_limit_gb is not None else defaults.usage_limit_gb,
            mode=mode or defaults.mode,
            enable=defaults.enable,
            start_date=_today(),
        )
        target_nodes = self._select_nodes(nodes)
        self._sync_user_to_nodes(user, target_nodes, operation="create")
        self.db.upsert_user(user)
        self.db.log_action("create_user", user.uuid, {"name": name, "nodes": [n.id for n in target_nodes]})
        return user

    def renew_user(
        self,
        user_uuid: str,
        *,
        package_days: int | None = None,
        usage_limit_gb: float | None = None,
        enable: bool = True,
        reset_start_date: bool = True,
    ) -> UserRecord:
        user = self.db.get_user(user_uuid)
        if not user:
            raise ValueError(f"User {user_uuid} not found in hub database")

        if package_days is not None:
            user.package_days = package_days
        if usage_limit_gb is not None:
            user.usage_limit_gb = usage_limit_gb
        user.enable = enable
        if reset_start_date:
            user.start_date = _today()

        target_nodes = self._select_nodes(None)
        self._sync_user_to_nodes(user, target_nodes, operation="update")
        self.db.upsert_user(user)
        self.db.log_action(
            "renew_user",
            user.uuid,
            {
                "package_days": user.package_days,
                "usage_limit_gb": user.usage_limit_gb,
                "enable": user.enable,
            },
        )
        return user

    def disable_user(self, user_uuid: str) -> UserRecord:
        user = self.db.get_user(user_uuid)
        if not user:
            raise ValueError(f"User {user_uuid} not found")
        user.enable = False
        target_nodes = self._select_nodes(None)
        self._sync_user_to_nodes(user, target_nodes, operation="update")
        self.db.upsert_user(user)
        self.db.log_action("disable_user", user.uuid)
        return user

    def delete_user(self, user_uuid: str, *, nodes: list[str] | None = None) -> None:
        target_nodes = self._select_nodes(nodes)
        for node in target_nodes:
            client = HiddifyClient(node)
            try:
                client.delete_user(user_uuid)
                self.db.set_node_sync(user_uuid, node.id, "deleted")
            except HiddifyAPIError as exc:
                logger.warning("Delete on %s failed: %s", node.id, exc)
                self.db.set_node_sync(user_uuid, node.id, f"delete_error: {exc}")
        self.db.delete_user(user_uuid)
        self.db.log_action("delete_user", user_uuid)

    def sync_all_users(self, *, nodes: list[str] | None = None) -> dict[str, list[str]]:
        results: dict[str, list[str]] = {"ok": [], "failed": []}
        target_nodes = self._select_nodes(nodes)
        for user in self.db.list_users():
            try:
                self._sync_user_to_nodes(user, target_nodes, operation="update")
                results["ok"].append(user.uuid)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Sync failed for %s", user.uuid)
                results["failed"].append(f"{user.uuid}: {exc}")
        return results

    def import_from_node(self, node_id: str) -> int:
        node = self._get_node(node_id)
        client = HiddifyClient(node)
        remote_users = client.list_users()
        count = 0
        for raw in remote_users:
            uuid = raw.get("uuid") or raw.get("id")
            if not uuid:
                continue
            user = UserRecord(
                uuid=str(uuid),
                name=raw.get("name") or str(uuid)[:8],
                comment=raw.get("comment") or "",
                package_days=int(raw.get("package_days") or self.config.defaults.package_days),
                usage_limit_gb=float(raw.get("usage_limit_GB") or raw.get("usage_limit_gb") or 100),
                mode=raw.get("mode") or "no_reset",
                enable=bool(raw.get("enable", True)),
                start_date=raw.get("start_date"),
            )
            user.node_sync[node_id] = "imported"
            self.db.upsert_user(user)
            count += 1
        self.db.log_action("import_from_node", details={"node_id": node_id, "count": count})
        return count

    def _select_nodes(self, node_ids: list[str] | None) -> list[NodeConfig]:
        enabled = self.config.enabled_nodes()
        if not node_ids:
            return enabled
        allowed = {n.id for n in enabled}
        return [n for n in enabled if n.id in node_ids and n.id in allowed]

    def _get_node(self, node_id: str) -> NodeConfig:
        for node in self.config.nodes:
            if node.id == node_id:
                return node
        raise ValueError(f"Unknown node: {node_id}")

    def _sync_user_to_nodes(
        self,
        user: UserRecord,
        nodes: list[NodeConfig],
        *,
        operation: str,
    ) -> None:
        payload = user_to_hiddify_payload(user)
        for node in nodes:
            client = HiddifyClient(node)
            try:
                existing = client.get_user(user.uuid)
                if existing is None:
                    client.create_user(payload)
                    status = "created"
                else:
                    client.update_user(user.uuid, payload)
                    status = "updated"
                if self.config.hub.auto_apply_users:
                    ok, msg = client.apply_users_via_ssh()
                    status = f"{status}+apply" if ok else f"{status}+apply_failed:{msg[:120]}"
                user.node_sync[node.id] = status
                self.db.set_node_sync(user.uuid, node.id, status)
            except HiddifyAPIError as exc:
                user.node_sync[node.id] = f"error: {exc}"
                self.db.set_node_sync(user.uuid, node.id, user.node_sync[node.id])
                logger.error("Sync to %s failed: %s", node.id, exc)


class SubscriptionAggregator:
    def __init__(self, config: AppConfig, db: HubDatabase) -> None:
        self.config = config
        self.db = db

    def merged_subscription(self, user_uuid: str) -> str:
        user = self.db.get_user(user_uuid)
        if not user or not user.enable:
            raise ValueError("User not found or disabled")

        lines: list[str] = []

        for node in self.config.enabled_nodes():
            if not self.db.is_node_healthy(node.id):
                continue
            try:
                content = HiddifyClient(node).fetch_subscription(user_uuid)
                lines.extend(self._decode_subscription_lines(content))
            except (HiddifyAPIError, httpx.HTTPError) as exc:
                logger.warning("Skip unhealthy subscription from %s: %s", node.id, exc)

        if not lines:
            raise ValueError("No subscription content available from any node")

        unique_lines = list(dict.fromkeys(lines))
        body = "\n".join(unique_lines)
        encoded = base64.b64encode(body.encode("utf-8")).decode("ascii")

        # Hiddify / v2ray clients accept plain base64 body
        return encoded

    @staticmethod
    def _decode_subscription_lines(content: str) -> list[str]:
        text = content.strip()
        if not text:
            return []
        try:
            decoded = base64.b64decode(text, validate=False).decode("utf-8", errors="ignore")
            if "://" in decoded:
                return [line.strip() for line in decoded.splitlines() if line.strip()]
        except Exception:  # noqa: BLE001
            pass
        if "://" in text:
            return [line.strip() for line in text.splitlines() if line.strip()]
        return []


class HealthChecker:
    def __init__(self, config: AppConfig, db: HubDatabase) -> None:
        self.config = config
        self.db = db

    def check_all(self) -> list[dict]:
        results = []
        for node in self.config.enabled_nodes():
            start = time.perf_counter()
            healthy = False
            error = None
            try:
                HiddifyClient(node, timeout=10).ping()
                healthy = True
            except Exception as exc:  # noqa: BLE001
                error = str(exc)
            latency = (time.perf_counter() - start) * 1000
            self.db.save_node_health(node.id, healthy, latency if healthy else None, error)
            results.append(
                {
                    "node_id": node.id,
                    "name": node.name,
                    "country": node.country,
                    "healthy": healthy,
                    "latency_ms": round(latency, 1) if healthy else None,
                    "error": error,
                }
            )
        return results
