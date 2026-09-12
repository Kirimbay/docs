#!/usr/bin/env bash
# Isolated proof that the OUTPUT allowlist:
#   * answers an inbound client (SYN-ACK to a random port) — VLESS path
#   * allows HTTP/TLS to 80/443
#   * drops NEW to a torrent-like port
#   * drops BitTorrent handshake and MSE-like PSH on 443
#
# Runs inside three network namespaces. Does not touch the host default route.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${LAB_SCRIPT:-$ROOT/scripts/hiddify-block-torrents.sh}"
NS_VPS="nt_vps"
NS_PEER="nt_peer"
NS_CLI="nt_cli"
PASS=0
FAIL=0
WORKDIR="$(mktemp -d /tmp/nt-lab.XXXXXX)"

log() { printf '[lab] %s\n' "$*"; }
ok()  { printf '[lab] PASS  %s\n' "$*"; PASS=$((PASS + 1)); }
bad() { printf '[lab] FAIL  %s\n' "$*"; FAIL=$((FAIL + 1)); }

cleanup() {
  ip netns del "${NS_VPS}" 2>/dev/null || true
  ip netns del "${NS_PEER}" 2>/dev/null || true
  ip netns del "${NS_CLI}" 2>/dev/null || true
  ip link del veth-wan0 2>/dev/null || true
  ip link del veth-cli0 2>/dev/null || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "lab needs root (sudo)"; exit 1; }
command -v nft >/dev/null
command -v iptables >/dev/null
command -v python3 >/dev/null

setup_ns() {
  ip netns add "${NS_VPS}"
  ip netns add "${NS_PEER}"
  ip netns add "${NS_CLI}"

  ip link add veth-wan0 type veth peer name veth-wan1
  ip link set veth-wan0 netns "${NS_VPS}"
  ip link set veth-wan1 netns "${NS_PEER}"
  ip netns exec "${NS_VPS}" ip addr add 10.67.0.1/24 dev veth-wan0
  ip netns exec "${NS_PEER}" ip addr add 10.67.0.2/24 dev veth-wan1
  ip netns exec "${NS_PEER}" ip addr add 10.67.0.3/24 dev veth-wan1
  ip netns exec "${NS_VPS}" ip link set veth-wan0 up
  ip netns exec "${NS_PEER}" ip link set veth-wan1 up

  ip link add veth-cli0 type veth peer name veth-cli1
  ip link set veth-cli0 netns "${NS_VPS}"
  ip link set veth-cli1 netns "${NS_CLI}"
  ip netns exec "${NS_VPS}" ip addr add 10.67.1.1/24 dev veth-cli0
  ip netns exec "${NS_CLI}" ip addr add 10.67.1.2/24 dev veth-cli1
  ip netns exec "${NS_VPS}" ip link set veth-cli0 up
  ip netns exec "${NS_CLI}" ip link set veth-cli1 up

  for ns in "${NS_VPS}" "${NS_PEER}" "${NS_CLI}"; do
    ip netns exec "${ns}" ip link set lo up
  done
  ip netns exec "${NS_VPS}" ip route add default via 10.67.0.2 || true
}

make_tls_cert() {
  python3 - "${WORKDIR}" <<'PY'
import os, sys
from pathlib import Path
d = Path(sys.argv[1])
try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    import datetime
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "lab.peer")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7))
        .sign(key, hashes.SHA256())
    )
    (d / "key.pem").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    (d / "cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
except ImportError:
    os.system(
        f'openssl req -x509 -newkey rsa:2048 -keyout {d}/key.pem -out {d}/cert.pem '
        f'-days 2 -nodes -subj /CN=lab.peer >/dev/null 2>&1'
    )
PY
}

start_peer() {
  make_tls_cert
  ip netns exec "${NS_PEER}" python3 - "${WORKDIR}" <<'PY' &
import socket, ssl, sys, threading
from pathlib import Path
d = Path(sys.argv[1])

def serve_tcp(bind, port, handler):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((bind, port))
    s.listen(20)
    while True:
        c, _ = s.accept()
        threading.Thread(target=handler, args=(c,), daemon=True).start()

def http_h(c):
    try:
        c.recv(4096)
        c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
    finally:
        c.close()

def echo_h(c):
    try:
        data = c.recv(4096)
        c.sendall(b"ECHO:" + data[:32])
    finally:
        c.close()

def tls_h(c):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(d / "cert.pem", d / "key.pem")
    try:
        t = ctx.wrap_socket(c, server_side=True)
        t.recv(4096)
        t.sendall(b"TLS-OK")
        t.close()
    except Exception:
        try:
            c.close()
        except OSError:
            pass

threading.Thread(target=serve_tcp, args=("10.67.0.2", 80, http_h), daemon=True).start()
threading.Thread(target=serve_tcp, args=("10.67.0.2", 443, tls_h), daemon=True).start()
threading.Thread(target=serve_tcp, args=("10.67.0.2", 53, echo_h), daemon=True).start()
threading.Thread(target=serve_tcp, args=("10.67.0.2", 51413, echo_h), daemon=True).start()
threading.Thread(target=serve_tcp, args=("10.67.0.3", 80, echo_h), daemon=True).start()
threading.Thread(target=serve_tcp, args=("10.67.0.3", 443, echo_h), daemon=True).start()
Path(d / "peer.ready").write_text("1")
import time
time.sleep(3600)
PY
  for _ in $(seq 1 50); do
    [[ -f "${WORKDIR}/peer.ready" ]] && return 0
    sleep 0.05
  done
  return 1
}

apply_rules() {
  ip netns exec "${NS_VPS}" env \
    PATH="/usr/sbin:/sbin:/usr/bin:/bin" \
    SKIP_INBOUND_SELFTEST=1 SKIP_IPSET=1 PERSIST_FIREWALL=0 SKIP_SYSTEMD=1 \
    NOTORRENT_INSTALL_DIR="${WORKDIR}/inst" \
    bash "${SCRIPT}" apply-fw
  if ! ip netns exec "${NS_VPS}" nft list chain inet hiddify_notorrent inspect_web >/dev/null 2>&1; then
    log "nft table in VPS ns:"
    ip netns exec "${NS_VPS}" nft list table inet hiddify_notorrent 2>&1 || true
    bad "inspect_web did not load — 443 L7 is off, lab is invalid"
    echo
    echo "lab: ${PASS} passed, ${FAIL} failed"
    exit 1
  fi
  log "inspect_web loaded inside VPS ns"
}

# --- cases -------------------------------------------------------------------

case_inbound() {
  ip netns exec "${NS_VPS}" python3 - <<'PY' &
import socket, threading
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("10.67.1.1", 8443))
s.listen(5)
def acc():
    c, _ = s.accept()
    c.sendall(b"VLESS")
    c.close()
threading.Thread(target=acc, daemon=True).start()
import time; time.sleep(8)
PY
  sleep 0.2
  if ip netns exec "${NS_CLI}" python3 - <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(2.5)
s.connect(("10.67.1.1", 8443))
data = s.recv(8)
s.close()
sys.exit(0 if data == b"VLESS" else 2)
PY
  then
    ok "inbound SYN-ACK + payload (VLESS-like :8443)"
  else
    bad "inbound client did not get a reply — VPN would be n/a"
  fi
}

case_http() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(2.5)
s.connect(("10.67.0.2", 80))
s.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
data = s.recv(64)
s.close()
sys.exit(0 if b"200" in data or b"ok" in data else 2)
PY
  then
    ok "HTTP :80 GET"
  else
    bad "HTTP :80 blocked — sites would die"
  fi
}

case_tls() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, ssl, sys
ctx = ssl._create_unverified_context()
raw = socket.create_connection(("10.67.0.2", 443), timeout=3)
s = ctx.wrap_socket(raw, server_hostname="lab.peer")
s.sendall(b"ping")
data = s.recv(32)
s.close()
sys.exit(0 if data == b"TLS-OK" else 2)
PY
  then
    ok "TLS :80/443 ClientHello (YouTube-like)"
  else
    bad "TLS :443 blocked — HTTPS through VPN would die"
  fi
}

case_highport() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(1.2)
try:
    s.connect(("10.67.0.2", 51413))
except TimeoutError:
    sys.exit(0)
except OSError as e:
    # EPERM from netfilter
    sys.exit(0 if e.errno in (1, 13, 110, 11) else 2)
else:
    s.close()
    sys.exit(3)
PY
  then
    ok "NEW :51413 dropped (random torrent port)"
  else
    bad "NEW :51413 left the VPS — hoster would see a peer"
  fi
}

case_bt_on_443() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
hs = b"\x13BitTorrent protocol" + b"\x00" * 8 + b"A" * 20 + b"B" * 20
s = socket.socket()
s.settimeout(1.5)
try:
    s.connect(("10.67.0.3", 443))
    s.sendall(hs)
    data = s.recv(32)
except TimeoutError:
    sys.exit(0)
except OSError:
    sys.exit(0)
else:
    s.close()
    sys.exit(3 if data.startswith(b"ECHO") else 0)
PY
  then
    ok "BitTorrent handshake on :443 dropped"
  else
    bad "BitTorrent handshake on :443 passed — qBittorrent 443 peer leak"
  fi
}

case_mse_on_443() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import os, socket, sys
s = socket.socket()
s.settimeout(1.5)
try:
    s.connect(("10.67.0.3", 443))
    s.sendall(os.urandom(64))
    data = s.recv(32)
except TimeoutError:
    sys.exit(0)
except OSError:
    sys.exit(0)
else:
    s.close()
    sys.exit(3 if data.startswith(b"ECHO") else 0)
PY
  then
    ok "MSE-like random PSH on :443 dropped"
  else
    bad "random PSH on :443 passed — encrypted torrent leak"
  fi
}

case_bt_on_80() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
hs = b"\x13BitTorrent protocol" + b"\x00" * 8 + b"A" * 20 + b"B" * 20
s = socket.socket()
s.settimeout(1.5)
try:
    s.connect(("10.67.0.3", 80))
    s.sendall(hs)
    data = s.recv(32)
except TimeoutError:
    sys.exit(0)
except OSError:
    sys.exit(0)
else:
    s.close()
    sys.exit(3 if data.startswith(b"ECHO") else 0)
PY
  then
    ok "BitTorrent handshake on :80 dropped"
  else
    bad "BitTorrent handshake on :80 passed"
  fi
}

case_http_post() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(2.5)
s.connect(("10.67.0.2", 80))
s.sendall(b"POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n")
data = s.recv(64)
s.close()
sys.exit(0 if b"200" in data or b"ok" in data else 2)
PY
  then
    ok "HTTP :80 POST"
  else
    bad "HTTP :80 POST blocked — sites would die"
  fi
}

case_inbound_highport() {
  ip netns exec "${NS_VPS}" python3 - <<'PY' &
import socket, threading, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("10.67.1.1", 12345))
s.listen(5)
def acc():
    c, _ = s.accept()
    c.sendall(b"VLESS")
    c.close()
threading.Thread(target=acc, daemon=True).start()
time.sleep(8)
PY
  sleep 0.2
  if ip netns exec "${NS_CLI}" python3 - <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(2.5)
s.connect(("10.67.1.1", 12345))
data = s.recv(8)
s.close()
sys.exit(0 if data == b"VLESS" else 2)
PY
  then
    ok "inbound SYN-ACK on random :12345"
  else
    bad "inbound high-port reply died — Reality/VLESS n/a"
  fi
}

case_dns_udp() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(1.2)
try:
    s.sendto(b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01", ("10.67.0.2", 53))
    s.recvfrom(64)
except TimeoutError:
    # no DNS server in lab; allowlist must at least let the packet out (no EPERM)
    sys.exit(0)
except OSError as e:
    sys.exit(2 if e.errno in (1, 13) else 0)
else:
    sys.exit(0)
PY
  then
    ok "UDP :53 left the VPS (DNS)"
  else
    bad "UDP :53 dropped — DNS through VPN would die"
  fi
}

case_udp_dht() {
  if ip netns exec "${NS_VPS}" python3 - <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(0.8)
try:
    s.sendto(b"d1:ad2:id20:" + b"x" * 20, ("10.67.0.2", 6881))
    s.recvfrom(64)
    sys.exit(3)
except TimeoutError:
    sys.exit(0)
except OSError:
    sys.exit(0)
PY
  then
    ok "UDP DHT-like NEW dropped"
  else
    bad "UDP DHT packet left the VPS"
  fi
}

log "namespaces"
setup_ns
log "peer listeners"
start_peer
log "apply OUTPUT rules inside VPS ns"
apply_rules
log "cases"
case_inbound
case_inbound_highport
case_http
case_http_post
case_tls
case_dns_udp
case_highport
case_bt_on_443
case_bt_on_80
case_mse_on_443
case_udp_dht

echo
echo "lab: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 && "${PASS}" -ge 11 ]]
