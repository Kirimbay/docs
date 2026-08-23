"""Локальное хранилище пользователей и подписок (JSON)."""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class Subscription:
    id: str
    department_id: str
    department_title: str = ""
    lpu_code: str = ""
    lpu_name: str = ""
    doctor_id: str = ""
    doctor_name: str = ""
    last_total: int = 0
    fingerprint: str = ""
    updated_at: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Subscription":
        return cls(
            id=str(data.get("id") or ""),
            department_id=str(data.get("department_id") or ""),
            department_title=str(data.get("department_title") or ""),
            lpu_code=str(data.get("lpu_code") or ""),
            lpu_name=str(data.get("lpu_name") or ""),
            doctor_id=str(data.get("doctor_id") or ""),
            doctor_name=str(data.get("doctor_name") or ""),
            last_total=int(data.get("last_total") or 0),
            fingerprint=str(data.get("fingerprint") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


@dataclass
class UserRecord:
    chat_id: int
    polis_number: str = ""
    polis_birthday: str = ""
    person_guid: str = ""
    attached_lpus: list[dict[str, str]] = field(default_factory=list)
    subscriptions: list[Subscription] = field(default_factory=list)

    def has_polis(self) -> bool:
        return bool(self.polis_number and self.polis_birthday)


class Storage:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._users: dict[str, UserRecord] = {}
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            self._users = {}
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self._users = {}
            return
        users: dict[str, UserRecord] = {}
        for chat_id, data in (raw.get("users") or {}).items():
            subs = [Subscription.from_dict(s) for s in data.get("subscriptions") or []]
            users[str(chat_id)] = UserRecord(
                chat_id=int(chat_id),
                polis_number=data.get("polis_number") or "",
                polis_birthday=data.get("polis_birthday") or "",
                person_guid=data.get("person_guid") or "",
                attached_lpus=data.get("attached_lpus") or [],
                subscriptions=subs,
            )
        self._users = users

    def save(self) -> None:
        payload = {
            "users": {
                chat_id: {
                    "polis_number": user.polis_number,
                    "polis_birthday": user.polis_birthday,
                    "person_guid": user.person_guid,
                    "attached_lpus": user.attached_lpus,
                    "subscriptions": [asdict(sub) for sub in user.subscriptions],
                }
                for chat_id, user in self._users.items()
            }
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def get_user(self, chat_id: int) -> UserRecord:
        with self._lock:
            key = str(chat_id)
            if key not in self._users:
                self._users[key] = UserRecord(chat_id=chat_id)
            return self._users[key]

    def update_user(self, user: UserRecord) -> None:
        with self._lock:
            self._users[str(user.chat_id)] = user
            self.save()

    def set_polis(
        self,
        chat_id: int,
        number: str,
        birthday: str,
        *,
        person_guid: str = "",
        attached_lpus: list[dict[str, str]] | None = None,
    ) -> UserRecord:
        user = self.get_user(chat_id)
        user.polis_number = number
        user.polis_birthday = birthday
        user.person_guid = person_guid
        if attached_lpus is not None:
            user.attached_lpus = attached_lpus
        self.update_user(user)
        return user

    def add_subscription(self, chat_id: int, sub: Subscription) -> UserRecord:
        user = self.get_user(chat_id)
        user.subscriptions = [s for s in user.subscriptions if s.id != sub.id]
        user.subscriptions.append(sub)
        self.update_user(user)
        return user

    def remove_subscription(self, chat_id: int, sub_id: str) -> UserRecord:
        user = self.get_user(chat_id)
        user.subscriptions = [s for s in user.subscriptions if s.id != sub_id]
        self.update_user(user)
        return user

    def update_subscription_state(
        self,
        chat_id: int,
        sub_id: str,
        *,
        last_total: int,
        fingerprint: str,
    ) -> None:
        user = self.get_user(chat_id)
        for sub in user.subscriptions:
            if sub.id == sub_id:
                sub.last_total = last_total
                sub.fingerprint = fingerprint
                sub.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                break
        self.update_user(user)

    def iter_subscribed_users(self) -> list[tuple[UserRecord, Subscription]]:
        result: list[tuple[UserRecord, Subscription]] = []
        with self._lock:
            for user in self._users.values():
                if not user.has_polis():
                    continue
                for sub in user.subscriptions:
                    result.append((user, sub))
        return result

    def clear_user(self, chat_id: int) -> None:
        with self._lock:
            self._users.pop(str(chat_id), None)
            self.save()
