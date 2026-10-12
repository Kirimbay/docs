#!/usr/bin/env python3
"""Serve a subscription copy that already includes the routing profile.

The phone opens one app link. Happ or Incy then downloads /s/<token> and
reads the routing header, so the key and the rules arrive together.
"""
import base64
import http.client
import ipaddress
import json
import os
import socket
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlparse

LISTEN = ("127.0.0.1", 18770)
DB_PATH = os.environ.get("KIRVPN_WRAP_DB", "/var/lib/kirvpn-wrap/tokens.sqlite")
RULES_PATH = os.environ.get(
    "KIRVPN_WRAP_RULES",
    os.path.join(os.path.dirname(DB_PATH), "rules.json"),
)
PUBLIC_BASE = os.environ.get("KIRVPN_WRAP_BASE", "https://info.sarafan.uk")
HAPP_RULES_URL = "https://tinyurl.com/j3w6rkr8"
INCY_RULES_URL = "https://tinyurl.com/mv7kfcvu"
HAPP_CRYPT = "https://crypto.happ.su/api-v2.php"
MAX_BODY = 512 * 1024
FETCH_TIMEOUT = 12

_lock = threading.Lock()
_hits = {}
_rules = {"happ": "", "incy": ""}


def _public_ip(text):
    try:
        addr = ipaddress.ip_address(text)
    except ValueError:
        return False
    if any([
        addr.is_private, addr.is_loopback, addr.is_link_local,
        addr.is_multicast, addr.is_reserved, addr.is_unspecified,
    ]):
        return False
    if addr.version == 4 and addr in ipaddress.ip_network("100.64.0.0/10"):
        return False
    return True


def socket_getaddrinfo(host):
    found = []
    for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM):
        found.append(item[4][0])
    return found


def _host_ok(host):
    host = (host or "").strip(".").lower()
    if not host or host in {"localhost", "info.sarafan.uk"}:
        return False
    if host.endswith(".local") or host.endswith(".internal") or host.endswith(".localhost"):
        return False
    try:
        ipaddress.ip_address(host)
        return _public_ip(host)
    except ValueError:
        pass
    if "." not in host:
        return False
    try:
        infos = socket_getaddrinfo(host)
    except OSError:
        return False
    if not infos:
        return False
    return all(_public_ip(item) for item in infos)


def validate_https(url):
    parts = urlparse(url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("Нужна ссылка, которая начинается с https://")
    if parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError("Эта ссылка не подходит.")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in url):
        raise ValueError("Эта ссылка не подходит.")
    if not _host_ok(parts.hostname):
        raise ValueError("Эта ссылка не подходит.")
    if parts.hostname.lower().rstrip(".") == "info.sarafan.uk":
        raise ValueError("Эта ссылка не подходит.")
    if len(url) > 4000:
        raise ValueError("Слишком длинная ссылка.")


def _pick_ip(host):
    try:
        infos = socket_getaddrinfo(host)
    except OSError as exc:
        raise ValueError("Эта ссылка не подходит.") from exc
    if not infos or not all(_public_ip(item) for item in infos):
        raise ValueError("Эта ссылка не подходит.")
    v4 = [item for item in infos if ":" not in item]
    return v4[0] if v4 else infos[0]


class _Pinned(http.client.HTTPSConnection):
    def __init__(self, ip, server_name, timeout):
        self._server_name = server_name
        super().__init__(ip, 443, timeout=timeout, context=ssl.create_default_context())

    def connect(self):
        raw = socket.create_connection((self.host, self.port), self.timeout)
        peer = raw.getpeername()[0]
        if not _public_ip(peer):
            raw.close()
            raise ValueError("Эта ссылка не подходит.")
        self.sock = self._context.wrap_socket(raw, server_hostname=self._server_name)


def _header_value(value, limit):
    text = str(value or "").replace("\r", "").replace("\n", "").strip()
    if not text or len(text) > limit:
        return ""
    return text


def _read_limited(resp):
    chunks = []
    total = 0
    while True:
        block = resp.read(8192)
        if not block:
            break
        total += len(block)
        if total > MAX_BODY:
            raise ValueError("Ссылка слишком большая.")
        chunks.append(block)
    return b"".join(chunks)


def fetch_upstream(url, hops=0):
    if hops > 3:
        raise ValueError("Эта ссылка не подходит.")
    validate_https(url)
    parts = urlparse(url)
    host = parts.hostname
    ip = _pick_ip(host)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    conn = _Pinned(ip, host, FETCH_TIMEOUT)
    try:
        conn.request("GET", path, headers={
            "Host": host,
            "User-Agent": "Happ/3.0.0",
            "Accept": "text/plain, */*",
            "Connection": "close",
        })
        resp = conn.getresponse()
        if resp.status in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location") or ""
            resp.read(1024)
            if not loc:
                raise ValueError("По этой ссылке нет ключа.")
            return fetch_upstream(urljoin(url, loc), hops + 1)
        if resp.status != 200:
            raise ValueError("По этой ссылке нет ключа.")
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype in {"text/html", "application/xhtml+xml"}:
            raise ValueError("По этой ссылке нет ключа.")
        if ctype and ctype not in {
            "text/plain", "application/octet-stream", "application/json",
            "text/yaml", "application/yaml",
        }:
            raise ValueError("По этой ссылке нет ключа.")
        data = _read_limited(resp)
        passthrough = {}
        for name in (
            "subscription-userinfo", "profile-title", "profile-update-interval",
            "profile-web-page-url", "support-url", "announce", "content-disposition",
        ):
            value = _header_value(resp.headers.get(name), 500)
            if value:
                passthrough[name] = value
    finally:
        conn.close()
    if not data:
        raise ValueError("По этой ссылке нет ключа.")
    sample = data[:200].lstrip().lower()
    if sample.startswith(b"<") or sample.startswith(b"<!doctype"):
        raise ValueError("По этой ссылке нет ключа.")
    return data, passthrough


def _resolve_scheme(url):
    class Stop(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise LookupError(newurl)

    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0"})
    try:
        urllib.request.build_opener(Stop).open(req, timeout=12)
    except LookupError as exc:
        return str(exc.args[0] if exc.args else "")
    except urllib.error.HTTPError as exc:
        loc = exc.headers.get("Location") if exc.headers else ""
        if loc:
            return loc
        raise
    raise RuntimeError("no redirect")


def _activate(link):
    return link.replace("://routing/add/", "://routing/onadd/", 1)


def _rule_ok(app, link):
    link = _header_value(link, 20000)
    prefix = "happ://" if app == "happ" else "incy://"
    return bool(link.startswith(prefix) and "://routing/onadd/" in link)


def _save_rules():
    os.makedirs(os.path.dirname(RULES_PATH), mode=0o700, exist_ok=True)
    tmp = RULES_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump({"happ": _rules["happ"], "incy": _rules["incy"]}, handle)
    os.chmod(tmp, 0o600)
    os.replace(tmp, RULES_PATH)


def _load_cached_rules():
    try:
        with open(RULES_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    loaded = {}
    for app in ("happ", "incy"):
        link = str(data.get(app) or "")
        if not _rule_ok(app, link):
            return False
        loaded[app] = link
    with _lock:
        _rules.update(loaded)
    return True


def load_rules():
    loaded = {}
    try:
        for app, url in (("happ", HAPP_RULES_URL), ("incy", INCY_RULES_URL)):
            link = _activate(_resolve_scheme(url).strip())
            if not _rule_ok(app, link):
                raise RuntimeError("routing link is not usable")
            loaded[app] = link
    except Exception:
        return _load_cached_rules()
    with _lock:
        _rules.update(loaded)
    try:
        _save_rules()
    except OSError:
        pass
    return True


def _rules_loop():
    while True:
        ok = load_rules()
        time.sleep(3600 if ok else 30)


def db():
    os.makedirs(os.path.dirname(DB_PATH), mode=0o700, exist_ok=True)
    try:
        os.chmod(os.path.dirname(DB_PATH), 0o700)
    except OSError:
        pass
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tokens ("
        "token TEXT PRIMARY KEY, kind TEXT NOT NULL, app TEXT NOT NULL, "
        "payload TEXT NOT NULL, created INTEGER NOT NULL)"
    )
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass
    return conn


def rate_ok(ip):
    now = time.time()
    with _lock:
        if len(_hits) > 5000:
            _hits.clear()
        hits = [t for t in _hits.get(ip, []) if now - t < 600]
        if len(hits) >= 20:
            _hits[ip] = hits
            return False
        hits.append(now)
        _hits[ip] = hits
        return True


def save_token(kind, app, payload):
    token = base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip("=")
    with db() as conn:
        conn.execute(
            "INSERT INTO tokens (token, kind, app, payload, created) VALUES (?, ?, ?, ?, ?)",
            (token, kind, app, payload, int(time.time())),
        )
    return token


def happ_open(page_url):
    raw = json.dumps({"url": page_url}).encode()
    req = urllib.request.Request(
        HAPP_CRYPT, data=raw, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        link = str(data.get("encrypted_link") or "")
        if link.startswith("happ://"):
            return link
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    packed = base64.urlsafe_b64encode(page_url.encode()).decode().rstrip("=")
    return "happ://add/" + packed


def incy_open(page_url):
    return "incy://import/" + page_url


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _send(self, code, body, headers=None, content_type="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        headers = dict(headers or {})
        headers.setdefault("Content-Type", content_type)
        headers["Content-Length"] = str(len(body))
        headers["Cache-Control"] = "no-store"
        headers["X-Content-Type-Options"] = "nosniff"
        self.send_response(code)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def _client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For") or ""
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            with _lock:
                ready = bool(_rules["happ"] and _rules["incy"])
            self._json(200, {"ok": True, "rules": ready})
            return
        if not path.startswith("/s/"):
            self._json(404, {"ok": False})
            return
        token = path[3:]
        if not token or "/" in token or len(token) > 80:
            self._json(404, {"ok": False})
            return
        with db() as conn:
            row = conn.execute(
                "SELECT kind, app, payload FROM tokens WHERE token = ?", (token,)
            ).fetchone()
        if not row:
            self._json(404, {"ok": False, "error": "Ссылка устарела. Нажми кнопку ещё раз."})
            return
        kind, app, payload = row
        with _lock:
            routing = _rules.get(app) or ""
        if not _rule_ok(app, routing):
            self._json(503, {"ok": False, "error": "Правила сейчас недоступны."})
            return
        try:
            if kind == "raw":
                body = payload.encode("utf-8")
                extra = {}
            else:
                body, extra = fetch_upstream(payload)
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        except Exception:
            self._json(502, {"ok": False, "error": "Ключ сейчас не открывается."})
            return
        extra["routing"] = routing
        self._send(200, body, extra, "text/plain; charset=utf-8")

    def do_POST(self):
        if urlparse(self.path).path != "/wrap":
            self._json(404, {"ok": False})
            return
        if not rate_ok(self._client_ip()):
            self._json(429, {"ok": False, "error": "Слишком много попыток. Подожди немного."})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > 12000:
            self._json(400, {"ok": False, "error": "Не получилось прочитать ссылку."})
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "Не получилось прочитать ссылку."})
            return
        app = str(data.get("app") or "")
        url = str(data.get("url") or "").strip()
        with _lock:
            ready = _rule_ok(app, _rules.get(app) or "")
        if app not in {"happ", "incy"} or not ready:
            self._json(400, {"ok": False, "error": "Выбери Incy или Happ."})
            return
        low = url.lower()
        try:
            if low.startswith(("vless://", "vmess://", "trojan://", "ss://", "hysteria2://", "hy2://")):
                if len(url) > 8000 or any(ord(ch) < 32 or ord(ch) == 127 for ch in url):
                    raise ValueError("Слишком длинная ссылка.")
                token = save_token("raw", app, url)
            elif low.startswith("https://"):
                fetch_upstream(url)
                token = save_token("https", app, url)
            else:
                raise ValueError("Нужна ссылка из чата: она начинается с https://")
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return
        except Exception:
            self._json(502, {"ok": False, "error": "По этой ссылке нет ключа."})
            return
        page = PUBLIC_BASE + "/s/" + token
        open_link = happ_open(page) if app == "happ" else incy_open(page)
        if not open_link.startswith(("happ://", "incy://")):
            self._json(502, {"ok": False, "error": "Не получилось открыть приложение."})
            return
        self._json(200, {"ok": True, "open": open_link})


def main():
    load_rules()
    threading.Thread(target=_rules_loop, daemon=True).start()
    httpd = ThreadingHTTPServer(LISTEN, Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
