#!/usr/bin/env python3
"""Hiddify Manager admin API v2 client (stdlib urllib only).

Checked against hiddify/HiddifyPanel, default branch ``dev`` (October 2026):

- ``GET  /<admin_proxy_path>/api/v2/admin/user/`` lists users
  (``users_api.UsersApi``). 404 ``You have no user`` means an empty panel.
- ``GET  /<admin_proxy_path>/api/v2/admin/user/<uuid>/`` one user.
- ``GET  /<admin_proxy_path>/api/v2/admin/users/`` adds ``link_domains``
  (``users_page_api``): ``https://<host>/<proxy_path_client>/``.
- ``GET  /<admin_proxy_path>/api/v2/admin/all-configs/`` dumps domains and
  ``chconfigs[<child>].proxy_path_client`` (``system_actions.AllConfigsApi``).
- ``GET  /<admin_proxy_path>/api/v2/admin/domains/options/`` lists domains.
- ``PUT  /<admin_proxy_path>/api/v2/admin/settings/`` body
  ``{"values": {"branding_freetext": "..."}}`` (``settings_api.SettingsApi``).
- Auth is the header ``Hiddify-API-Key``. In ``auth.py`` that value is the
  admin UUID (``get_account_by_api_key``).

There is no subscription ``announce`` header in ``ConfigEnum`` or in
``proxy_templates/sublink/subscription_header.j2``. The closest API write is
``branding_freetext`` (user-page branding). The Happ/Incy banner stays an
optional SSH call to ``/opt/kirvpn/set_announce.py``.
"""
from __future__ import annotations

import json
import re
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

ONE_GIG = 1024 ** 3
PATH_OK = re.compile(r"^[A-Za-z0-9]{4,80}$")
UUID_OK = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
HOST_KIR = re.compile(r"^[A-Za-z0-9.-]+\.kirvpn\.us$")
LINK_CACHE_SEC = 300
_MAX_BODY = 8 * 1024 * 1024

_cache_lock = threading.Lock()
_link_cache: dict = {}


class HiddifyError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def clear_cache() -> None:
    with _cache_lock:
        _link_cache.clear()


def _timeout(node: dict, default: int) -> int:
    try:
        value = int(node.get("timeout") or default)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, 60))


def _as_bool(value, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in ("1", "true", "yes"):
        return True
    if text in ("0", "false", "no", ""):
        return False
    return default


def _gb_to_bytes(value) -> int:
    try:
        return max(0, int(round(float(value) * ONE_GIG)))
    except (TypeError, ValueError):
        return 0


def _bytes_field(row: dict, gb_key: str, raw_key: str) -> int:
    if gb_key in row and row.get(gb_key) is not None:
        return _gb_to_bytes(row.get(gb_key))
    try:
        return max(0, int(row.get(raw_key) or 0))
    except (TypeError, ValueError):
        return 0


def describe(node: dict) -> tuple[str, str, str]:
    if not isinstance(node, dict):
        raise HiddifyError("нет настроек api")
    panel = str(node.get("panel_url") or "").strip().rstrip("/")
    admin_path = str(node.get("admin_proxy_path") or "").strip().strip("/")
    key = str(node.get("api_key") or "").strip()
    if not panel or not admin_path or not key:
        raise HiddifyError("нет panel_url, admin_proxy_path или api_key")
    parts = urllib.parse.urlparse(panel)
    host = (parts.hostname or "").lower()
    local = host in ("127.0.0.1", "localhost")
    if parts.scheme == "http" and not local:
        raise HiddifyError("panel_url должен быть https")
    if parts.scheme not in ("https", "http") or not host or parts.username or parts.password or parts.query:
        raise HiddifyError("некорректный panel_url")
    if parts.path not in ("", "/"):
        raise HiddifyError("panel_url без секретного пути")
    if not PATH_OK.match(admin_path):
        raise HiddifyError("некорректный admin_proxy_path")
    if not UUID_OK.match(key):
        raise HiddifyError("api_key должен быть UUID админа")
    return panel, admin_path, key


def _parse_body(raw: bytes):
    text = raw.decode("utf-8", "replace").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(data, str):
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return data
    return data


def _http_error(status: int, raw: bytes) -> HiddifyError:
    blob = raw.decode("utf-8", "replace").lower()
    if status == 401:
        return HiddifyError("ключ API не принят", status)
    if status == 403:
        return HiddifyError("нет прав API", status)
    if status == 404 and ("no user" in blob or "have no user" in blob):
        return HiddifyError("нет пользователей", status)
    if status == 404:
        return HiddifyError("путь API не найден", status)
    if status == 422:
        return HiddifyError("панель не приняла данные", status)
    if status >= 500:
        return HiddifyError("ошибка панели", status)
    return HiddifyError("ошибка API", status)


def request(node: dict, method: str, suffix: str, body=None, timeout: int | None = None):
    panel, admin_path, key = describe(node)
    suffix = suffix.lstrip("/")
    if not re.match(r"^[A-Za-z0-9_./<>-]+$", suffix) or ".." in suffix:
        raise HiddifyError("некорректный путь API")
    url = "%s/%s/api/v2/admin/%s" % (panel, admin_path, suffix)
    data = None
    headers = {
        "Hiddify-API-Key": key,
        "Accept": "application/json",
        "User-Agent": "kirvpn-find/hiddify",
    }
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    limit = _timeout(node, 12 if timeout is None else timeout)
    try:
        with _OPENER.open(req, timeout=limit) as resp:
            raw = resp.read(_MAX_BODY + 1)
            status = getattr(resp, "status", 200)
    except urllib.error.HTTPError as exc:
        raw = exc.read(_MAX_BODY + 1) if exc.fp else b""
        status = exc.code
        if len(raw) > _MAX_BODY:
            raise HiddifyError("ответ слишком большой")
        data_parsed = _parse_body(raw)
        if status == 404 and ("no user" in raw.decode("utf-8", "replace").lower()):
            return status, data_parsed
        raise _http_error(status, raw)
    except (TimeoutError, socket.timeout):
        raise HiddifyError("timeout")
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, (TimeoutError, socket.timeout)):
            raise HiddifyError("timeout")
        raise HiddifyError("api недоступен")
    except HiddifyError:
        raise
    except Exception:
        raise HiddifyError("api недоступен")
    if len(raw) > _MAX_BODY:
        raise HiddifyError("ответ слишком большой")
    return status, _parse_body(raw)


def _norm_user(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    if _as_bool(row.get("deleted"), False):
        return None
    start = row.get("start_date") or ""
    if not isinstance(start, str):
        start = ""
    start = start[:10]
    try:
        package_days = int(row.get("package_days") if row.get("package_days") is not None else 0)
    except (TypeError, ValueError):
        package_days = 0
    telegram = row.get("telegram_id")
    if telegram is None:
        telegram_s = ""
    else:
        telegram_s = str(telegram).strip()
        if telegram_s.lower() == "none":
            telegram_s = ""
    uuid = str(row.get("uuid") or "").strip()
    user_id = row.get("id")
    return {
        "id": "" if user_id is None else str(user_id),
        "name": str(row.get("name") or ""),
        "enable": _as_bool(row.get("enable"), True),
        "usage_limit": _bytes_field(row, "usage_limit_GB", "usage_limit"),
        "current_usage": _bytes_field(row, "current_usage_GB", "current_usage"),
        "package_days": package_days,
        "start_date": start,
        "uuid": uuid,
        "comment": str(row.get("comment") or ""),
        "username": str(row.get("username") or ""),
        "telegram_id": telegram_s,
        "last_online": str(row.get("last_online") or ""),
    }


def _rows_from_payload(status: int, data) -> list:
    if status == 404:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("users", "data", "result"):
            if isinstance(data.get(key), list):
                return data[key]
    raise HiddifyError("непонятный ответ")


def list_users(node: dict) -> list:
    status, data = request(node, "GET", "user/", timeout=_timeout(node, 12))
    rows = _rows_from_payload(status, data)
    users = []
    for row in rows:
        item = _norm_user(row)
        if item:
            users.append(item)
    return users


def account_bucket(user: dict) -> str:
    """Same buckets as the old SQL counts: disabled, expired, active.

    Expired means the account is still enabled, package_days > 0, start_date
    is set, and the elapsed days are already at least package_days.
    package_days 0 and a missing start_date stay active.
    """
    if not user.get("enable"):
        return "disabled"
    try:
        package_days = int(user.get("package_days") or 0)
    except (TypeError, ValueError):
        package_days = 0
    start = str(user.get("start_date") or "")[:10]
    if package_days > 0 and start:
        try:
            started = datetime.strptime(start, "%Y-%m-%d").date()
        except ValueError:
            return "active"
        if (date.today() - started).days >= package_days:
            return "expired"
    return "active"


def _mode_name(value) -> str:
    if isinstance(value, dict):
        value = value.get("value") or value.get("name") or ""
    text = str(value or "").strip().lower()
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text


def _domain_items(raw) -> list:
    if isinstance(raw, dict):
        raw = raw.get("domains") or raw.get("data") or []
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if isinstance(item, str):
            out.append({"domain": item, "mode": ""})
        elif isinstance(item, dict):
            host = item.get("domain") or item.get("name") or ""
            out.append({
                "domain": host,
                "mode": _mode_name(item.get("mode")),
                "sub_link_only": bool(item.get("sub_link_only")) or _mode_name(item.get("mode")) == "sub_link_only",
                "base": item.get("base") or "",
                "kind": str(item.get("kind") or ""),
            })
    return out


def pick_domain(items: list) -> str:
    """Prefer a direct *.kirvpn.us host, then any other *.kirvpn.us host.

    sub_link_only domains lose to a real direct/relay domain, matching the old
    ``ORDER BY (mode='direct') DESC, sub_link_only ASC``.
    """
    ranked = []
    for item in items:
        if not isinstance(item, dict):
            continue
        host = str(item.get("domain") or "").strip().lower().rstrip(".")
        if not host or "*" in host or not HOST_KIR.match(host):
            continue
        mode = _mode_name(item.get("mode"))
        if not mode and str(item.get("kind") or "") == "direct":
            mode = "direct"
        sub_only = bool(item.get("sub_link_only")) or mode == "sub_link_only"
        ranked.append((0 if mode == "direct" else 1, 1 if sub_only else 0, host))
    if not ranked:
        return ""
    ranked.sort()
    return ranked[0][2]


def _client_path_from_configs(chconfigs) -> str:
    if not isinstance(chconfigs, dict):
        return ""
    blocks = []
    if "0" in chconfigs:
        blocks.append(chconfigs["0"])
    for key, value in chconfigs.items():
        if str(key) != "0":
            blocks.append(value)
    for block in blocks:
        if not isinstance(block, dict):
            continue
        path = str(block.get("proxy_path_client") or "").strip().strip("/")
        if PATH_OK.match(path):
            return path
    return ""


def _path_from_base(base: str) -> str:
    parts = [p for p in urllib.parse.urlparse(base or "").path.split("/") if p]
    if not parts:
        return ""
    path = parts[0]
    return path if PATH_OK.match(path) else ""


def _merge_domains(found: list, extra) -> None:
    for item in _domain_items(extra):
        found.append(item)


def link_context(node: dict) -> dict:
    panel, admin_path, key = describe(node)
    cache_key = (panel, admin_path, key, str(node.get("sub_domain") or ""), str(node.get("client_proxy_path") or ""))
    now = datetime.now().timestamp()
    with _cache_lock:
        hit = _link_cache.get(cache_key)
        if hit and LINK_CACHE_SEC > 0 and (now - hit[0]) < LINK_CACHE_SEC:
            return dict(hit[1])
    client_path = str(node.get("client_proxy_path") or "").strip().strip("/")
    if client_path and not PATH_OK.match(client_path):
        client_path = ""
    domains = []
    sub_domain = str(node.get("sub_domain") or "").strip()
    if sub_domain:
        domains.append({"domain": sub_domain, "mode": "direct", "sub_link_only": False})
    if not (pick_domain(domains) and client_path):
        client_path, domains = _fetch_link_meta(node, client_path, domains)
    host = (urllib.parse.urlparse(panel).hostname or "").lower()
    domain = pick_domain(domains)
    if not domain and HOST_KIR.match(host):
        domain = host
    ctx = {
        "domain": domain,
        "client_path": client_path if PATH_OK.match(client_path or "") else "",
        "admin_path": admin_path,
        "admin_uuid": key,
    }
    with _cache_lock:
        _link_cache[cache_key] = (now, dict(ctx))
    return ctx


def _fetch_link_meta(node: dict, client_path: str, domains: list) -> tuple[str, list]:
    calls = (
        ("all-configs/", _take_all_configs),
        ("users/", _take_users_page),
        ("domains/options/", _take_domain_options),
    )
    for suffix, take in calls:
        if pick_domain(domains) and client_path:
            break
        try:
            status, data = request(node, "GET", suffix, timeout=_timeout(node, 12))
        except HiddifyError:
            continue
        if status != 200:
            continue
        client_path, domains = take(data, client_path, domains)
    return client_path, domains


def _take_all_configs(data, client_path: str, domains: list):
    if isinstance(data, dict):
        _merge_domains(domains, data.get("domains"))
        if not client_path:
            client_path = _client_path_from_configs(data.get("chconfigs"))
    return client_path, domains


def _take_users_page(data, client_path: str, domains: list):
    if isinstance(data, dict):
        for item in data.get("link_domains") or []:
            if not isinstance(item, dict):
                continue
            domains.append({
                "domain": item.get("domain") or "",
                "mode": "direct" if item.get("kind") == "direct" else _mode_name(item.get("mode") or item.get("kind")),
                "sub_link_only": item.get("kind") == "sub_link_only",
                "base": item.get("base") or "",
                "kind": item.get("kind") or "",
            })
            if not client_path:
                client_path = _path_from_base(str(item.get("base") or ""))
    return client_path, domains


def _take_domain_options(data, client_path: str, domains: list):
    _merge_domains(domains, data)
    return client_path, domains


def subscription_path(node: dict) -> str:
    """``/<client_proxy_path>/<active-user-uuid>/all.txt`` or empty."""
    users = list_users(node)
    ctx = link_context(node)
    path = ctx.get("client_path") or ""
    if not PATH_OK.match(path):
        return ""
    active = [
        user for user in users
        if account_bucket(user) == "active" and UUID_OK.match(user.get("uuid") or "")
    ]
    active.sort(key=lambda user: user.get("last_online") or "", reverse=True)
    if not active:
        return ""
    return "/%s/%s/all.txt" % (path, active[0]["uuid"])


def set_branding_text(node: dict, text: str) -> None:
    """Closest official write: user-panel branding, not the app banner."""
    status, _data = request(
        node,
        "PUT",
        "settings/",
        {"values": {"branding_freetext": text or ""}},
        timeout=_timeout(node, 20),
    )
    if status not in (200, 201):
        raise HiddifyError("панель не сохранила текст", status)
