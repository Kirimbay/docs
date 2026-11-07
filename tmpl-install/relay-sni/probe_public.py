#!/usr/bin/env python3
"""Read-only public checks for the six-exit SNI relay.

Connects only to public names already delegated to the relay and to the
hardcoded exit addresses. Does not read subscription URLs, UUIDs, or keys.
A passing run is not evidence that a client network can complete Reality.

Exit status:
  0  public checks passed and the TCP handshake was not answered locally
  2  public checks passed, but TCP SYN was local while ICMP was remote
  1  a public check failed
"""

from __future__ import annotations

import hashlib
import socket
import ssl
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

RELAY = "130.78.25.124"
BACKENDS = {
    "12": "136.148.216.221",
    "15": "136.148.216.46",
    "36": "136.148.220.250",
    "51": "136.148.220.248",
    "57": "136.148.216.157",
    "60": "136.148.216.164",
}
NAMES = []
for _n in ("12", "15", "36", "51", "57", "60"):
    NAMES.append((f"x{_n}.kirz.co.uk", _n))
    NAMES.append((f"{_n}.kirvpn.ru", _n))
    NAMES.append((f"{_n}.kirvpn.us", _n))
NAMES.append(("60.sarafan.uk", "60"))
UNTOUCHED = {
    "58.sarafan.uk": "136.148.223.200",
    "61.sarafan.uk": "136.148.223.9",
    "70.sarafan.uk": "187.7.206.103",
}
REJECT_SNI = ("not-listed.example", "58.sarafan.uk")


def dig(name: str, rr: str) -> list[str]:
    p = subprocess.run(
        ["dig", "+time=2", "+tries=1", "+short", rr, name],
        capture_output=True, text=True, check=False,
    )
    return [ln.strip().rstrip(".") for ln in p.stdout.splitlines() if ln.strip()]


def icmp_rtt_ms(ip: str) -> float | None:
    p = subprocess.run(
        ["ping", "-c", "1", "-W", "2", "-s", "56", ip],
        capture_output=True, text=True, check=False,
    )
    marker = "time="
    i = p.stdout.find(marker)
    if i < 0:
        return None
    num = p.stdout[i + len(marker):].split()[0]
    try:
        return float(num)
    except ValueError:
        return None


def tcp_connect_ms(ip: str, port: int = 443) -> float:
    t = time.perf_counter()
    with socket.create_connection((ip, port), 8):
        return (time.perf_counter() - t) * 1000


def http_get(host: str, ip: str, path: str = "/", port: int = 443, tls: bool = True) -> tuple[int, bytes, str]:
    raw = socket.create_connection((ip, port), 12)
    raw.settimeout(12)
    try:
        sock = raw
        if tls:
            ctx = ssl.create_default_context()
            sock = ctx.wrap_socket(raw, server_hostname=host)
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: relay-sni-probe\r\n"
            f"Accept: */*\r\nConnection: close\r\n\r\n"
        )
        sock.sendall(req.encode())
        data = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
            if len(data) > 2_000_000:
                break
    finally:
        try:
            sock.close()
        except Exception:
            raw.close()
    head, _, body = data.partition(b"\r\n\r\n")
    line = head.split(b"\r\n", 1)[0].decode("latin1", "replace")
    parts = line.split()
    code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    return code, body, line


def cert_cn(host: str, ip: str) -> str:
    ctx = ssl.create_default_context()
    with socket.create_connection((ip, 443), 12) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as ss:
            cert = ss.getpeercert()
    for rdn in cert.get("subject", ()):
        for k, v in rdn:
            if k == "commonName":
                return v
    return ""


def handshake_rejected(host: str, ip: str) -> tuple[bool, str]:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((ip, 443), 8) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as ss:
                der = ss.getpeercert(binary_form=True) or b""
                return False, f"handshake succeeded bytes={len(der)}"
    except (ssl.SSLError, socket.timeout, ConnectionError, OSError) as e:
        return True, type(e).__name__


def main() -> int:
    fails: list[str] = []
    print("== dns ==")
    for host, _n in NAMES:
        a = [x for x in dig(host, "A") if x[:1].isdigit()]
        aaaa = dig(host, "AAAA")
        ok = a == [RELAY] and not aaaa
        print(f"{'OK' if ok else 'FAIL'} {host} A={a or '-'} AAAA={aaaa or '-'}")
        if not ok:
            fails.append(f"dns {host}")
    for host, ip in UNTOUCHED.items():
        a = [x for x in dig(host, "A") if x[:1].isdigit()]
        ok = a == [ip]
        print(f"{'OK' if ok else 'FAIL'} untouched {host} A={a or '-'}")
        if not ok:
            fails.append(f"untouched dns {host}")

    icmp = icmp_rtt_ms(RELAY)
    try:
        tcp = tcp_connect_ms(RELAY)
    except OSError as e:
        tcp = None
        fails.append(f"tcp connect {e}")
    local_proxy = icmp is not None and tcp is not None and tcp < 20 and icmp > 50
    print(
        f"== path == icmp_rtt_ms={icmp} tcp_connect_ms={None if tcp is None else round(tcp, 2)} "
        f"local_syn_proxy={local_proxy}"
    )
    if local_proxy:
        print("NOTE TCP SYN is answered locally. Do not read partial-hello or MSS timings from this host.")

    print("== relay https ==")

    def one(item: tuple[str, str]) -> tuple[str, str]:
        host, _n = item
        try:
            cn = cert_cn(host, RELAY)
            code, body, _line = http_get(host, RELAY, "/")
            sha = hashlib.sha256(body).hexdigest()[:12]
            ok = code == 200 and cn == host and len(body) > 0
            return host, f"{'OK' if ok else 'FAIL'} cn={cn} code={code} bytes={len(body)} sha={sha}"
        except Exception as e:
            return host, f"FAIL {type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one, item) for item in NAMES]
        for fut in as_completed(futs):
            host, line = fut.result()
            print(f"{host} {line}")
            if line.startswith("FAIL"):
                fails.append(f"https {host}")

    print("== relay body equals direct exit ==")
    for n, ip in BACKENDS.items():
        host = f"{n}.kirvpn.ru"
        try:
            c1, b1, _ = http_get(host, RELAY, "/")
            c2, b2, _ = http_get(host, ip, "/")
            same = b1 == b2 and c1 == 200 and c2 == 200
            print(f"{'OK' if same else 'FAIL'} {host} relay={c1}/{len(b1)} direct={c2}/{len(b2)}")
            if not same:
                fails.append(f"body {host}")
        except Exception as e:
            print(f"FAIL {host} {type(e).__name__}: {e}")
            fails.append(f"body {host}")

    print("== unknown sni rejected by relay ==")
    for host in REJECT_SNI:
        rejected, detail = handshake_rejected(host, RELAY)
        print(f"{'OK' if rejected else 'FAIL'} sni={host} {detail}")
        if not rejected:
            fails.append(f"unknown sni {host}")

    print("== port 80 ==")
    checks80 = [
        ("15.kirvpn.ru", "/.well-known/acme-challenge/relay-diagnostic", 404),
        ("not-listed.example", "/", 403),
    ]
    for host, path, expect in checks80:
        try:
            code, _body, line = http_get(host, RELAY, path, port=80, tls=False)
            ok = code == expect
            print(f"{'OK' if ok else 'FAIL'} http://{host}{path} {line}")
            if not ok:
                fails.append(f"port80 {host}{path}")
        except Exception as e:
            print(f"FAIL http://{host}{path} {type(e).__name__}: {e}")
            fails.append(f"port80 {host}{path}")

    print(f"== result fails={len(fails)} ==")
    if fails:
        for f in fails:
            print(" -", f)
        return 1
    return 2 if local_proxy else 0


if __name__ == "__main__":
    sys.exit(main())
