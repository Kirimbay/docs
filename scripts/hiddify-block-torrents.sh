#!/usr/bin/env bash
# Hiddify: block BitTorrent for VPN users, keep the rest of the proxy working.
#
# One-shot (as root, on the Hiddify server):
#   curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/main/scripts/hiddify-block-torrents.sh | bash
#
# Later:
#   hiddify-block-torrents status
#   hiddify-block-torrents uninstall
#
# Why the hoster's iptables snippet is not enough:
#   * modern torrent clients use random ports, not 6881-6889
#   * Hiddify is a proxy: user traffic leaves via OUTPUT (xray/sing-box),
#     not FORWARD, so FORWARD-only rules never see it
#   * Hysteria2/TUIC/SSH go through sing-box, where the BT rule is commented out
set -euo pipefail

VERSION="1.1.0"
INSTALL_DIR="${NOTORRENT_INSTALL_DIR:-/opt/hiddify-notorrent}"
SELF_PATH="${INSTALL_DIR}/hiddify-block-torrents.sh"
MARKER_BEGIN="HIDDIFY_NOTORRENT_BEGIN"
MARKER_END="HIDDIFY_NOTORRENT_END"

CMD="${1:-install}"

log()  { printf '[hiddify-notorrent] %s\n' "$*"; }
warn() { printf '[hiddify-notorrent] WARN: %s\n' "$*" >&2; }
die()  { printf '[hiddify-notorrent] ERROR: %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ "${SKIP_ROOT:-0}" == "1" ]] && return 0
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root (sudo)."
}

detect_hiddify() {
  if [[ -n "${HIDDIFY_DIR:-}" && -d "${HIDDIFY_DIR}" ]]; then
    return 0
  fi
  local d
  for d in /opt/hiddify-manager /opt/hiddify-config; do
    if [[ -d "${d}/xray/configs" || -d "${d}/singbox/configs" ]]; then
      HIDDIFY_DIR="${d}"
      return 0
    fi
  done
  die "Hiddify Manager not found in /opt/hiddify-manager or /opt/hiddify-config"
}

save_self() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  mkdir -p "${INSTALL_DIR}/backups"
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "${src}" && -r "${src}" && "${src}" != "bash" ]]; then
    cat "${src}" > "${SELF_PATH}.tmp"
    mv -f "${SELF_PATH}.tmp" "${SELF_PATH}"
    chmod 755 "${SELF_PATH}"
    ln -sfn "${SELF_PATH}" /usr/local/sbin/hiddify-block-torrents
    [[ -s "${SELF_PATH}" ]] || die "Failed to install ${SELF_PATH}"
    return 0
  fi
  die "Could not copy installer onto disk (${src:-empty}). Save the script to a file and run: sudo bash hiddify-block-torrents.sh"
}

# Public trackers + DHT bootstraps. Domain suffix match (subdomains included).
# Intentionally NOT torrent index websites (thepiratebay, 1337x, ...) — only P2P infra.
TRACKER_DOMAINS=(
  opentrackr.org open.stealth.si open.demonii.com explodie.org
  exodus.desync.com tracker.torrent.eu.org tracker.dler.org tracker.dler.com
  tracker.filemail.com tracker.qu.ax tracker.opentrackr.org tracker.bt4g.com
  tracker.moeking.me tracker.tiny-vps.com tracker.srv00.com tracker.dump.cl
  tracker.gbitt.info tracker-udp.gbitt.info tracker.ololosh.space
  tracker.bittor.pw tracker.internetwarriors.net tracker.coppersurfer.tk
  tracker.openbittorrent.com tracker.leechers-paradise.org
  tracker.cyberia.is tracker.ds.is tracker.iamhansen.xyz tracker.loligirl.cn
  tracker.moeking.me tracker.monitorit4.me tracker.nexa.v6.rocks
  tracker.skyts.net tracker.tfile.co tracker.tfile.me tracker.trackerfix.com
  tracker.zer0day.to tracker.zemoj.com tracker.uw0.xyz tracker.v6speed.org
  publictracker.xyz p4p.arenabg.com open.acgtracker.com open.dstud.io
  open.trackerlist.xyz opentracker.io retracker.lanta.me
  wikilenko.com demo.starcast.org bt.t-ru.org
  router.bittorrent.com dht.transmissionbt.com router.utorrent.com
  dht.libtorrent.org dht.aelitis.com bootstrap.ring.nctu.edu.tw
  bittorrent-tracker.e-n-c-r-y-p-t.net ipv4announce.sktorrent.eu
  tracker.auctor.tv tracker.yemekyedim.com tracker.zhuqiy.com
  t.overflow.biz zer0day.ch concen.org seeders-paradise.org
  tracker1.bt.moack.co.kr tracker1.itzmx.com tracker2.itzmx.com
  tracker3.itzmx.com tracker4.itzmx.com open.stealth.si
  packetsoverdtls.com tracker.breizh.bar tracker.tamersunion.org
  tracker.bitsearch.to tracker.foreverpirates.co tracker.ghostchu-services.top
  sparkle.ghostchu-services.top bt.ktrackers.com bt.poletracker.org
  tracker.renfei.net tracker.lilithraws.org tracker.ipfsscan.io
)

python_patch() {
  python3 - "$@" <<'PY'
import os, re, sys
from pathlib import Path

MARKER_BEGIN = "HIDDIFY_NOTORRENT_BEGIN"
MARKER_END = "HIDDIFY_NOTORRENT_END"
domains = [d.strip() for d in os.environ.get("NOTORRENT_DOMAINS", "").split(",") if d.strip()]
# de-dupe, keep order
seen = set()
uniq = []
for d in domains:
    if d not in seen:
        seen.add(d)
        uniq.append(d)
domains = uniq

def xray_block():
    listed = ",\n                ".join(f'"domain:{d}"' for d in domains)
    return f'''            {{ // {MARKER_BEGIN}
              "type": "field",
              "outboundTag": "blackhole",
              "protocol": ["bittorrent"]
            }},
            {{
              "type": "field",
              "network": "tcp,udp",
              "port": "6881-6889,6969,51413,6771,1337,2710,8999,7881",
              "outboundTag": "blackhole"
            }},
            {{
              "type": "field",
              "outboundTag": "blackhole",
              "domain": [
                {listed}
              ]
            }},
            // {MARKER_END}
'''

def singbox_block():
    listed = ",\n                ".join(f'"{d}"' for d in domains)
    return f'''            // {MARKER_BEGIN}
            {{
              "protocol": "bittorrent",
              "action": "reject",
              "method": "default"
            }},
            {{
              "port": "6881:6889",
              "action": "reject",
              "method": "default"
            }},
            {{
              "port": [1337, 2710, 6771, 6969, 7881, 8999, 51413],
              "action": "reject",
              "method": "default"
            }},
            {{
              "domain_suffix": [
                {listed}
              ],
              "action": "reject",
              "method": "default"
            }},
            // {MARKER_END}
'''

def upsert(text, block):
    lines = text.splitlines(keepends=True)
    start = end = None
    for i, line in enumerate(lines):
        if MARKER_BEGIN in line and start is None:
            start = i
        if MARKER_END in line and start is not None:
            end = i
            break
    if start is None or end is None:
        return text, False, "missing"
    blk = block if block.endswith("\n") else block + "\n"
    new = "".join(lines[:start]) + blk + "".join(lines[end + 1 :])
    return new, new != text, "replaced"

def insert_xray(text, block):
    text, changed, how = upsert(text, block)
    if how != "missing":
        return text, changed, how
    # Official Hiddify already has a BT protocol rule. Keep it; add ours before catch-all.
    m = re.search(
        r"\n(?=[ \t]*\{[ \t\n/]*\"type\":[ \t]*\"field\",[ \t\n]*\"port\":[ \t]*\"0-65535\")",
        text,
    )
    if not m:
        m = re.search(r"\n(?=[ \t]*\{[^\n]*\"port\":[ \t]*\"0-65535\")", text)
    if not m:
        raise SystemExit("xray routing: cannot find insertion point (port 0-65535)")
    return text[:m.start()] + "\n" + block + text[m.start():], True, "inserted"

def insert_singbox(text, block):
    text, changed, how = upsert(text, block)
    if how != "missing":
        return text, changed, how
    # Drop the commented-out official stub so we don't leave broken Xray syntax in sing-box.
    text = re.sub(
        r"[ \t]*//\s*\{//\s*Block BitTorrent protocol[\s\S]*?//\s*\},?\n?",
        "",
        text,
        count=1,
    )
    anchor = re.search(
        r"(\{[ \t\n]*\"action\":[ \t]*\"reject\",[ \t]*\"ip_is_private\":[ \t]*true[ \t\n]*\})",
        text,
    )
    if not anchor:
        raise SystemExit("sing-box routing: cannot find ip_is_private reject rule")
    insert_at = anchor.end()
    comma = "" if text[insert_at:insert_at + 8].lstrip().startswith(",") else ","
    return text[:insert_at] + comma + "\n" + block + text[insert_at:], True, "inserted"

def patch_file(path, kind):
    p = Path(path)
    if not p.is_file():
        print(f"skip (missing): {p}", file=sys.stderr)
        return False
    original = p.read_text(encoding="utf-8", errors="replace")
    block = xray_block() if kind == "xray" else singbox_block()
    if kind == "xray":
        new, changed, how = insert_xray(original, block)
    else:
        new, changed, how = insert_singbox(original, block)
    if not changed:
        print(f"ok (unchanged, {how}): {p}")
        return False
    bak = Path(os.environ.get("NOTORRENT_BACKUP_DIR", "/tmp")) / (p.name + ".bak")
    if not bak.exists():
        bak.write_text(original, encoding="utf-8")
    p.write_text(new, encoding="utf-8")
    print(f"patched ({how}): {p}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: patch_routing.py xray|singbox FILE [FILE...]")
    kind = sys.argv[1]
    any_changed = False
    for f in sys.argv[2:]:
        any_changed = patch_file(f, kind) or any_changed
    sys.exit(0 if not os.environ.get("NOTORRENT_REQUIRE_CHANGE") else (0 if any_changed else 3))
PY
}

backup_file() {
  local src="$1"
  [[ -f "${src}" ]] || return 0
  local dest="${INSTALL_DIR}/backups/$(echo "${src}" | tr '/' '_').orig"
  if [[ ! -f "${dest}" ]]; then
    cp -a "${src}" "${dest}"
  fi
}

patch_hiddify_routing() {
  detect_hiddify
  mkdir -p "${INSTALL_DIR}/backups"
  export NOTORRENT_DOMAINS
  NOTORRENT_DOMAINS="$(IFS=','; echo "${TRACKER_DOMAINS[*]}")"
  export NOTORRENT_BACKUP_DIR="${INSTALL_DIR}/backups"

  local changed=0
  local f
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch xray "${f}" && changed=1
    fi
  done
  for f in \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch singbox "${f}" && changed=1
    fi
  done
  return 0
}

configs_need_restart() {
  detect_hiddify
  local f
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2"
  do
    [[ -f "${f}" ]] || continue
    grep -q "${MARKER_BEGIN}" "${f}" || return 0
  done
  return 1
}

restart_proxy_cores() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  local svc
  for svc in hiddify-xray hiddify-singbox; do
    if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1; then
      if systemctl is-enabled "${svc}.service" >/dev/null 2>&1 || systemctl is-active "${svc}.service" >/dev/null 2>&1; then
        log "Restarting ${svc}..."
        systemctl restart "${svc}.service" || warn "Failed to restart ${svc}"
      fi
    fi
  done
}

# --- firewall -----------------------------------------------------------------

has_ipt() { command -v "$1" >/dev/null 2>&1; }

ensure_xt_string() {
  modprobe xt_string >/dev/null 2>&1 || true
  modprobe xt_multiport >/dev/null 2>&1 || true
  modprobe xt_set >/dev/null 2>&1 || true
}

ensure_ipset() {
  if ! command -v ipset >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ipset >/dev/null || true
    fi
  fi
  command -v ipset >/dev/null 2>&1 || return 1
  ipset create notorrent-trackers hash:net family inet hashsize 1024 maxelem 65536 -exist
  ipset create notorrent-trackers6 hash:net family inet6 hashsize 1024 maxelem 65536 -exist
}

refresh_tracker_ipset() {
  ensure_ipset || { warn "ipset not available, skipping tracker IP block"; return 0; }
  local stamp="${INSTALL_DIR}/ipset.stamp"
  if [[ -f "${stamp}" ]] && [[ $(( $(date +%s) - $(stat -c %Y "${stamp}" 2>/dev/null || echo 0) )) -lt 21600 ]]; then
    # still refresh if empty
    local n
    n="$(ipset list notorrent-trackers 2>/dev/null | awk '/Number of entries/{print $4}')"
    if [[ "${n:-0}" -gt 0 ]]; then
      return 0
    fi
  fi
  log "Resolving tracker / DHT hostnames into ipset..."
  local d ip
  for d in "${TRACKER_DOMAINS[@]}"; do
    while read -r ip; do
      [[ -z "${ip}" ]] && continue
      if [[ "${ip}" == *:* ]]; then
        ipset add notorrent-trackers6 "${ip}" -exist 2>/dev/null || true
      else
        ipset add notorrent-trackers "${ip}" -exist 2>/dev/null || true
      fi
    done < <(getent ahosts "${d}" 2>/dev/null | awk '{print $1}' | sort -u || true)
  done
  date > "${stamp}"
}

apply_nft_ports() {
  command -v nft >/dev/null 2>&1 || return 0
  nft delete table inet hiddify_notorrent >/dev/null 2>&1 || true
  nft -f - <<'NFT' || warn "nftables table not applied"
table inet hiddify_notorrent {
  chain out {
    type filter hook output priority -150; policy accept;
    oifname "lo" accept
    tcp dport { 6881-6889, 6969, 51413 } drop
    udp dport { 6881-6889, 6969, 51413, 6771 } drop
  }
  chain fwd {
    type filter hook forward priority -150; policy accept;
    tcp dport { 6881-6889, 6969, 51413 } drop
    udp dport { 6881-6889, 6969, 51413, 6771 } drop
  }
}
NFT
}

fill_ipt_chain() {
  local ipt="$1"
  $ipt -N HIDDIFY_NOTORRENT >/dev/null 2>&1 || true
  $ipt -F HIDDIFY_NOTORRENT

  # Jump at the top so Hiddify INPUT rules stay intact.
  if ! $ipt -C OUTPUT  -j HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    $ipt -I OUTPUT  1 -j HIDDIFY_NOTORRENT
  fi
  if ! $ipt -C FORWARD -j HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    $ipt -I FORWARD 1 -j HIDDIFY_NOTORRENT
  fi

  # Classic ports (what the hoster suggested) — not sufficient alone, but cheap.
  $ipt -A HIDDIFY_NOTORRENT -p tcp -m multiport --dports 6881:6889,6969,51413 -j DROP || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m multiport --dports 6881:6889,6969,51413,6771 -j DROP || true

  if $ipt -m set -h >/dev/null 2>&1; then
    if [[ "${ipt}" == *6* ]]; then
      $ipt -A HIDDIFY_NOTORRENT -m set --match-set notorrent-trackers6 dst -j DROP 2>/dev/null || true
    else
      $ipt -A HIDDIFY_NOTORRENT -m set --match-set notorrent-trackers dst -j DROP 2>/dev/null || true
    fi
  fi

  # Layer-7 signatures. Do NOT match generic words like "torrent" / "announce"
  # — those break ordinary websites.
  # BitTorrent handshake: 0x13 + "BitTorrent protocol"
  if $ipt -A HIDDIFY_NOTORRENT -m string --algo bm --from 0 --to 2048 \
        --hex-string '|13426974546f7272656e742070726f746f636f6c|' -j DROP 2>/dev/null; then
    :
  else
    warn "${ipt}: xt_string hex match not available"
  fi
  $ipt -A HIDDIFY_NOTORRENT -m string --algo bm --from 0 --to 2048 --string 'BitTorrent protocol' -j DROP 2>/dev/null || true
  # DHT / uTP peer discovery (bencoded)
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string 'd1:ad2:id20:' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '1:rd2:id20:' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '9:get_peers' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '13:announce_peer' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '9:find_node' -j DROP 2>/dev/null || true
  # HTTP tracker announce (both keys together → low false-positive rate)
  $ipt -A HIDDIFY_NOTORRENT -p tcp -m string --algo bm --from 0 --to 2048 --string 'info_hash=' \
        -m string --algo bm --from 0 --to 2048 --string 'peer_id=' -j DROP 2>/dev/null || true
}

apply_firewall() {
  [[ "${SKIP_FIREWALL:-0}" == "1" ]] && return 0
  ensure_xt_string
  apply_nft_ports
  refresh_tracker_ipset
  if has_ipt iptables; then
    fill_ipt_chain iptables
  fi
  if has_ipt ip6tables; then
    fill_ipt_chain ip6tables
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
  elif command -v iptables-save >/dev/null 2>&1; then
    mkdir -p /etc/iptables
    iptables-save  > /etc/iptables/rules.v4 2>/dev/null || true
    ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true
  fi
}

remove_firewall() {
  if command -v nft >/dev/null 2>&1; then
    nft delete table inet hiddify_notorrent 2>/dev/null || true
  fi
  local ipt
  for ipt in iptables ip6tables; do
    has_ipt "${ipt}" || continue
    $ipt -D OUTPUT  -j HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -D FORWARD -j HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -F HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -X HIDDIFY_NOTORRENT 2>/dev/null || true
  done
  if command -v ipset >/dev/null 2>&1; then
    ipset destroy notorrent-trackers  2>/dev/null || true
    ipset destroy notorrent-trackers6 2>/dev/null || true
  fi
}

# --- systemd ------------------------------------------------------------------

install_systemd() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  cat > /etc/systemd/system/hiddify-notorrent.service <<EOF
[Unit]
Description=Re-apply Hiddify BitTorrent block
After=network-online.target

[Service]
Type=oneshot
ExecStart=${SELF_PATH} apply
Nice=10

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/hiddify-notorrent.timer <<'EOF'
[Unit]
Description=Re-apply Hiddify BitTorrent block every 2 minutes

[Timer]
OnBootSec=20s
OnUnitActiveSec=120s
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

  detect_hiddify
  cat > /etc/systemd/system/hiddify-notorrent.path <<EOF
[Unit]
Description=Watch Hiddify routing configs and re-block torrents after apply

[Path]
PathChanged=${HIDDIFY_DIR}/xray/configs/03_routing.json
PathChanged=${HIDDIFY_DIR}/xray/configs/03_routing.json.j2
PathChanged=${HIDDIFY_DIR}/singbox/configs/03_routing.json
PathChanged=${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2
Unit=hiddify-notorrent.service

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now hiddify-notorrent.service hiddify-notorrent.timer hiddify-notorrent.path
}

uninstall_systemd() {
  systemctl disable --now hiddify-notorrent.timer hiddify-notorrent.path hiddify-notorrent.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/hiddify-notorrent.service \
        /etc/systemd/system/hiddify-notorrent.timer \
        /etc/systemd/system/hiddify-notorrent.path
  systemctl daemon-reload 2>/dev/null || true
}

restore_backups() {
  detect_hiddify || true
  local pair dest src
  for pair in \
      "xray/configs/03_routing.json.j2" \
      "xray/configs/03_routing.json" \
      "singbox/configs/03_routing.json.j2" \
      "singbox/configs/03_routing.json"
  do
    src="${INSTALL_DIR}/backups/$(echo "${HIDDIFY_DIR}/${pair}" | tr '/' '_').orig"
    dest="${HIDDIFY_DIR}/${pair}"
    if [[ -f "${src}" && -n "${HIDDIFY_DIR:-}" ]]; then
      cp -a "${src}" "${dest}"
      log "Restored ${dest}"
    fi
  done
}

# --- commands -----------------------------------------------------------------

cmd_apply() {
  need_root
  detect_hiddify
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  mkdir -p "${INSTALL_DIR}/backups"

  local need_restart=0
  if configs_need_restart; then
    need_restart=1
  fi
  patch_hiddify_routing
  if configs_need_restart; then
    # still missing marker on some file — patch failed
    warn "Some routing files still lack the torrent block. Check the log above."
  fi
  apply_firewall
  if [[ "${need_restart}" -eq 1 ]]; then
    restart_proxy_cores
  fi
}

cmd_install() {
  need_root
  detect_hiddify
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  log "Hiddify found at ${HIDDIFY_DIR}"
  save_self
  patch_hiddify_routing
  apply_firewall
  install_systemd
  restart_proxy_cores
  log "Done. VPN stays up; BitTorrent / DHT / public trackers are blocked."
  log "Check:  hiddify-block-torrents status"
  log "Remove: hiddify-block-torrents uninstall"
}

cmd_status() {
  detect_hiddify
  echo "version:    ${VERSION}"
  echo "hiddify:    ${HIDDIFY_DIR}"
  echo "script:     ${SELF_PATH} $([[ -x ${SELF_PATH} ]] && echo OK || echo MISSING)"
  local f state
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json"
  do
    [[ -f "${f}" ]] || continue
    if grep -q "${MARKER_BEGIN}" "${f}"; then state=BLOCKED; else state=NOT_PATCHED; fi
    echo "config:     ${state}  ${f}"
  done
  if command -v nft >/dev/null 2>&1 && nft list table inet hiddify_notorrent >/dev/null 2>&1; then
    echo "nftables:   OK (table inet hiddify_notorrent)"
  else
    echo "nftables:   missing"
  fi
  if command -v iptables >/dev/null 2>&1 && iptables -nL HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    echo "iptables:   OK (chain HIDDIFY_NOTORRENT)"
  else
    echo "iptables:   missing"
  fi
  if command -v ip6tables >/dev/null 2>&1 && ip6tables -nL HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    echo "ip6tables:  OK"
  else
    echo "ip6tables:  missing"
  fi
  if systemctl is-enabled hiddify-notorrent.timer >/dev/null 2>&1; then
    echo "timer:      enabled"
  else
    echo "timer:      not enabled"
  fi
}

cmd_uninstall() {
  need_root
  uninstall_systemd
  remove_firewall
  restore_backups
  restart_proxy_cores
  rm -f /usr/local/sbin/hiddify-block-torrents
  log "Torrent block removed. Original Hiddify routing restored if backups existed."
}

case "${CMD}" in
  install|"") cmd_install ;;
  apply)      cmd_apply ;;
  status)     cmd_status ;;
  uninstall|remove) cmd_uninstall ;;
  -h|--help|help)
    cat <<'EOF'
Usage: hiddify-block-torrents [install|apply|status|uninstall]

  install     First run on the server. Patches Hiddify, sets firewall, enables timer.
  apply       Re-apply (used by systemd after Hiddify "Apply Configs").
  status      Show whether the block is in place.
  uninstall   Restore original routing and remove firewall rules.
EOF
    ;;
  *) die "Unknown command: ${CMD}" ;;
esac
