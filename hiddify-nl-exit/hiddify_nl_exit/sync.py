from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from typing import Any

from .client import HiddifyAdminClient, HiddifyError
from .config import AppConfig, NetherlandsPanel, SwedenPanel

logger = logging.getLogger(__name__)

UNSAFE_NAME = re.compile(r"[^\w.@+-]+", re.UNICODE)


@dataclass
class SyncStats:
    created: int = 0
    enabled: int = 0
    disabled: int = 0
    unchanged: int = 0
    errors: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "created": self.created,
            "enabled": self.enabled,
            "disabled": self.disabled,
            "unchanged": self.unchanged,
            "errors": self.errors,
        }


def is_live_sweden_user(user: dict[str, Any]) -> bool:
    if user.get("enable") is False:
        return False
    if "is_active" in user:
        return bool(user["is_active"])
    return True


def sanitize_name(panel_id: str, name: str) -> str:
    cleaned = UNSAFE_NAME.sub("-", (name or "user").strip())[:40].strip("-.") or "user"
    return f"{panel_id}-{cleaned}"[:64]


def nl_create_payload(panel: SwedenPanel, nl: NetherlandsPanel, user: dict[str, Any]) -> dict[str, Any]:
    return {
        "uuid": user["uuid"],
        "name": sanitize_name(panel.id, str(user.get("name") or "user")),
        "enable": True,
        "mode": nl.mode,
        "package_days": nl.package_days,
        "usage_limit_GB": nl.usage_limit_gb,
        "comment": f"synced:{panel.id}",
        "added_by_uuid": nl.added_by_uuid,
    }


def sync_users(cfg: AppConfig, *, dry_run: bool | None = None) -> SyncStats:
    dry = cfg.dry_run if dry_run is None else dry_run
    stats = SyncStats()
    with HiddifyAdminClient(
        cfg.netherlands.base_url,
        cfg.netherlands.admin_proxy_path,
        cfg.netherlands.admin_api_key,
        verify_tls=cfg.netherlands.verify_tls,
        timeout=cfg.fetch_timeout_sec + 20,
    ) as nl_client:
        nl_users = {user["uuid"]: user for user in nl_client.list_users() if user.get("uuid")}
        desired_live: dict[str, bool] = {}
        first_seen: dict[str, tuple[SwedenPanel, dict[str, Any]]] = {}

        for panel in cfg.sweden:
            with HiddifyAdminClient(
                panel.base_url,
                panel.admin_proxy_path,
                panel.admin_api_key,
                verify_tls=panel.verify_tls,
                timeout=cfg.fetch_timeout_sec + 20,
            ) as se_client:
                users = se_client.list_users()
            logger.info("Sweden panel %s: %s users", panel.id, len(users))
            for user in users:
                uuid = user.get("uuid")
                if not uuid:
                    continue
                live = is_live_sweden_user(user)
                desired_live[uuid] = desired_live.get(uuid, False) or live
                first_seen.setdefault(uuid, (panel, user))

        changed = False
        for uuid, live in desired_live.items():
            existing = nl_users.get(uuid)
            try:
                if existing is None:
                    if not live:
                        stats.unchanged += 1
                        continue
                    panel, user = first_seen[uuid]
                    payload = nl_create_payload(panel, cfg.netherlands, user)
                    logger.info("Create NL user %s from %s (%s)", uuid, panel.id, payload["name"])
                    if not dry:
                        try:
                            nl_client.create_user(payload)
                        except HiddifyError as exc:
                            payload["name"] = f"{payload['name']}-{uuid[:8]}"
                            logger.warning("Retry create %s with unique name: %s", uuid, exc)
                            nl_client.create_user(payload)
                    stats.created += 1
                    changed = True
                    continue

                enabled = bool(existing.get("enable", True))
                if live and not enabled:
                    logger.info("Enable NL user %s", uuid)
                    if not dry:
                        nl_client.patch_user(uuid, {"enable": True})
                    stats.enabled += 1
                    changed = True
                elif not live and enabled:
                    logger.info("Disable NL user %s", uuid)
                    if not dry:
                        nl_client.patch_user(uuid, {"enable": False})
                    stats.disabled += 1
                    changed = True
                else:
                    stats.unchanged += 1
            except HiddifyError:
                logger.exception("Failed to sync user %s", uuid)
                stats.errors += 1

        if changed and cfg.netherlands.apply_users_command and not dry:
            logger.info("Running apply-users: %s", cfg.netherlands.apply_users_command)
            subprocess.run(cfg.netherlands.apply_users_command, check=False)
    return stats
