#!/usr/bin/env bash
# Rotate a secondary IPv6 on Ubuntu without touching Hiddify Manager.
# Keeps primary/global IPv6, link-local, IPv4, and all Hiddify services intact.
set -euo pipefail

CONF_FILE="${IPV6_ROTATE_CONF:-/etc/ipv6-rotate/ipv6-rotate.conf}"
PROTECTED_FILE="/etc/ipv6-rotate/protected"
PICK_PY="${PICK_PY:-/usr/local/lib/ipv6-rotate/pick.py}"
DRY_RUN=0
RESTORE=0
SHOW_STATUS=0
SHOW_LOG=0
DO_ROLLBACK=0
DO_OFF=0
DO_PAUSE=0
DO_RESUME=0
SET_IP=""
FORCE=0

usage() {
  cat <<'EOF'
Usage: rotate-ipv6.sh [command]

  (no args)          Rotate now (same as the 03:00 job)
  --set ADDR         Set this IPv6 manually
  --rollback         Return to the previous rotated IPv6
  --off              Remove extra IPv6, keep only the primary address
  --log              Show change history and log file
  --status           Show current IP, routes, next timer
  --pause            Stop the 03:00 timer (keep current extra IP)
  --resume           Enable the 03:00 timer again
  --restore          Re-apply last IP after reboot
  --dry-run          Print actions, do not apply
  --force            With --set: skip subnet/pool membership check
  --conf FILE        Config path
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --restore) RESTORE=1; shift ;;
    --status) SHOW_STATUS=1; shift ;;
    --log|--history) SHOW_LOG=1; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    --off|--disable-ip) DO_OFF=1; shift ;;
    --pause) DO_PAUSE=1; shift ;;
    --resume) DO_RESUME=1; shift ;;
    --set) SET_IP="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --conf) CONF_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

log() {
  local line
  line="$(date -Is) $*"
  echo "$line"
  if [[ -n "${LOG_FILE:-}" ]]; then
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    echo "$line" >>"$LOG_FILE" 2>/dev/null || true
  fi
  logger -t ipv6-rotate -- "$*" 2>/dev/null || true
}

die() {
  log "ERROR: $*"
  exit 1
}

require_root() {
  [[ $EUID -eq 0 ]] || die "run as root"
}

python_ok() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  if [[ ! -f "$PICK_PY" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$script_dir/pick.py" ]]; then
      PICK_PY="$script_dir/pick.py"
    fi
  fi
  [[ -f "$PICK_PY" ]] || die "pick.py not found: $PICK_PY"
}

load_conf() {
  [[ -f "$CONF_FILE" ]] || die "config not found: $CONF_FILE"
  # shellcheck disable=SC1090
  source "$CONF_FILE"
  MODE="${MODE:-subnet}"
  POOL_FILE="${POOL_FILE:-/etc/ipv6-rotate/pool.txt}"
  INTERFACE="${INTERFACE:-}"
  GATEWAY="${GATEWAY:-}"
  PROTECTED_IPV6="${PROTECTED_IPV6:-}"
  SUBNET="${SUBNET:-}"
  ROUTE_METRIC="${ROUTE_METRIC:-50}"
  ROUTE_PROTO="${ROUTE_PROTO:-162}"
  PING_CHECK="${PING_CHECK:-1}"
  PING_TARGET="${PING_TARGET:-2001:4860:4860::8888}"
  PING_COUNT="${PING_COUNT:-3}"
  POST_ROTATE_HOOK="${POST_ROTATE_HOOK:-}"
  LOG_FILE="${LOG_FILE:-/var/log/ipv6-rotate.log}"
  STATE_DIR="${STATE_DIR:-/var/lib/ipv6-rotate}"
  HISTORY_FILE="${HISTORY_FILE:-${STATE_DIR}/history}"
  mkdir -p "$STATE_DIR" 2>/dev/null || true
}

detect_iface() {
  if [[ -n "$INTERFACE" ]]; then
    echo "$INTERFACE"
    return
  fi
  local iface
  iface="$(ip -6 route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
  [[ -n "$iface" ]] || die "cannot detect IPv6 interface; set INTERFACE in config"
  echo "$iface"
}

detect_gateway() {
  if [[ -n "$GATEWAY" ]]; then
    echo "$GATEWAY"
    return
  fi
  local gw
  gw="$(ip -6 route show default 2>/dev/null | awk '/default/ {print $3; exit}')"
  [[ -n "$gw" ]] || die "cannot detect IPv6 gateway; set GATEWAY in config"
  echo "$gw"
}

normalize_ip() {
  python3 "$PICK_PY" normalize "$1"
}

current_global_ips() {
  local iface="$1"
  ip -6 addr show dev "$iface" scope global 2>/dev/null \
    | awk '/inet6/ {print $2}' \
    | cut -d/ -f1 \
    | while read -r ip; do
        [[ -z "$ip" ]] && continue
        normalize_ip "$ip" 2>/dev/null || true
      done
}

load_protected() {
  local iface="$1"
  local -a items=()
  local ip
  if [[ -n "$PROTECTED_IPV6" ]]; then
    IFS=',' read -r -a items <<<"$PROTECTED_IPV6"
  fi
  if [[ -f "$PROTECTED_FILE" ]]; then
    while IFS= read -r ip || [[ -n "$ip" ]]; do
      ip="${ip%%#*}"
      ip="$(echo "$ip" | xargs)"
      [[ -z "$ip" ]] && continue
      items+=("$ip")
    done <"$PROTECTED_FILE"
  fi
  local out=""
  for ip in "${items[@]}"; do
    ip="$(echo "$ip" | xargs)"
    [[ -z "$ip" ]] && continue
    ip="$(normalize_ip "$ip")"
    out+="${ip}"$'\n'
  done
  echo -n "$out"
}

is_protected() {
  local needle="$1"
  local list="$2"
  grep -Fxq "$needle" <<<"$list"
}

iface_has_ip() {
  local iface="$1" ip="$2"
  ip -6 addr show dev "$iface" | grep -q "inet6 ${ip}/"
}

wait_dad() {
  local iface="$1" ip="$2"
  local i
  for i in $(seq 1 30); do
    if ip -6 addr show dev "$iface" | grep "inet6 ${ip}/" | grep -q "tentative"; then
      sleep 0.4
      continue
    fi
    if iface_has_ip "$iface" "$ip"; then
      return 0
    fi
    sleep 0.4
  done
  return 1
}

prefix_len_of() {
  local iface="$1" ip="$2"
  local plen
  plen="$(ip -6 addr show dev "$iface" | awk -v ip="$ip" '$1=="inet6" && index($2, ip "/")==1 {split($2,a,"/"); print a[2]; exit}')"
  echo "${plen:-64}"
}

primary_prefix_len() {
  local iface="$1"
  local plen
  plen="$(ip -6 addr show dev "$iface" scope global | awk '/inet6/ {split($2,a,"/"); print a[2]; exit}')"
  echo "${plen:-64}"
}

detect_subnet() {
  if [[ -n "$SUBNET" ]]; then
    echo "$SUBNET"
    return
  fi
  local iface="$1"
  local addr
  addr="$(ip -6 addr show dev "$iface" scope global | awk '/inet6/ && !/temporary/ {print $2; exit}')"
  [[ -n "$addr" ]] || die "cannot detect IPv6 subnet; set SUBNET in config"
  python3 "$PICK_PY" network "$addr"
}

pick_from_subnet() {
  local subnet="$1" protected="$2"
  python3 "$PICK_PY" subnet "$subnet" "$protected"
}

pick_from_pool() {
  local pool_file="$1" protected="$2" current="$3"
  python3 "$PICK_PY" pool "$pool_file" "$protected" "$current"
}

flush_our_routes() {
  local iface="$1"
  ip -6 route flush proto "$ROUTE_PROTO" dev "$iface" 2>/dev/null || true
}

add_src_route() {
  local iface="$1" gw="$2" src="$3"
  flush_our_routes "$iface"
  ip -6 route add default via "$gw" dev "$iface" src "$src" metric "$ROUTE_METRIC" proto "$ROUTE_PROTO"
}

add_address() {
  local iface="$1" ip="$2" plen="$3"
  if iface_has_ip "$iface" "$ip"; then
    return 0
  fi
  ip -6 addr add "${ip}/${plen}" dev "$iface" noprefixroute
  wait_dad "$iface" "$ip" || die "DAD failed for $ip"
}

del_address() {
  local iface="$1" ip="$2" protected="$3"
  [[ -z "$ip" ]] && return 0
  if is_protected "$ip" "$protected"; then
    log "skip delete of protected address $ip"
    return 0
  fi
  iface_has_ip "$iface" "$ip" || return 0
  local plen
  plen="$(prefix_len_of "$iface" "$ip")"
  ip -6 addr del "${ip}/${plen}" dev "$iface" || true
}

ping_from() {
  local ip="$1"
  ping -6 -c "$PING_COUNT" -W 2 -I "$ip" "$PING_TARGET" >/dev/null 2>&1
}

save_state() {
  local ip="$1"
  local reason="${2:-rotate}"
  local old=""
  old="$(read_state || true)"
  if [[ -n "$old" && "$old" != "$ip" ]]; then
    echo "$old" >"${STATE_DIR}/previous"
  fi
  if [[ -n "$ip" ]]; then
    echo "$ip" >"${STATE_DIR}/current"
    rm -f "${STATE_DIR}/disabled"
  else
    rm -f "${STATE_DIR}/current"
  fi
  append_history "$reason" "${old:-none}" "${ip:-none}" "ok"
}

read_state() {
  if [[ -f "${STATE_DIR}/current" ]]; then
    local ip
    ip="$(tr -d ' \t\n' <"${STATE_DIR}/current")"
    [[ -n "$ip" ]] && normalize_ip "$ip"
  fi
}

read_previous() {
  if [[ -f "${STATE_DIR}/previous" ]]; then
    local ip
    ip="$(tr -d ' \t\n' <"${STATE_DIR}/previous")"
    [[ -n "$ip" ]] && normalize_ip "$ip"
  fi
}

append_history() {
  local reason="$1" old="$2" new="$3" result="$4"
  local msg="${reason} ${old} -> ${new} ${result}"
  mkdir -p "$(dirname "$HISTORY_FILE")" 2>/dev/null || true
  echo "$(date -Is) ${msg}" >>"${HISTORY_FILE}" 2>/dev/null || true
  log "$msg"
}

print_status() {
  load_conf
  python_ok
  local iface gw current prev
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  current="$(read_state || true)"
  prev="$(read_previous || true)"
  echo "interface:     $iface"
  echo "gateway:       $gw"
  echo "mode:          $MODE"
  echo "subnet:        ${SUBNET:-auto}"
  echo "rotated_ip:    ${current:-none}"
  echo "previous_ip:   ${prev:-none}"
  echo "protected:"
  load_protected "$iface" | sed 's/^/  /'
  echo "global addresses on $iface:"
  current_global_ips "$iface" | sed 's/^/  /'
  echo "our IPv6 default route:"
  ip -6 route show proto "$ROUTE_PROTO" || true
  echo "system IPv6 default:"
  ip -6 route show default || true
  if command -v systemctl >/dev/null; then
    echo
    echo "timer:"
    systemctl is-enabled ipv6-rotate.timer 2>/dev/null || true
    systemctl list-timers ipv6-rotate.timer --no-pager 2>/dev/null || true
  fi
  if [[ -f "${STATE_DIR}/disabled" ]]; then
    echo
    echo "note: extra IPv6 is OFF (--off). Nightly restore will not re-add it."
  fi
}

print_log() {
  load_conf
  echo "=== history (${HISTORY_FILE}) ==="
  if [[ -f "$HISTORY_FILE" ]]; then
    tail -n 50 "$HISTORY_FILE"
  else
    echo "(empty)"
  fi
  echo
  echo "=== log (${LOG_FILE}) ==="
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE"
  else
    echo "(empty)"
  fi
  echo
  echo "=== journalctl -t ipv6-rotate ==="
  journalctl -t ipv6-rotate -n 40 --no-pager 2>/dev/null || true
}

apply_ip() {
  local iface="$1" gw="$2" new_ip="$3" old_ip="$4" protected="$5" plen="$6"
  local reason="${7:-rotate}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN ${reason}: add ${new_ip}/${plen} on $iface, src route via $gw, remove ${old_ip:-none}"
    return 0
  fi

  add_address "$iface" "$new_ip" "$plen"
  add_src_route "$iface" "$gw" "$new_ip"

  if [[ "$PING_CHECK" == "1" ]]; then
    if ! ping_from "$new_ip"; then
      log "ping6 via $new_ip failed, rolling back"
      append_history "$reason" "${old_ip:-none}" "$new_ip" "fail-ping"
      if [[ -n "$old_ip" ]] && ! is_protected "$old_ip" "$protected"; then
        add_address "$iface" "$old_ip" "$plen" || true
        add_src_route "$iface" "$gw" "$old_ip" || true
      else
        flush_our_routes "$iface"
      fi
      if ! is_protected "$new_ip" "$protected"; then
        del_address "$iface" "$new_ip" "$protected"
      fi
      die "rollback complete: new IPv6 $new_ip did not pass ping check"
    fi
  fi

  if [[ -n "$old_ip" && "$old_ip" != "$new_ip" ]]; then
    del_address "$iface" "$old_ip" "$protected"
  fi
  if [[ "$reason" == "restore" ]]; then
    echo "$new_ip" >"${STATE_DIR}/current"
    log "restore ${new_ip} on ${iface}"
  else
    save_state "$new_ip" "$reason"
  fi

  if [[ -n "$POST_ROTATE_HOOK" && -x "$POST_ROTATE_HOOK" ]]; then
    log "running hook $POST_ROTATE_HOOK"
    "$POST_ROTATE_HOOK" "$new_ip" "${old_ip:-}" || log "WARNING: hook failed"
  fi
}

main_restore() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  if [[ -f "${STATE_DIR}/disabled" ]]; then
    log "extra IPv6 is OFF; skip restore"
    exit 0
  fi
  local iface gw current protected plen
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  protected="$(load_protected "$iface")"
  current="$(read_state || true)"
  [[ -n "$current" ]] || { log "nothing to restore"; exit 0; }
  plen="$(primary_prefix_len "$iface")"
  log "restoring rotated IPv6 $current on $iface"
  apply_ip "$iface" "$gw" "$current" "" "$protected" "$plen" "restore"
}

main_off() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  local iface protected current
  iface="$(detect_iface)"
  protected="$(load_protected "$iface")"
  current="$(read_state || true)"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN --off: remove ${current:-none} and our IPv6 src route"
    return 0
  fi
  flush_our_routes "$iface"
  if [[ -n "$current" ]]; then
    del_address "$iface" "$current" "$protected"
  fi
  mkdir -p "$STATE_DIR"
  touch "${STATE_DIR}/disabled"
  save_state "" "off"
  log "extra IPv6 removed; primary address unchanged. Nightly job will not re-add until you rotate or --set."
}

main_rollback() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  local iface gw protected current prev plen
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  protected="$(load_protected "$iface")"
  current="$(read_state || true)"
  prev="$(read_previous || true)"
  [[ -n "$prev" ]] || die "no previous IPv6 stored; cannot rollback (use --off to drop the extra address)"
  if is_protected "$prev" "$protected"; then
    die "previous IPv6 $prev is the protected primary address"
  fi
  plen="$(primary_prefix_len "$iface")"
  apply_ip "$iface" "$gw" "$prev" "${current:-}" "$protected" "$plen" "rollback"
}

main_set() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  local iface gw protected current new_ip plen
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  protected="$(load_protected "$iface")"
  [[ -n "$protected" ]] || die "protected IPv6 list is empty; re-run install.sh"
  current="$(read_state || true)"
  new_ip="$(normalize_ip "$SET_IP")"
  if is_protected "$new_ip" "$protected"; then
    die "$new_ip is protected (primary); choose another address"
  fi
  if [[ "$FORCE" -ne 1 ]]; then
    python3 "$PICK_PY" belongs "$new_ip" "$MODE" "${SUBNET:-}" "${POOL_FILE:-}" >/dev/null \
      || die "$new_ip is outside SUBNET/pool; pass --force to override"
  fi
  plen="$(primary_prefix_len "$iface")"
  apply_ip "$iface" "$gw" "$new_ip" "${current:-}" "$protected" "$plen" "manual"
}

main_pause() {
  require_root
  load_conf
  systemctl disable --now ipv6-rotate.timer
  log "03:00 timer paused. Current extra IPv6 is unchanged. Resume with: rotate-ipv6.sh --resume"
}

main_resume() {
  require_root
  load_conf
  systemctl enable --now ipv6-rotate.timer
  log "03:00 timer resumed"
  systemctl list-timers ipv6-rotate.timer --no-pager || true
}

main_rotate() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  local iface gw protected current new_ip plen subnet
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  protected="$(load_protected "$iface")"
  [[ -n "$protected" ]] || die "protected IPv6 list is empty; re-run install.sh so the primary address is snapshotted"
  current="$(read_state || true)"
  plen="$(primary_prefix_len "$iface")"

  case "$MODE" in
    subnet)
      subnet="$(detect_subnet "$iface")"
      new_ip="$(pick_from_subnet "$subnet" "$protected"$'\n'"${current}")"
      ;;
    pool)
      [[ -f "$POOL_FILE" ]] || die "pool file not found: $POOL_FILE"
      new_ip="$(pick_from_pool "$POOL_FILE" "$protected" "${current:-}")"
      ;;
    *)
      die "unknown MODE=$MODE (use subnet or pool)"
      ;;
  esac
  new_ip="$(normalize_ip "$new_ip")"

  if is_protected "$new_ip" "$protected"; then
    die "picked address $new_ip is protected; check SUBNET/POOL_FILE"
  fi
  if [[ -n "$current" && "$new_ip" == "$current" ]]; then
    log "pool has a single usable address ($new_ip); nothing to rotate"
    apply_ip "$iface" "$gw" "$new_ip" "$current" "$protected" "$plen" "rotate"
    exit 0
  fi

  apply_ip "$iface" "$gw" "$new_ip" "${current:-}" "$protected" "$plen" "rotate"
}

if [[ "$SHOW_STATUS" -eq 1 ]]; then
  print_status
  exit 0
fi
if [[ "$SHOW_LOG" -eq 1 ]]; then
  print_log
  exit 0
fi
if [[ "$DO_PAUSE" -eq 1 ]]; then
  main_pause
  exit 0
fi
if [[ "$DO_RESUME" -eq 1 ]]; then
  main_resume
  exit 0
fi
if [[ "$DO_OFF" -eq 1 ]]; then
  main_off
  exit 0
fi
if [[ "$DO_ROLLBACK" -eq 1 ]]; then
  main_rollback
  exit 0
fi
if [[ -n "$SET_IP" ]]; then
  main_set
  exit 0
fi
if [[ "$RESTORE" -eq 1 ]]; then
  main_restore
  exit 0
fi
main_rotate
