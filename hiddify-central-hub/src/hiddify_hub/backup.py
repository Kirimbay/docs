from __future__ import annotations

import json
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .config import config_to_dict, load_config
from .database import HubDatabase
from .models import BackupPayload


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BackupManager:
    def __init__(self, config_path: Path, db: HubDatabase) -> None:
        self.config_path = config_path
        self.db = db

    def export_backup(self, output_path: Path, *, encrypt_key: str | None = None) -> Path:
        config = load_config(self.config_path)
        payload = BackupPayload(
            exported_at=_utcnow_iso(),
            config=config_to_dict(config),
            users=self.db.export_users(),
            node_health=list(self.db.get_node_health().values()),
        )
        raw = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2).encode("utf-8")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        if encrypt_key:
            fernet = _fernet_from_password(encrypt_key)
            raw = fernet.encrypt(raw)

        with tarfile.open(output_path, "w:gz") as tar:
            info = tarfile.TarInfo(name="backup.json")
            info.size = len(raw)
            tar.addfile(info, fileobj=_BytesIO(raw))

        return output_path

    def import_backup(
        self,
        backup_path: Path,
        *,
        encrypt_key: str | None = None,
        restore_config: bool = True,
        restore_users: bool = True,
    ) -> dict:
        raw = _read_backup_bytes(backup_path)
        if encrypt_key:
            fernet = _fernet_from_password(encrypt_key)
            try:
                raw = fernet.decrypt(raw)
            except InvalidToken as exc:
                raise ValueError("Invalid backup encryption key") from exc

        payload = BackupPayload.model_validate(json.loads(raw.decode("utf-8")))
        result = {"users_imported": 0, "config_restored": False}

        if restore_users:
            result["users_imported"] = self.db.import_users(payload.users)

        if restore_config and payload.config:
            restored_config = self.config_path
            if restored_config.exists():
                backup_copy = restored_config.with_suffix(".yaml.bak")
                shutil.copy2(restored_config, backup_copy)
            restored_config.parent.mkdir(parents=True, exist_ok=True)
            import yaml

            with restored_config.open("w", encoding="utf-8") as f:
                yaml.safe_dump(payload.config, f, allow_unicode=True, sort_keys=False)
            result["config_restored"] = True

        self.db.log_action("restore_backup", details=result)
        return result


def _fernet_from_password(password: str) -> Fernet:
    from hashlib import sha256
    import base64

    digest = sha256(password.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def _read_backup_bytes(backup_path: Path) -> bytes:
    if backup_path.suffix == ".gz" or backup_path.name.endswith(".tar.gz"):
        with tarfile.open(backup_path, "r:gz") as tar:
            member = tar.getmember("backup.json")
            extracted = tar.extractfile(member)
            if extracted is None:
                raise ValueError("backup.json missing in archive")
            return extracted.read()
    return backup_path.read_bytes()


class _BytesIO:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            chunk = self._data[self._pos :]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk
