#!/usr/bin/env python3
import json
import os
import re
import subprocess
import threading
import time
import hmac
import hashlib
import secrets
from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import base64
import testing

ROOT = os.path.dirname(os.path.abspath(__file__))
SSH_KEY = os.path.join(ROOT, "id_ed25519")
NODES_PATH = os.path.join(ROOT, "nodes.json")
HTML_PATH = os.path.join(ROOT, "index.html")
LOGIN_HTML_PATH = os.path.join(ROOT, "login.html")
ANNOUNCE_HTML_PATH = os.path.join(ROOT, "announce.html")
ANNOUNCE_PATH = os.path.join(ROOT, "announce.txt")
ANNOUNCE_DIR = os.path.join(ROOT, "announce.d")
INFO_HTML_PATH = os.path.join(ROOT, "info.html")
INFO_TEXT_PATH = os.path.join(ROOT, "info.txt")
INFO_GUIDE_PATH = os.path.join(ROOT, "info-guide.html")
INFO_AUTO_PATH = os.path.join(ROOT, "info-auto.html")
INFO_WWW_DIR = "/var/www/info.sarafan.uk"
INFO_PAGES = ("index.html", "go.html", "add-us.html")
TRAFFIC_HTML_PATH = os.path.join(ROOT, "traffic.html")
PRO_HTML_PATH = os.path.join(ROOT, "pro.html")
USERS_HTML_PATH = os.path.join(ROOT, "users.html")
TESTING_HTML_PATH = os.path.join(ROOT, "testing.html")
HOSTUP_KEY_PATH = os.path.join(ROOT, "hostup.key")
HOSTUP_API = "https://cloud.hostup.se/api/v2"
HOSTUP_PORTAL = "https://cloud.hostup.se"
EXCLUDED_IPS_PATH = os.path.join(ROOT, "excluded-ips.txt")


def _load_deleted_ips() -> set:
    try:
        with open(EXCLUDED_IPS_PATH, encoding="utf-8") as f:
            return {ln.strip() for ln in f if ln.strip() and not ln.startswith("#")}
    except OSError:
        return set()


DELETED_IPS = _load_deleted_ips()
TRAFFIC_CACHE_SEC = 45
USERS_CACHE_SEC = 45
VPS_ID_OK = re.compile(r"^vps_[0-9a-z]{26}$")
LISTEN = ("127.0.0.1", 18765)
MAX_ANNOUNCE = 2000
MAX_INFO = 2000
HTPASSWD_PATHS = (
    "/etc/nginx/htpasswd-find",
    os.path.join(ROOT, "htpasswd"),
)
SESSION_KEY_PATH = os.path.join(ROOT, "session.key")
COOKIE_NAME = "kirvpn_find"
REMEMBER_SEC = 180 * 24 * 3600
LOGIN_FAIL_MAX = 8
LOGIN_FAIL_WINDOW = 600
_login_lock = threading.Lock()
_login_fails = {}

def session_secret() -> bytes:
    if os.path.exists(SESSION_KEY_PATH):
        return open(SESSION_KEY_PATH, "rb").read()
    key = secrets.token_bytes(32)
    fd = os.open(SESSION_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


def load_htpasswd() -> dict:
    for path in HTPASSWD_PATHS:
        if not os.path.isfile(path):
            continue
        out = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                user, hashed = line.split(":", 1)
                out[user] = hashed
        if out:
            return out
    return {}


def openssl_apr1(password: str, salt: str) -> str:
    p = subprocess.run(
        ["openssl", "passwd", "-apr1", "-salt", salt, "-stdin"],
        input=password,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if p.returncode:
        return ""
    return (p.stdout or "").strip()


def check_password(user: str, password: str) -> bool:
    users = load_htpasswd()
    hashed = users.get(user or "")
    if not hashed or not password:
        secrets.compare_digest("x", "y")
        return False
    if hashed.startswith("$apr1$"):
        parts = hashed.split("$")
        if len(parts) < 4:
            return False
        got = openssl_apr1(password, parts[2])
        return bool(got) and hmac.compare_digest(got, hashed)
    return False


def sign_session(user: str, exp: int) -> str:
    raw = "%s:%s" % (user, exp)
    sig = hmac.new(session_secret(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return raw + ":" + sig


def parse_session(token: str):
    if not token or token.count(":") != 2:
        return None
    user, exp_s, sig = token.split(":")
    if not re.match(r"^[A-Za-z0-9._-]{1,32}$", user):
        return None
    try:
        exp = int(exp_s)
    except ValueError:
        return None
    if exp < int(time.time()):
        return None
    raw = "%s:%s" % (user, exp)
    expect = hmac.new(session_secret(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return None
    return user


def cookie_header(token: str, max_age: int | None) -> str:
    parts = [
        "%s=%s" % (COOKIE_NAME, token),
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
    ]
    if max_age is not None:
        parts.append("Max-Age=%s" % int(max_age))
    return "; ".join(parts)


def clear_cookie_header() -> str:
    return "%s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" % COOKIE_NAME


def safe_next(raw: str) -> str:
    raw = unquote((raw or "").strip()) or "/"
    if not raw.startswith("/") or raw.startswith("//") or "://" in raw or "\\" in raw:
        return "/"
    path = raw.split("?")[0]
    if path in ("/login", "/logout"):
        return "/"
    return path[:200] or "/"


def login_throttled(ip: str) -> bool:
    now = time.time()
    with _login_lock:
        hits = [t for t in _login_fails.get(ip, []) if now - t < LOGIN_FAIL_WINDOW]
        _login_fails[ip] = hits
        return len(hits) >= LOGIN_FAIL_MAX


def login_fail(ip: str) -> None:
    with _login_lock:
        _login_fails.setdefault(ip, []).append(time.time())


def login_ok(ip: str) -> None:
    with _login_lock:
        _login_fails.pop(ip, None)


SAFE = re.compile(r"[^0-9A-Za-z._\- ]+")
PATH_OK = re.compile(r"^[A-Za-z0-9]{4,80}$")
UUID_OK = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
UUID_FIND = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
HOST_OK = re.compile(r"^[A-Za-z0-9.-]+\.kirvpn\.us$")
SUB_HOST = re.compile(
    r"^(?:hid)?(\d+)\.(?:kirvpn\.us|kirvpn\.ru|sarafan\.uk)$",
    re.I,
)
LABEL_OK = re.compile(r"^[0-9A-Za-z]{1,8}$")
ONE_GIG = 1024 ** 3


def load_nodes():
    with open(NODES_PATH, encoding="utf-8") as f:
        return json.load(f)


def sanitize(q: str) -> str:
    q = SAFE.sub("", q or "").strip()
    q = q.replace("%", "").replace("_", "").replace("\\", "")
    return q[:48]


def remaining_days(package_days, start_date):
    try:
        pd = int(package_days)
    except (TypeError, ValueError):
        return None
    if start_date:
        try:
            sd = datetime.strptime(start_date[:10], "%Y-%m-%d").date()
            res = pd - (date.today() - sd).days
        except ValueError:
            res = pd
    else:
        res = pd
    return min(res, 10000)


def fmt_days(days):
    if days is None:
        return ""
    return f"{days}д"


def fmt_traffic_left(limit, used):
    try:
        left = int(limit or 0) - int(used or 0)
    except (TypeError, ValueError):
        return ""
    if left < 0:
        left = 0
    gb = left / ONE_GIG
    if gb >= 1024:
        tb = gb / 1024
        s = f"{tb:.1f}".rstrip("0").rstrip(".")
        return f"{s}ТБ"
    if gb >= 10:
        return f"{int(round(gb))}ГБ"
    if gb >= 1:
        s = f"{gb:.1f}".rstrip("0").rstrip(".")
        return f"{s}ГБ"
    mb = left / (1024 * 1024)
    if mb >= 1:
        return f"{int(round(mb))}МБ"
    return "0"


def panel_url(domain, path, uuid):
    if HOST_OK.match(domain or "") and PATH_OK.match(path or "") and UUID_OK.match(uuid or ""):
        return f"https://{domain}/{path}/{uuid}/"
    return ""


def parse_user(parts, domain, path):
    while len(parts) < 8:
        parts.append("")
    days = remaining_days(parts[5], parts[6])
    return {
        "id": parts[0],
        "name": parts[1],
        "enable": parts[2] == "1",
        "days": fmt_days(days),
        "traffic": fmt_traffic_left(parts[3], parts[4]),
        "url": panel_url(domain, path, parts[7]),
    }


def search_node(node, needle):
    ip = node["ip"]
    label = node["label"]
    sql = (
        "SELECT 'P', value FROM hiddifypanel.str_config WHERE `key`='proxy_path_client' LIMIT 1; "
        "SELECT 'A', value FROM hiddifypanel.str_config WHERE `key`='proxy_path_admin' LIMIT 1; "
        "SELECT 'S', uuid FROM hiddifypanel.admin_user WHERE mode='super_admin' ORDER BY id LIMIT 1; "
        "SELECT 'D', domain FROM hiddifypanel.domain WHERE domain LIKE '%.kirvpn.us' "
        "ORDER BY (mode='direct') DESC, sub_link_only ASC LIMIT 1; "
        "SELECT id, name, enable, IFNULL(usage_limit,0), IFNULL(current_usage,0), "
        "IFNULL(package_days,0), IFNULL(start_date,''), uuid FROM hiddifypanel.user "
        f"WHERE name LIKE '%{needle}%' ORDER BY name LIMIT 30;"
    )
    remote = "mysql -N -e '" + sql.replace("'", "'\\''") + "'"
    cmd = [
        "ssh",
        "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        "-o", "LogLevel=ERROR",
        f"root@{ip}",
        remote,
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=12)
        text = out.decode("utf-8", "replace").strip()
    except subprocess.CalledProcessError:
        return {"label": label, "ip": ip, "error": "ssh/mysql fail", "users": []}
    except subprocess.TimeoutExpired:
        return {"label": label, "ip": ip, "error": "timeout", "users": []}
    except Exception as e:
        return {"label": label, "ip": ip, "error": str(e)[:80], "users": []}
    path = ""
    admin_path = ""
    admin_uuid = ""
    domain = ""
    users = []
    if text:
        for line in text.splitlines():
            parts = line.split("\t")
            if not parts:
                continue
            if parts[0] == "P" and len(parts) >= 2:
                path = parts[1]
                continue
            if parts[0] == "A" and len(parts) >= 2:
                admin_path = parts[1]
                continue
            if parts[0] == "S" and len(parts) >= 2:
                admin_uuid = parts[1]
                continue
            if parts[0] == "D" and len(parts) >= 2:
                domain = parts[1]
                continue
            if len(parts) >= 3:
                users.append(parse_user(parts, domain, path))
    admin_url = panel_url(domain, admin_path, admin_uuid)
    if admin_url:
        admin_url += "admin/user/?search=" + quote(needle)
    return {
        "label": label,
        "ip": ip,
        "error": None,
        "admin_url": admin_url,
        "users": users,
    }


def search(needle):
    nodes = load_nodes()
    hits = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(search_node, n, needle) for n in nodes]
        for fut in as_completed(futs):
            hits.append(fut.result())
    hits.sort(key=lambda x: (x["label"] != "8", int(re.sub(r"\D", "", x["label"]) or "999"), x["label"]))
    return hits


def mysql_quote(s: str) -> str:
    return "'" + (s or "").replace("\\", "\\\\").replace("'", "''") + "'"


def pro_text_needle(raw: str) -> str:
    out = []
    for ch in raw or "":
        if ch in "\\'\x00<>\"`;%$":
            continue
        if ch.isalnum() or ch in " ._-@+#":
            out.append(ch)
    return "".join(out).strip()[:80]


def mysql_like(s: str) -> str:
    s = (s or "").replace("$", "")
    s = s.replace("%", "$%").replace("_", "$_")
    return mysql_quote("%" + s + "%")


def phone_keys(raw: str) -> list:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 4 or not digits.isdigit():
        return []
    keys = [digits]
    if len(digits) >= 10:
        last10 = digits[-10:]
        keys.append(last10)
        keys.append("7" + last10)
        keys.append("8" + last10)
    out = []
    for k in keys:
        if k.isdigit() and k not in out:
            out.append(k)
    if any(len(k) >= 7 for k in out):
        out = [k for k in out if len(k) >= 7]
    return out[:6]


def digits_sql(field_sql: str) -> str:
    expr = field_sql
    for ch in (" ", "-", "+", "(", ")", ".", "/", "\t"):
        expr = "REPLACE(%s, %s, '')" % (expr, mysql_quote(ch))
    return expr


PHONE_BLOB_SQL = digits_sql(
    "CONCAT(IFNULL(comment,''), IFNULL(name,''), IFNULL(username,''), "
    "IFNULL(CAST(telegram_id AS CHAR),''))"
)


def parse_pro_query(raw: str) -> dict:
    raw = (raw or "").strip()
    if len(raw) > 800:
        raw = raw[:800]
    uuid = ""
    label = ""
    name_hint = ""
    murl = re.search(r"https?://[^\s<>\"']+", raw, re.I)
    url_s = (murl.group(0) if murl else "").rstrip(").,];")
    if url_s:
        u = urlparse(url_s)
        host = (u.hostname or "").lower()
        hm = SUB_HOST.match(host)
        if hm:
            label = str(int(hm.group(1)))
        um = UUID_FIND.search(u.path or "") or UUID_FIND.search(raw)
        if um:
            uuid = um.group(0).lower()
        frag = unquote(u.fragment or "").strip()
        if frag and not UUID_FIND.search(frag):
            name_hint = pro_text_needle(frag)
    if not uuid:
        um = UUID_FIND.search(raw)
        if um:
            uuid = um.group(0).lower()
    needle = ""
    phones = []
    if not uuid:
        needle = pro_text_needle(raw)
        if needle.lower().startswith("http"):
            needle = ""
        phones = phone_keys(raw)
    return {
        "uuid": uuid,
        "needle": needle,
        "phones": phones,
        "label": label,
        "name_hint": name_hint,
        "raw": raw[:200],
    }


def admin_edit_url(domain, admin_path, admin_uuid, user_id):
    base = panel_url(domain, admin_path, admin_uuid)
    if not base:
        return ""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return ""
    if uid < 1:
        return ""
    return base + "admin/user/edit/?id=%s" % uid


def pro_match_tags(name, comment, username, uuid, needle, uuid_q, phones=None, telegram_id=""):
    tags = []
    n = (needle or "").lower()
    if uuid_q and (uuid or "").lower() == uuid_q.lower():
        tags.append("uuid")
    if n:
        if n in (name or "").lower():
            tags.append("имя")
        if n in (comment or "").lower():
            tags.append("заметка")
        if n in (username or "").lower():
            tags.append("username")
        if not uuid_q and n in (uuid or "").lower():
            tags.append("uuid")
    blob = re.sub(r"\D", "", "".join([name or "", comment or "", username or "", str(telegram_id or "")]))
    if phones and any(p in blob for p in phones):
        if "телефон" not in tags:
            tags.append("телефон")
        if telegram_id and any(p in re.sub(r"\D", "", str(telegram_id)) for p in phones):
            if "telegram" not in tags:
                tags.append("telegram")
    return tags


def parse_pro_user(parts, domain, admin_path, admin_uuid, needle, uuid_q, phones=None):
    while len(parts) < 11:
        parts.append("")
    days = remaining_days(parts[5], parts[6])
    name = parts[1]
    uuid = parts[7]
    comment = parts[8]
    username = parts[9]
    telegram_id = parts[10]
    tags = pro_match_tags(name, comment, username, uuid, needle, uuid_q, phones, telegram_id)
    note = comment or ""
    if (not note) and telegram_id:
        note = telegram_id
    return {
        "id": parts[0],
        "name": name,
        "enable": parts[2] == "1",
        "days": fmt_days(days),
        "traffic": fmt_traffic_left(parts[3], parts[4]),
        "uuid": uuid,
        "comment": note[:180],
        "username": username,
        "match": tags,
        "url": admin_edit_url(domain, admin_path, admin_uuid, parts[0]),
    }


def _ssh_mysql(ip, sql):
    remote = "mysql -N -e '" + sql.replace("'", "'\\''") + "'"
    cmd = [
        "ssh",
        "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        "-o", "LogLevel=ERROR",
        f"root@{ip}",
        remote,
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=12)
        return out.decode("utf-8", "replace").strip(), None
    except subprocess.CalledProcessError:
        return "", "ssh/mysql fail"
    except subprocess.TimeoutExpired:
        return "", "timeout"
    except Exception as e:
        return "", str(e)[:80]


def common_name_fragment(names):
    names = [(n or "").strip() for n in names if (n or "").strip()]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    shortest = min(names, key=len)
    s = shortest.lower()
    lows = [n.lower() for n in names]
    for length in range(len(s), 1, -1):
        for i in range(0, len(s) - length + 1):
            sub = s[i:i + length]
            if not re.search(r"[0-9A-Za-zА-Яа-я]", sub):
                continue
            if all(sub in n for n in lows):
                return shortest[i:i + length]
    return names[0]


def hiddify_name_search(users, needle, uuid_q):
    if uuid_q:
        return uuid_q
    names = [(u.get("name") or "").strip() for u in users]
    names = [n for n in names if n]
    n = (needle or "").strip()
    if n and any(n.lower() in name.lower() for name in names):
        return n
    return common_name_fragment(names) or n


def search_pro_node(node, parsed):
    ip = node["ip"]
    label = node["label"]
    uuid_q = parsed.get("uuid") or ""
    needle = parsed.get("needle") or parsed.get("name_hint") or ""
    phones = parsed.get("phones") or []
    clauses = []
    if uuid_q and UUID_OK.match(uuid_q):
        clauses.append("uuid = " + mysql_quote(uuid_q))
    if needle and not uuid_q:
        like = mysql_like(needle)
        clauses.append(
            "(name LIKE {like} ESCAPE '$' OR IFNULL(comment,'') LIKE {like} ESCAPE '$' "
            "OR IFNULL(username,'') LIKE {like} ESCAPE '$' OR uuid LIKE {like} ESCAPE '$' "
            "OR CAST(telegram_id AS CHAR) LIKE {like} ESCAPE '$')"
            .format(like=like)
        )
    if phones and not uuid_q:
        phone_ors = []
        for p in phones:
            if not p.isdigit() or len(p) < 4:
                continue
            phone_ors.append(PHONE_BLOB_SQL + " LIKE " + mysql_quote("%" + p + "%"))
        if phone_ors:
            clauses.append("(" + " OR ".join(phone_ors) + ")")
    if not clauses:
        return {"label": label, "ip": ip, "error": None, "admin_url": "", "users": []}
    where = " OR ".join(clauses)
    sql = (
        "SELECT 'P', value FROM hiddifypanel.str_config WHERE `key`='proxy_path_client' LIMIT 1; "
        "SELECT 'A', value FROM hiddifypanel.str_config WHERE `key`='proxy_path_admin' LIMIT 1; "
        "SELECT 'S', uuid FROM hiddifypanel.admin_user WHERE mode='super_admin' ORDER BY id LIMIT 1; "
        "SELECT 'D', domain FROM hiddifypanel.domain WHERE domain LIKE '%.kirvpn.us' "
        "ORDER BY (mode='direct') DESC, sub_link_only ASC LIMIT 1; "
        "SELECT id, name, enable, IFNULL(usage_limit,0), IFNULL(current_usage,0), "
        "IFNULL(package_days,0), IFNULL(start_date,''), uuid, "
        "IFNULL(comment,''), IFNULL(username,''), IFNULL(telegram_id,'') FROM hiddifypanel.user "
        "WHERE {where} ORDER BY name LIMIT 30;"
    ).format(where=where)
    text, err = _ssh_mysql(ip, sql)
    if err:
        return {"label": label, "ip": ip, "error": err, "users": []}
    path = ""
    admin_path = ""
    admin_uuid = ""
    domain = ""
    users = []
    if text:
        for line in text.splitlines():
            parts = line.split("\t")
            if not parts:
                continue
            if parts[0] == "P" and len(parts) >= 2:
                path = parts[1]
                continue
            if parts[0] == "A" and len(parts) >= 2:
                admin_path = parts[1]
                continue
            if parts[0] == "S" and len(parts) >= 2:
                admin_uuid = parts[1]
                continue
            if parts[0] == "D" and len(parts) >= 2:
                domain = parts[1]
                continue
            if len(parts) >= 3:
                users.append(
                    parse_pro_user(parts, domain, admin_path, admin_uuid, needle, uuid_q, phones)
                )
    search_q = hiddify_name_search(users, needle, uuid_q)
    admin_url = panel_url(domain, admin_path, admin_uuid)
    if admin_url and search_q:
        admin_url += "admin/user/?search=" + quote(search_q)
    return {
        "label": label,
        "ip": ip,
        "error": None,
        "admin_url": admin_url,
        "users": users,
    }


def _search_pro_nodes(nodes, parsed):
    hits = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(search_pro_node, n, parsed) for n in nodes]
        for fut in as_completed(futs):
            hits.append(fut.result())
    return hits


def search_pro(parsed):
    all_nodes = load_nodes()
    hint = parsed.get("label") or ""
    scoped = False
    nodes = all_nodes
    if hint:
        only = [n for n in all_nodes if n["label"] == hint]
        if only:
            nodes = only
            scoped = True
    hits = _search_pro_nodes(nodes, parsed)
    if scoped and hint and not any(h.get("users") for h in hits):
        rest = [n for n in all_nodes if n["label"] != hint]
        hits.extend(_search_pro_nodes(rest, parsed))
        scoped = False
    if (
        parsed.get("uuid")
        and parsed.get("name_hint")
        and not any(h.get("users") for h in hits)
    ):
        fb = dict(parsed)
        fb["uuid"] = ""
        fb["needle"] = parsed["name_hint"]
        hits = search_pro(fb)[0]
        scoped = False
    hits.sort(key=lambda x: (x["label"] != "8", int(re.sub(r"\D", "", x["label"]) or "999"), x["label"]))
    return hits, scoped


def load_announce():
    try:
        with open(ANNOUNCE_PATH, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _node_sort(label: str):
    return (label != "8", int(re.sub(r"\D", "", label) or "999"), label)


def _announce_file(label: str) -> str:
    return os.path.join(ANNOUNCE_DIR, label + ".txt")


def _clean_announce(text: str) -> str:
    text = (text or "").replace("\x00", "").strip()
    if len(text) > MAX_ANNOUNCE:
        text = text[:MAX_ANNOUNCE]
    return text


def save_announce_file(label: str, text: str):
    os.makedirs(ANNOUNCE_DIR, exist_ok=True)
    path = _announce_file(label)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_announce_map():
    fallback = load_announce()
    servers = []
    texts = []
    for n in load_nodes():
        label = n["label"]
        text = fallback
        try:
            with open(_announce_file(label), encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            pass
        servers.append({"label": label, "text": text})
        texts.append(text)
    same = bool(texts) and all(t == texts[0] for t in texts)
    return {
        "servers": servers,
        "text": texts[0] if same else fallback,
        "all": same,
    }


def load_info():
    try:
        with open(INFO_TEXT_PATH, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def html_esc(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_info_html(text: str) -> str:
    # Tab «Информация»: the short status the operator saves.
    # Tab «Инструкция» is guide.html and is not built from this text.
    body = html_esc(text).replace("\n", "<br>\n")
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0b1220">
  <title>KirVPN</title>
  <style>
    :root {{ color-scheme: dark; }}
    * {{ box-sizing: border-box; }}
    html {{ overflow-y: scroll; scrollbar-gutter: stable; }}
    html, body {{ margin: 0; max-width: 100%; overflow-x: hidden; }}
    body {{
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #0b1220;
      color: #e8eefc;
      display: flex;
      flex-direction: column;
    }}
    .site-tabs {{
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-content: end;
      gap: 8px;
      width: min(440px, 100%);
      height: 62px;
      margin: 0 auto;
      padding: 12px 16px 0;
      background: #0b1220;
      flex: 0 0 auto;
      align-self: center;
    }}
    .site-tabs a {{
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 50px;
      min-height: 50px;
      max-height: 50px;
      min-width: 0;
      margin: 0;
      padding: 6px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 700;
      font-size: 0.875rem;
      line-height: 1.15;
      text-align: center;
      overflow: hidden;
      color: #c5d4ea;
      background: #121b2e;
      border: 1px solid #24324d;
    }}
    .site-tabs a.on {{
      color: #ffffff;
      background: #3a4c68;
      border-color: #d5deec;
    }}
    main {{
      flex: 1;
      width: min(440px, 100%);
      margin: 0 auto;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px 32px;
    }}
    .msg {{
      margin: 0;
      font-size: 1.4625rem;
      font-weight: 600;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }}
  </style>
</head>
<body>
  <nav class="site-tabs">
    <a class="on" href="/">Информация</a>
    <a href="/guide.html">Инструкция</a>
    <a href="/auto.html">Правила</a>
  </nav>
  <main>
    <p class="msg">{body}</p>
  </main>
</body>
</html>
"""


def _publish_static(src: str, name: str):
    if not os.path.isfile(src):
        return
    with open(src, encoding="utf-8") as f:
        data = f.read()
    os.makedirs(INFO_WWW_DIR, exist_ok=True)
    path = os.path.join(INFO_WWW_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, path)


def publish_guide():
    _publish_static(INFO_GUIDE_PATH, "guide.html")
    _publish_static(INFO_AUTO_PATH, "auto.html")


def save_info(text: str):
    text = (text or "").replace("\x00", "").strip()
    if len(text) > MAX_INFO:
        text = text[:MAX_INFO]
    with open(INFO_TEXT_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    html = render_info_html(text)
    os.makedirs(INFO_WWW_DIR, exist_ok=True)
    for name in INFO_PAGES:
        path = os.path.join(INFO_WWW_DIR, name)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(html)
        os.replace(tmp, path)
    publish_guide()
    return {"ok": True, "text": text}


def ssh_cmd(ip, remote, timeout=20):
    return [
        "ssh",
        "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        "-o", "LogLevel=ERROR",
        f"root@{ip}",
        remote,
    ]


def push_one(node, b64):
    label, ip = node["label"], node["ip"]
    remote = "python3 /opt/kirvpn/set_announce.py " + (b64 or "''")
    try:
        out = subprocess.check_output(ssh_cmd(ip, remote), stderr=subprocess.STDOUT, timeout=25)
        text = out.decode("utf-8", "replace")
        ok = "ok" in text
        return {"label": label, "ok": ok, "error": None if ok else text[-120:]}
    except subprocess.TimeoutExpired:
        return {"label": label, "ok": False, "error": "timeout"}
    except subprocess.CalledProcessError as e:
        return {"label": label, "ok": False, "error": (e.output or b"").decode("utf-8", "replace")[-120:] or "ssh fail"}
    except Exception as e:
        return {"label": label, "ok": False, "error": str(e)[:80]}


_push_lock = threading.Lock()
_push = {
    "seq": 0,
    "running": False,
    "done": True,
    "text": "",
    "nodes": [],
    "error": None,
}


def _run_push(seq: int, jobs: list):
    try:
        results = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = [ex.submit(push_one, j["node"], j["b64"]) for j in jobs]
            for fut in as_completed(futs):
                results.append(fut.result())
        results.sort(key=lambda x: _node_sort(x["label"]))
        with _push_lock:
            if _push["seq"] != seq:
                return
            _push["nodes"] = results
            _push["error"] = None
            _push["running"] = False
            _push["done"] = True
    except Exception as e:
        with _push_lock:
            if _push["seq"] != seq:
                return
            _push["error"] = str(e)[:120]
            _push["running"] = False
            _push["done"] = True


def push_status():
    with _push_lock:
        nodes = list(_push["nodes"])
        running = _push["running"]
        done = _push["done"]
        err = _push["error"]
    amap = load_announce_map()
    return {
        "ok": True if running else (not err),
        "text": amap["text"],
        "all": amap["all"],
        "servers": amap["servers"],
        "pushing": running,
        "done": (not running) and done,
        "error": err,
        "nodes": nodes,
    }


def _jobs_from_payload(data: dict):
    known = {n["label"]: n for n in load_nodes()}
    if not known:
        raise ValueError("нет серверов")
    all_mode = bool(data.get("all"))
    jobs = []
    if all_mode or "servers" not in data:
        text = _clean_announce(str(data.get("text") or ""))
        for n in known.values():
            jobs.append({"label": n["label"], "text": text, "node": n})
    else:
        seen = set()
        raw = data.get("servers") or []
        if not isinstance(raw, list) or not raw:
            raise ValueError("нет серверов")
        for item in raw:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "")
            if not LABEL_OK.match(label) or label not in known or label in seen:
                continue
            seen.add(label)
            jobs.append({
                "label": label,
                "text": _clean_announce(str(item.get("text") or "")),
                "node": known[label],
            })
        if not jobs:
            raise ValueError("нет серверов")
    return jobs


def push_announce(data: dict):
    jobs = _jobs_from_payload(data)
    texts = [j["text"] for j in jobs]
    same = all(t == texts[0] for t in texts)
    shared = texts[0] if same else load_announce()
    if same:
        with open(ANNOUNCE_PATH, "w", encoding="utf-8") as f:
            f.write(shared)
    for j in jobs:
        save_announce_file(j["label"], j["text"])
        j["b64"] = base64.b64encode(j["text"].encode("utf-8")).decode("ascii")
    with _push_lock:
        _push["seq"] += 1
        seq = _push["seq"]
        _push["running"] = True
        _push["done"] = False
        _push["text"] = shared
        _push["nodes"] = []
        _push["error"] = None
    threading.Thread(target=_run_push, args=(seq, jobs), daemon=True).start()
    return {
        "ok": True,
        "text": shared,
        "all": same,
        "servers": [{"label": j["label"], "text": j["text"]} for j in jobs],
        "pushing": True,
        "done": False,
        "nodes": [],
    }


_traffic_lock = threading.Lock()
_traffic_cache = {"at": 0.0, "payload": None}
_users_lock = threading.Lock()
_users_cache = {"at": 0.0, "payload": None}


def _hostup_key() -> str:
    env = (os.environ.get("HOSTUP_KEY") or "").strip()
    if env:
        return env
    try:
        return open(HOSTUP_KEY_PATH, encoding="utf-8").read().strip()
    except FileNotFoundError:
        return ""


def _is_deleted_vps(v: dict) -> bool:
    ip = str(v.get("primaryIp") or "").strip()
    if ip in DELETED_IPS:
        return True
    blob = " ".join([
        str(v.get("name") or ""),
        str((v.get("customerMetadata") or {}).get("displayName") or ""),
    ]).lower()
    if any(excluded in blob for excluded in DELETED_IPS):
        return True
    if re.search(r"54\s*[-_]?\s*delete", blob):
        return True
    return False


def _vps_label(v: dict) -> str:
    name = str(v.get("name") or "")
    disp = str((v.get("customerMetadata") or {}).get("displayName") or "")
    blob = (disp or name).strip()
    joined = (name + " " + disp).strip()
    if re.match(r"^ov\b", blob, re.I) or re.search(r"\bov\.local\b", joined, re.I):
        return "OV"
    m = re.search(r"(\d+)", blob) or re.search(r"(\d+)", joined)
    if m:
        return str(int(m.group(1)))
    return (blob[:8] or "?").upper()


def _fmt_gb(gb) -> str:
    try:
        gb = float(gb or 0)
    except (TypeError, ValueError):
        return "—"
    if gb < 0:
        gb = 0
    if gb >= 1024:
        tb = gb / 1024
        s = f"{tb:.1f}".rstrip("0").rstrip(".")
        return f"{s} ТБ"
    if gb >= 10:
        return f"{int(round(gb))} ГБ"
    if gb >= 1:
        s = f"{gb:.1f}".rstrip("0").rstrip(".")
        return f"{s} ГБ"
    mb = gb * 1024
    if mb >= 1:
        return f"{int(round(mb))} МБ"
    return "0"


def _num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _hostup_get(path: str) -> dict:
    key = _hostup_key()
    if not key:
        raise RuntimeError("нет ключа HostUp")
    req = Request(
        HOSTUP_API + path,
        headers={
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
            "User-Agent": "kirvpn-find/traffic",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=25) as r:
            raw = r.read().decode("utf-8", "replace")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        raise RuntimeError("HostUp HTTP %s" % e.code)
    except URLError:
        raise RuntimeError("HostUp не отвечает")


def _hostup_vps_list() -> list:
    items = []
    cursor = None
    for _ in range(8):
        path = "/vps?limit=100"
        if cursor:
            path += "&cursor=" + quote(str(cursor))
        payload = _hostup_get(path)
        chunk = payload.get("data") or []
        if isinstance(chunk, list):
            items.extend(chunk)
        if not payload.get("hasMore"):
            break
        cursor = payload.get("nextCursor")
        if not cursor:
            break
    return items


def _billing_url(vid: str) -> str:
    vid = str(vid or "").strip()
    if not VPS_ID_OK.match(vid):
        return ""
    return "%s/instance/%s?tab=billing" % (HOSTUP_PORTAL, vid)


def _traffic_row(v: dict) -> dict:
    bw = v.get("bandwidth") if isinstance(v.get("bandwidth"), dict) else {}
    used = _num(bw.get("usedGb"))
    limit = _num(bw.get("limitGb"))
    left = max(limit - used, 0.0)
    pct = (used / limit * 100.0) if limit > 0 else 0.0
    over = bool(bw.get("hasOverage"))
    if over or pct >= 85 or (limit > 0 and left < 1024):
        level = "hot"
    elif pct >= 70:
        level = "warn"
    elif pct >= 50:
        level = "mid"
    else:
        level = "ok"
    label = _vps_label(v)
    vid = str(v.get("id") or "").strip()
    if not VPS_ID_OK.match(vid):
        vid = ""
    return {
        "label": label,
        "ip": str(v.get("primaryIp") or ""),
        "name": str(v.get("name") or ""),
        "id": vid,
        "billing_url": _billing_url(vid),
        "used_gb": round(used, 3),
        "limit_gb": round(limit, 3),
        "left_gb": round(left, 3),
        "pct": round(pct, 1),
        "pct_s": ("%s%%" % (int(round(pct)) if abs(pct - round(pct)) < 0.05 else f"{pct:.1f}".rstrip("0").rstrip("."))),
        "used_s": _fmt_gb(used),
        "limit_s": _fmt_gb(limit),
        "left_s": _fmt_gb(left),
        "over": over,
        "level": level,
        "status": str(v.get("serviceStatus") or ""),
        "power": str(v.get("powerState") or ""),
    }


def _traffic_sort(row: dict):
    label = str(row.get("label") or "")
    digits = re.sub(r"\D", "", label)
    return (
        -float(row.get("pct") or 0),
        float(row.get("left_gb") or 0),
        0 if label.isdigit() else 1,
        label != "8",
        int(digits or "999"),
        label,
    )


def load_traffic(force: bool = False) -> dict:
    now = time.time()
    with _traffic_lock:
        cached = _traffic_cache["payload"]
        if cached and not force and (now - _traffic_cache["at"]) < TRAFFIC_CACHE_SEC:
            return cached
    try:
        rows = []
        skipped = 0
        for v in _hostup_vps_list():
            if not isinstance(v, dict):
                continue
            if _is_deleted_vps(v):
                skipped += 1
                continue
            rows.append(_traffic_row(v))
        rows.sort(key=_traffic_sort)
        payload = {
            "ok": True,
            "servers": rows,
            "skipped": skipped,
            "updated": int(now),
            "stale": False,
            "error": None,
        }
    except Exception as e:
        with _traffic_lock:
            old = _traffic_cache["payload"]
        if old:
            out = dict(old)
            out["stale"] = True
            out["error"] = str(e)[:120]
            return out
        return {"ok": False, "error": str(e)[:120], "servers": [], "updated": int(now)}
    with _traffic_lock:
        _traffic_cache["at"] = now
        _traffic_cache["payload"] = payload
    return payload


def _int_count(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def users_node(node):
    ip = node["ip"]
    label = node["label"]
    sql = (
        "SELECT 'A', value FROM hiddifypanel.str_config WHERE `key`='proxy_path_admin' LIMIT 1; "
        "SELECT 'S', uuid FROM hiddifypanel.admin_user WHERE mode='super_admin' ORDER BY id LIMIT 1; "
        "SELECT 'D', domain FROM hiddifypanel.domain WHERE domain LIKE '%.kirvpn.us' "
        "ORDER BY (mode='direct') DESC, sub_link_only ASC LIMIT 1; "
        "SELECT 'C', COUNT(*), "
        "IFNULL(SUM(enable=1 AND (IFNULL(package_days,0)=0 OR start_date IS NULL "
        "OR TIMESTAMPDIFF(DAY,start_date,CURDATE()) < package_days)),0), "
        "IFNULL(SUM(enable=1 AND IFNULL(package_days,0)>0 AND start_date IS NOT NULL "
        "AND TIMESTAMPDIFF(DAY,start_date,CURDATE()) >= package_days),0), "
        "IFNULL(SUM(enable=0),0) FROM hiddifypanel.user;"
    )
    text, err = _ssh_mysql(ip, sql)
    row = {
        "label": label,
        "ip": ip,
        "error": err,
        "admin_url": "",
        "total": 0,
        "active": 0,
        "expired": 0,
        "disabled": 0,
    }
    if err:
        return row
    admin_path = ""
    admin_uuid = ""
    domain = ""
    if text:
        for line in text.splitlines():
            parts = line.split("\t")
            if not parts:
                continue
            if parts[0] == "A" and len(parts) >= 2:
                admin_path = parts[1]
                continue
            if parts[0] == "S" and len(parts) >= 2:
                admin_uuid = parts[1]
                continue
            if parts[0] == "D" and len(parts) >= 2:
                domain = parts[1]
                continue
            if parts[0] == "C" and len(parts) >= 5:
                row["total"] = _int_count(parts[1])
                row["active"] = _int_count(parts[2])
                row["expired"] = _int_count(parts[3])
                row["disabled"] = _int_count(parts[4])
    admin_url = panel_url(domain, admin_path, admin_uuid)
    if admin_url:
        row["admin_url"] = admin_url + "admin/user/"
    return row


def load_users(force: bool = False) -> dict:
    now = time.time()
    with _users_lock:
        cached = _users_cache["payload"]
        if cached and not force and (now - _users_cache["at"]) < USERS_CACHE_SEC:
            return cached
    rows = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(users_node, n) for n in load_nodes()]
        for fut in as_completed(futs):
            rows.append(fut.result())
    rows.sort(key=lambda x: _node_sort(x["label"]))
    totals = {"total": 0, "active": 0, "expired": 0, "disabled": 0}
    for r in rows:
        if r.get("error"):
            continue
        for k in totals:
            totals[k] += _int_count(r.get(k))
    payload = {
        "ok": True,
        "servers": rows,
        "totals": totals,
        "updated": int(now),
        "stale": False,
        "error": None,
    }
    with _users_lock:
        _users_cache["at"] = now
        _users_cache["payload"] = payload
    return payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _client_ip(self) -> str:
        ip = (self.headers.get("X-Real-IP") or "").strip()
        if re.match(r"^[0-9a-fA-F.:]+$", ip):
            return ip[:64]
        return self.client_address[0]

    def _headers_common(self, extra=None):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("X-Frame-Options", "DENY")
        if extra:
            for k, v in extra:
                self.send_header(k, v)

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._headers_common(extra)
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, loc, extra=None):
        self.send_response(303)
        self.send_header("Location", loc)
        self._headers_common(extra)
        self.end_headers()

    def _session_user(self):
        raw = self.headers.get("Cookie") or ""
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(COOKIE_NAME)
        if not morsel:
            return None
        return parse_session(morsel.value)

    def _login_page(self, next_path="/", err=""):
        html = open(LOGIN_HTML_PATH, encoding="utf-8").read()
        err_html = ('<p class="err">%s</p>' % err) if err else ""
        html = html.replace("__ERROR__", err_html).replace("__NEXT__", next_path.replace("&", "&amp;").replace('"', "&quot;"))
        return html

    def _need_login(self, u):
        user = self._session_user()
        if user:
            return None
        if u.path.startswith("/api"):
            self._send(401, json.dumps({"ok": False, "error": "нужен вход"}, ensure_ascii=False), "application/json")
            return True
        nxt = quote(u.path if u.path.startswith("/") else "/", safe="/")
        self._redirect("/login?next=" + nxt)
        return True

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/login":
            if self._session_user():
                return self._redirect(safe_next(parse_qs(u.query).get("next", ["/"])[0]))
            return self._send(200, self._login_page(safe_next(parse_qs(u.query).get("next", ["/"])[0])))
        if u.path == "/logout":
            return self._redirect("/login", extra=[("Set-Cookie", clear_cookie_header())])
        if self._need_login(u):
            return
        if u.path in ("/", "/index.html"):
            html = open(HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/announce", "/announce.html"):
            html = open(ANNOUNCE_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/info", "/info.html"):
            html = open(INFO_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/traffic", "/traffic.html"):
            html = open(TRAFFIC_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/pro", "/pro.html"):
            html = open(PRO_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/users", "/users.html"):
            html = open(USERS_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path in ("/testing", "/testing.html"):
            html = open(TESTING_HTML_PATH, encoding="utf-8").read()
            return self._send(200, html)
        if u.path == "/api/test/map":
            try:
                payload = testing.map_payload()
            except Exception as e:
                payload = {"ok": False, "error": str(e)[:160], "servers": []}
            return self._send(200, json.dumps(payload, ensure_ascii=False), "application/json")
        if u.path == "/api/test/status":
            try:
                payload = {
                    "ok": True,
                    "probe": testing.probe_status(),
                    "reboot": testing.reboot_status(),
                }
            except Exception as e:
                payload = {"ok": False, "error": str(e)[:160]}
            return self._send(200, json.dumps(payload, ensure_ascii=False), "application/json")
        if u.path == "/api/announce":
            return self._send(200, json.dumps(push_status(), ensure_ascii=False), "application/json")
        if u.path == "/api/info":
            return self._send(200, json.dumps({"ok": True, "text": load_info()}, ensure_ascii=False), "application/json")
        if u.path == "/api/traffic":
            force = parse_qs(u.query).get("refresh", [""])[0] in ("1", "true", "yes")
            try:
                payload = load_traffic(force=force)
            except Exception as e:
                payload = {"ok": False, "error": str(e)[:120], "servers": []}
            return self._send(200, json.dumps(payload, ensure_ascii=False), "application/json")
        if u.path == "/api/users":
            force = parse_qs(u.query).get("refresh", [""])[0] in ("1", "true", "yes")
            try:
                payload = load_users(force=force)
            except Exception as e:
                payload = {"ok": False, "error": str(e)[:120], "servers": []}
            return self._send(200, json.dumps(payload, ensure_ascii=False), "application/json")
        if u.path == "/api":
            try:
                q = parse_qs(u.query).get("q", [""])[0]
                needle = sanitize(q)
                if len(needle) < 2:
                    return self._send(400, json.dumps({"ok": False, "error": "минимум 2 символа"}, ensure_ascii=False), "application/json")
                hits = search(needle)
                found = [h for h in hits if h["users"]]
                return self._send(200, json.dumps({"ok": True, "q": needle, "found": found, "checked": len(hits)}, ensure_ascii=False), "application/json")
            except Exception as e:
                return self._send(500, json.dumps({"ok": False, "error": str(e)[:120]}, ensure_ascii=False), "application/json")
        if u.path == "/api/pro":
            try:
                q = parse_qs(u.query).get("q", [""])[0]
                parsed = parse_pro_query(q)
                if not parsed["uuid"] and len(parsed["needle"]) < 2 and not parsed.get("phones"):
                    return self._send(400, json.dumps({"ok": False, "error": "вставь ключ, uuid, имя или телефон"}, ensure_ascii=False), "application/json")
                hits, scoped = search_pro(parsed)
                found = [h for h in hits if h["users"]]
                total = sum(len(h["users"]) for h in found)
                qshow = parsed["uuid"] or parsed["needle"] or parsed["raw"]
                return self._send(
                    200,
                    json.dumps(
                        {
                            "ok": True,
                            "q": qshow,
                            "mode": "uuid" if parsed["uuid"] else "text",
                            "server": parsed["label"] or None,
                            "scoped": scoped,
                            "auto": total == 1,
                            "found": found,
                            "checked": len(hits),
                        },
                        ensure_ascii=False,
                    ),
                    "application/json",
                )
            except Exception as e:
                return self._send(500, json.dumps({"ok": False, "error": str(e)[:120]}, ensure_ascii=False), "application/json")
        return self._send(404, "not found")

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/login":
            return self._handle_login()
        if self._need_login(u):
            return
        if u.path not in ("/api/announce", "/api/info", "/api/test/run", "/api/test/reboot"):
            return self._send(404, "not found")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > 50000:
            return self._send(400, json.dumps({"ok": False, "error": "too large"}, ensure_ascii=False), "application/json")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return self._send(400, json.dumps({"ok": False, "error": "json"}, ensure_ascii=False), "application/json")
        try:
            if u.path == "/api/info":
                result = save_info(str(data.get("text") or ""))
            elif u.path == "/api/test/run":
                result = testing.start_probe(force=bool((data or {}).get("force")))
            elif u.path == "/api/test/reboot":
                result = testing.start_reboot(
                    str((data or {}).get("scope") or ""),
                    str((data or {}).get("confirm") or ""),
                )
            else:
                result = push_announce(data if isinstance(data, dict) else {})
        except ValueError as e:
            return self._send(400, json.dumps({"ok": False, "error": str(e)[:120]}, ensure_ascii=False), "application/json")
        except Exception as e:
            return self._send(500, json.dumps({"ok": False, "error": str(e)[:120]}, ensure_ascii=False), "application/json")
        return self._send(200, json.dumps(result, ensure_ascii=False), "application/json")

    def _handle_login(self):
        ip = self._client_ip()
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > 4000:
            return self._send(400, self._login_page("/", "слишком длинно"))
        raw = self.rfile.read(n) if n else b""
        form = parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True)
        user = (form.get("username", [""])[0] or "").strip()
        password = form.get("password", [""])[0] or ""
        nxt = safe_next(form.get("next", ["/"])[0])
        remember = form.get("remember", [""])[0] == "1"
        if login_throttled(ip):
            return self._send(429, self._login_page(nxt, "слишком много попыток, подожди немного"))
        if not check_password(user, password):
            login_fail(ip)
            time.sleep(0.25)
            return self._send(401, self._login_page(nxt, "неверный логин или пароль"))
        login_ok(ip)
        max_age = REMEMBER_SEC if remember else None
        exp = int(time.time()) + (max_age if max_age is not None else 12 * 3600)
        token = sign_session(user, exp)
        extra = [("Set-Cookie", cookie_header(token, max_age))]
        return self._redirect(nxt, extra=extra)

    def do_HEAD(self):
        u = urlparse(self.path)
        if u.path in ("/login", "/logout"):
            self.send_response(200)
            self._headers_common()
            self.end_headers()
            return
        if not self._session_user():
            self.send_response(401)
            self._headers_common()
            self.end_headers()
            return
        known = (
            "/", "/index.html", "/announce", "/announce.html",
            "/info", "/info.html", "/traffic", "/traffic.html",
            "/pro", "/pro.html", "/users", "/users.html",
            "/testing", "/testing.html",
            "/api/announce", "/api/info", "/api/traffic", "/api/users", "/api", "/api/pro",
            "/api/test/map", "/api/test/status", "/api/test/run", "/api/test/reboot",
        )
        self.send_response(200 if u.path in known else 404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self._headers_common()
        self.end_headers()


def main():
    httpd = ThreadingHTTPServer(LISTEN, Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
