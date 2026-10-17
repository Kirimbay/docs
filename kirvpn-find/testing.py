#!/usr/bin/env python3
"""RU reachability map, check-host probes, sequential reboot. No DNS changes."""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import hiddify_api

ROOT = os.path.dirname(os.path.abspath(__file__))
FLEET_PATH = os.path.join(ROOT, "fleet.json")
NODES_PATH = os.path.join(ROOT, "nodes.json")
SSH_KEY = os.path.join(ROOT, "id_ed25519")


def _load_hub_ip() -> str:
    try:
        with open(FLEET_PATH, encoding="utf-8") as f:
            fleet = json.load(f)
        return str((fleet.get("hub") or {}).get("ip") or "").strip()
    except (OSError, json.JSONDecodeError, AttributeError):
        return ""


HUB_IP = _load_hub_ip()
NODES = {
    "ru1": "ru1.node.check-host.net",
    "ru2": "ru2.node.check-host.net",
    "ru3": "ru3.node.check-host.net",
}
NODE_LABEL = {"ru1": "Москва 1", "ru2": "Москва 2", "ru3": "СПб"}
PATH_RU = {
    "rf_direct": "релей → origin",
    "rf_hub": "релей → хаб → origin",
    "hub": "DNS на хаб → origin",
    "origin": "напрямую origin",
}
PROBE_CACHE_SEC = 45
PROBE_MIN_SEC = 55
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

_lock = threading.Lock()
_probe = {
    "running": False,
    "at": 0.0,
    "payload": None,
    "error": None,
    "log": [],
}
_reboot = {
    "running": False,
    "done": True,
    "scope": "",
    "log": [],
    "error": None,
    "ok": 0,
    "fail": 0,
}


def load_fleet() -> dict:
    with open(FLEET_PATH, encoding="utf-8") as f:
        return json.load(f)


def ssh_base(ip: str, jump: bool = False) -> list:
    cmd = [
        "ssh",
        "-i", SSH_KEY,
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        "-o", "LogLevel=ERROR",
    ]
    if jump:
        proxy = (
            "ssh -i %s -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "
            "-o ConnectTimeout=8 -o BatchMode=yes -o LogLevel=ERROR -W %%h:%%p root@%s"
            % (SSH_KEY, HUB_IP)
        )
        cmd += ["-o", "ProxyCommand=" + proxy]
    cmd.append("root@" + ip)
    return cmd


def ssh_out(ip: str, remote: str, timeout: int = 20, jump: bool = False) -> tuple[int, str]:
    try:
        p = subprocess.run(
            ssh_base(ip, jump=jump) + [remote],
            capture_output=True,
            timeout=timeout,
        )
        text = (p.stdout or b"").decode("utf-8", "replace")
        err = (p.stderr or b"").decode("utf-8", "replace")
        return p.returncode, (text + err).strip()
    except subprocess.TimeoutExpired:
        return 1, "timeout"
    except Exception as e:
        return 1, str(e)[:80]


def resolve_a(host: str) -> str:
    try:
        infos = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
        if infos:
            return infos[0][4][0]
    except Exception:
        return ""
    return ""


def tcp_local(ip: str, port: int = 443, timeout: float = 4.0) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False


def httpj(url: str, timeout: int = 25) -> dict:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "kirvpn-find/testing"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def redact_url(url: str) -> str:
    return UUID_RE.sub("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", url or "")


def ch_start(kind: str, host: str) -> str:
    q = [("host", host)] + [("node", n) for n in NODES.values()]
    last = None
    for i in range(6):
        try:
            d = httpj("https://check-host.net/check-%s?%s" % (kind, urllib.parse.urlencode(q)))
            rid = d.get("request_id") or ""
            if rid:
                return rid
            last = RuntimeError("check-host no id")
        except Exception as e:
            last = e
            msg = str(e)
            if "429" in msg or "Too Many" in msg:
                time.sleep(6 + 5 * i)
                continue
        time.sleep(1.4 * (i + 1))
    raise last or RuntimeError("check-host fail")


def ch_wait(rid: str, timeout: float = 36.0) -> dict:
    want = list(NODES.values())
    last = {}
    t0 = time.time()
    while time.time() - t0 < timeout:
        last = httpj("https://check-host.net/check-result/" + rid)
        if last and all(last.get(n) not in (None, [None]) for n in want):
            break
        time.sleep(1.15)
    return last or {}


def parse_ping(v) -> str:
    if not v or v == [None]:
        return "fail"
    group = v[0] if isinstance(v, list) else v
    if isinstance(group, list) and group:
        first = group[0]
        if isinstance(first, list) and first and str(first[0]).upper() == "OK":
            return "ok"
    return "fail"


def ru_pack_ping(last: dict) -> dict:
    return {k: parse_ping(last.get(n)) for k, n in NODES.items()}


def node_fail() -> dict:
    return {k: "fail" for k in NODES}


def http_empty() -> dict:
    return {k: parse_http(None) for k in NODES}


def parse_tcp(v) -> str:
    if not v or v == [None]:
        return "fail"
    item = v[0] if isinstance(v, list) else v
    if isinstance(item, dict) and "time" in item and "error" not in item:
        return "ok"
    return "fail"


def parse_http(v) -> dict:
    out = {"ok": False, "code": 0, "ip": "", "ms": None}
    if not v or v == [None]:
        return out
    item = v[0] if isinstance(v, list) else v
    if isinstance(item, list) and len(item) >= 4:
        try:
            out["ms"] = int(float(item[1]) * 1000)
        except Exception:
            pass
        try:
            out["code"] = int(item[3])
        except Exception:
            out["code"] = 0
        if len(item) > 4:
            out["ip"] = str(item[4] or "")
        out["ok"] = 200 <= out["code"] < 400
    return out


def ru_pack_tcp(last: dict) -> dict:
    return {k: parse_tcp(last.get(n)) for k, n in NODES.items()}


def ru_pack_http(last: dict) -> dict:
    return {k: parse_http(last.get(n)) for k, n in NODES.items()}


def load_nodes() -> list:
    try:
        with open(NODES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def node_for(origin: str, label: str = "") -> dict | None:
    nodes = load_nodes()
    if label:
        for node in nodes:
            if str(node.get("label") or "") == str(label):
                return node
    if origin:
        for node in nodes:
            if str(node.get("ip") or "") == origin:
                return node
    return None


def sub_url_for(origin: str, label: str = "") -> str:
    """Subscription path from the Hiddify admin API. SSH is not used."""
    node = node_for(origin, label)
    if not node:
        return ""
    try:
        return hiddify_api.subscription_path(node)
    except hiddify_api.HiddifyError:
        return ""
    except Exception:
        return ""


def ssh_ready() -> bool:
    return os.path.isfile(SSH_KEY)


def path_label(p: str) -> str:
    return PATH_RU.get(p, p)


def build_rows() -> list:
    fleet = load_fleet()
    rows = []
    for s in fleet.get("servers") or []:
        host = s.get("sub_host") or ""
        dns_ip = resolve_a(host) if host else ""
        rows.append({
            "label": s.get("label") or "",
            "origin": s.get("origin") or "",
            "relay": s.get("relay") or "",
            "rf_ips": list(s.get("rf_ips") or []),
            "sub_host": host,
            "dns_ip": dns_ip,
            "path": s.get("path") or "",
            "path_ru": path_label(s.get("path") or ""),
            "live": bool(dns_ip) and (dns_ip in (s.get("rf_ips") or []) or dns_ip == s.get("origin") or (s.get("path") == "hub" and dns_ip == HUB_IP)),
        })
    return rows


def map_payload() -> dict:
    fleet = load_fleet()
    return {
        "ok": True,
        "servers": build_rows(),
        "hub": fleet.get("hub"),
        "find": fleet.get("find"),
        "probe": probe_status(),
        "reboot": reboot_status(),
    }


def _log(msg: str) -> None:
    with _lock:
        _probe["log"].append({"t": int(time.time()), "msg": msg})
        _probe["log"] = _probe["log"][-80:]


def _rlog(msg: str) -> None:
    with _lock:
        _reboot["log"].append({"t": int(time.time()), "msg": msg})
        _reboot["log"] = _reboot["log"][-120:]


def run_probe_sync() -> dict:
    fleet = load_fleet()
    servers = fleet.get("servers") or []
    urls = {}
    url_err = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(sub_url_for, s.get("origin") or "", s.get("label") or ""): s for s in servers}
        for fut in as_completed(futs):
            s = futs[fut]
            try:
                path = fut.result()
            except Exception:
                path = ""
            if path and s.get("sub_host"):
                urls[s["label"]] = "https://%s%s" % (s["sub_host"], path)
            else:
                url_err[s["label"]] = "нет пути подписки"
    _log("подписок к проверке: %s" % len(urls))

    def wait_tcp_item(item):
        kind, lab, ip, rid = item
        if str(rid).startswith("ERR:"):
            return ip, {"lab": lab, "ip": ip, "error": rid[4:], **node_fail()}
        try:
            pack = ru_pack_tcp(ch_wait(rid))
            return ip, {"lab": lab, "ip": ip, **pack}
        except Exception as e:
            return ip, {"lab": lab, "ip": ip, "error": str(e)[:60], **node_fail()}

    def wait_ping_item(item):
        kind, lab, ip, rid = item
        if str(rid).startswith("ERR:"):
            return ip, {"lab": lab, "ip": ip, "error": rid[4:], **node_fail()}
        try:
            return ip, {"lab": lab, "ip": ip, **ru_pack_ping(ch_wait(rid))}
        except Exception as e:
            return ip, {"lab": lab, "ip": ip, "error": str(e)[:60], **node_fail()}

    def wait_http_item(item):
        lab, url, rid = item
        shown = redact_url(url)
        empty = {"url": shown, **http_empty()}
        if str(rid).startswith("ERR:"):
            empty["error"] = rid[4:]
            return lab, empty
        try:
            return lab, {"url": shown, **ru_pack_http(ch_wait(rid))}
        except Exception as e:
            empty["error"] = str(e)[:60]
            return lab, empty

    def start_ping(lab, ip):
        try:
            rid = ch_start("ping", ip)
            return ("ping", lab, ip, rid)
        except Exception as e:
            return ("ping", lab, ip, "ERR:" + str(e)[:60])

    def ping_batch(items):
        started = []
        for lab, ip in items:
            started.append(start_ping(lab, ip))
            time.sleep(0.4)
        out = {}
        if not started:
            return out
        with ThreadPoolExecutor(max_workers=3) as ex:
            for fut in as_completed([ex.submit(wait_ping_item, it) for it in started]):
                ip, val = fut.result()
                out[ip] = val
        return out

    def start_tcp(lab, ip):
        try:
            rid = ch_start("tcp", ip + ":443")
            return ("tcp", lab, ip, rid)
        except Exception as e:
            return ("tcp", lab, ip, "ERR:" + str(e)[:60])

    def start_http(lab, url):
        try:
            rid = ch_start("http", url)
            return (lab, url, rid)
        except Exception as e:
            return (lab, url, "ERR:" + str(e)[:60])

    def tcp_batch(items):
        started = []
        for lab, ip in items:
            started.append(start_tcp(lab, ip))
            time.sleep(0.35)
        out = {}
        if not started:
            return out
        with ThreadPoolExecutor(max_workers=4) as ex:
            for fut in as_completed([ex.submit(wait_tcp_item, it) for it in started]):
                ip, val = fut.result()
                out[ip] = val
        return out

    def http_batch(items):
        started = []
        for lab, url in items:
            started.append(start_http(lab, url))
            time.sleep(0.4)
        out = {}
        if not started:
            return out
        with ThreadPoolExecutor(max_workers=3) as ex:
            for fut in as_completed([ex.submit(wait_http_item, it) for it in started]):
                lab, val = fut.result()
                out[lab] = val
        return out

    seen = set()
    front, extras, origins = [], [], []

    def take(dst, lab, ip):
        if not ip or ip in seen:
            return
        seen.add(ip)
        dst.append((lab, ip))

    take(front, "hub", HUB_IP)
    take(front, "find", (fleet.get("find") or {}).get("ip") or "")
    for s in servers:
        take(front, "dns" + s["label"], resolve_a(s.get("sub_host") or ""))
    for s in servers:
        for i, ip in enumerate(s.get("rf_ips") or []):
            take(extras, "rf%s-%s" % (s["label"], i), ip)
    for s in servers:
        take(origins, "o" + s["label"], s.get("origin"))

    tcp_res = {}
    _log("TCP подписок: %s" % len(front))
    for i in range(0, len(front), 4):
        tcp_res.update(tcp_batch(front[i:i + 4]))
        if i + 4 < len(front):
            time.sleep(3.5)
    http_res = {}
    http_jobs = [(lab, urls[lab]) for lab in [s["label"] for s in servers] if lab in urls]
    _log("HTTPS подписок: %s" % len(http_jobs))
    for i in range(0, len(http_jobs), 3):
        http_res.update(http_batch(http_jobs[i:i + 3]))
        if i + 3 < len(http_jobs):
            time.sleep(4.0)
    if extras:
        _log("TCP запасных: %s" % len(extras))
        for i in range(0, len(extras), 4):
            tcp_res.update(tcp_batch(extras[i:i + 4]))
            if i + 4 < len(extras):
                time.sleep(3.5)
    if origins:
        _log("TCP Швеции: %s" % len(origins))
        for i in range(0, len(origins), 4):
            tcp_res.update(tcp_batch(origins[i:i + 4]))
            if i + 4 < len(origins):
                time.sleep(3.5)
    ping_jobs = []
    seen_ping = set()
    for s in servers:
        ip = resolve_a(s.get("sub_host") or "")
        if ip and ip not in seen_ping:
            seen_ping.add(ip)
            ping_jobs.append(("ping-" + ip, ip))
        oip = s.get("origin") or ""
        if oip and oip not in seen_ping:
            seen_ping.add(oip)
            ping_jobs.append(("ping-" + oip, oip))
    ping_res = {}
    _log("пинг: %s" % len(ping_jobs))
    for i in range(0, len(ping_jobs), 3):
        ping_res.update(ping_batch(ping_jobs[i:i + 3]))
        if i + 3 < len(ping_jobs):
            time.sleep(3.5)
    _log("проверка закончена")

    rows = []
    for s in servers:
        origin = s.get("origin") or ""
        dns_ip = resolve_a(s.get("sub_host") or "")
        extras = []
        for ip in s.get("rf_ips") or []:
            extras.append({"ip": ip, "used": ip == dns_ip, "ru": tcp_res.get(ip) or {}})
        rows.append({
            "label": s.get("label"),
            "origin": origin,
            "origin_ru": tcp_res.get(origin) or {},
            "origin_ping": ping_res.get(origin) or {},
            "ping": ping_res.get(dns_ip) or {},
            "relay": s.get("relay") or "",
            "rf_ips": extras,
            "sub_host": s.get("sub_host") or "",
            "dns_ip": dns_ip,
            "dns_ru": tcp_res.get(dns_ip) or {},
            "path": s.get("path"),
            "path_ru": path_label(s.get("path") or ""),
            "http": http_res.get(s.get("label") or "") or (
                {
                    "url": "",
                    "error": url_err.get(s.get("label") or ""),
                    **http_empty(),
                }
                if s.get("label") in url_err else None
            ),
        })
    return {
        "ok": True,
        "at": int(time.time()),
        "servers": rows,
        "hub": {"ip": HUB_IP, "ru": tcp_res.get(HUB_IP) or {}},
        "find": {"ip": (fleet.get("find") or {}).get("ip"), "ru": tcp_res.get((fleet.get("find") or {}).get("ip") or "") or {}},
    }


def _probe_thread():
    try:
        payload = run_probe_sync()
        with _lock:
            _probe["payload"] = payload
            _probe["error"] = None
            _probe["at"] = time.time()
            _probe["running"] = False
    except Exception as e:
        with _lock:
            _probe["error"] = str(e)[:160]
            _probe["running"] = False


def start_probe(force: bool = False) -> dict:
    with _lock:
        if _probe["running"]:
            return {"ok": True, "running": True, "error": None}
        now = time.time()
        if (not force) and _probe["payload"] and (now - _probe["at"]) < PROBE_MIN_SEC:
            return {"ok": True, "running": False, "cached": True, "error": None}
        _probe["running"] = True
        _probe["error"] = None
        _probe["log"] = [{"t": int(now), "msg": "проверка из РФ запущена"}]
    threading.Thread(target=_probe_thread, daemon=True).start()
    return {"ok": True, "running": True}


def probe_status() -> dict:
    with _lock:
        return {
            "running": _probe["running"],
            "at": int(_probe["at"] or 0),
            "payload": _probe["payload"],
            "error": _probe["error"],
            "log": list(_probe["log"]),
        }


def reboot_status() -> dict:
    with _lock:
        return {
            "running": _reboot["running"],
            "done": _reboot["done"],
            "scope": _reboot["scope"],
            "log": list(_reboot["log"]),
            "error": _reboot["error"],
            "ok": _reboot["ok"],
            "fail": _reboot["fail"],
        }


def wait_tcp(ip: str, seconds: int = 90) -> bool:
    t0 = time.time()
    while time.time() - t0 < seconds:
        if tcp_local(ip, 443, timeout=3.0):
            return True
        time.sleep(3)
    return False


def reboot_one(name: str, ip: str, jump: bool = False) -> bool:
    if not ssh_ready():
        _rlog("%s — SSH-ключ не задан" % name)
        return False
    _rlog("%s %s — reboot" % (name, ip))
    code, text = ssh_out(
        ip,
        "nohup bash -c 'sleep 1; systemctl reboot' >/dev/null 2>&1 & echo queued",
        timeout=15,
        jump=jump,
    )
    if code != 0 and "queued" not in text:
        _rlog("%s — ssh fail: %s" % (name, (text or "fail")[:80]))
        return False
    time.sleep(8)
    ok443 = wait_tcp(ip, 90)
    if ok443:
        _rlog("%s — 443 ok" % name)
        return True
    code2, text2 = ssh_out(ip, "echo up", timeout=12, jump=jump)
    ok = code2 == 0 and "up" in text2
    _rlog("%s — 443 нет, ssh %s" % (name, "ok" if ok else "нет"))
    return ok


def unique_relays(fleet: dict) -> list:
    seen = set()
    out = []
    for s in fleet.get("servers") or []:
        if s.get("ssh") is False:
            continue
        ip = s.get("rf_ssh") or ""
        if not ip or ip in seen:
            continue
        seen.add(ip)
        out.append({
            "name": "rf-%s" % s.get("label"),
            "ip": ip,
            "jump": bool(s.get("rf_jump")),
        })
    return out


def _reboot_thread(scope: str):
    fleet = load_fleet()
    ok = fail = 0
    try:
        targets = unique_relays(fleet)
        if scope == "all":
            seen = {t["ip"] for t in targets}
            for s in fleet.get("servers") or []:
                if s.get("ssh") is False:
                    continue
                origin = s.get("origin") or ""
                if origin and origin not in seen:
                    seen.add(origin)
                    targets.append({"name": "origin-%s" % s.get("label"), "ip": origin, "jump": False})
        if not targets:
            _rlog("SSH выключен или нет адресов — перезагружать нечего")
        _rlog("очередь %s, коробок %s (не find, не разом)" % (scope, len(targets)))
        for t in targets:
            good = reboot_one(t["name"], t["ip"], jump=bool(t.get("jump")))
            if good:
                ok += 1
            else:
                fail += 1
                _rlog("стоп на %s — дальше не иду" % t["name"])
                break
            time.sleep(4)
        with _lock:
            _reboot["ok"] = ok
            _reboot["fail"] = fail
            _reboot["running"] = False
            _reboot["done"] = True
            _reboot["error"] = None if fail == 0 else "есть ошибки"
        _rlog("готово ok=%s fail=%s" % (ok, fail))
    except Exception as e:
        with _lock:
            _reboot["error"] = str(e)[:160]
            _reboot["ok"] = ok
            _reboot["fail"] = fail + 1
            _reboot["running"] = False
            _reboot["done"] = True


def start_reboot(scope: str, confirm: str) -> dict:
    if confirm != "REBOOT":
        return {"ok": False, "error": "введи REBOOT"}
    if scope not in ("relays", "all"):
        return {"ok": False, "error": "scope relays|all"}
    if not ssh_ready():
        return {"ok": False, "error": "SSH-ключ не задан, перезагрузка выключена"}
    with _lock:
        if _reboot["running"]:
            return {"ok": False, "error": "уже идёт"}
        if _probe["running"]:
            return {"ok": False, "error": "сейчас идёт проверка"}
        _reboot["running"] = True
        _reboot["done"] = False
        _reboot["scope"] = scope
        _reboot["log"] = []
        _reboot["error"] = None
        _reboot["ok"] = 0
        _reboot["fail"] = 0
    threading.Thread(target=_reboot_thread, args=(scope,), daemon=True).start()
    return {"ok": True, "running": True, "scope": scope}
