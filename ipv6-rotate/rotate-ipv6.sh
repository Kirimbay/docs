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

usage() {
  cat <<'EOF'
Usage: rotate-ipv6.sh [--dry-run] [--restore] [--status] [--conf FILE]

  --dry-run   Show what would change, do not apply
  --restore   Re-apply last rotated address (boot)
  --status    Print current state
  --conf FILE Config path (default: /etc/ipv6-rotate/ipv6-rotate.conf)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --restore) RESTORE=1; shift ;;
    --status) SHOW_STATUS=1; shift ;;
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
  echo "$ip" >"${STATE_DIR}/current"
}

read_state() {
  if [[ -f "${STATE_DIR}/current" ]]; then
    local ip
    ip="$(tr -d ' \t\n' <"${STATE_DIR}/current")"
    [[ -n "$ip" ]] && normalize_ip "$ip"
  fi
}

print_status() {
  load_conf
  python_ok
  local iface gw current
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  current="$(read_state || true)"
  echo "interface:     $iface"
  echo "gateway:       $gw"
  echo "mode:          $MODE"
  echo "subnet:        ${SUBNET:-auto}"
  echo "rotated_ip:    ${current:-none}"
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
    systemctl list-timers ipv6-rotate.timer --no-pager 2>/dev/null || true
  fi
}

apply_ip() {
  local iface="$1" gw="$2" new_ip="$3" old_ip="$4" protected="$5" plen="$6"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN add ${new_ip}/${plen} on $iface, src route via $gw, remove $old_ip"
    return 0
  fi

  add_address "$iface" "$new_ip" "$plen"
  add_src_route "$iface" "$gw" "$new_ip"

  if [[ "$PING_CHECK" == "1" ]]; then
    if ! ping_from "$new_ip"; then
      log "ping6 via $new_ip failed, rolling back"
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
  save_state "$new_ip"
  log "IPv6 rotated: ${old_ip:-none} -> $new_ip (iface=$iface)"

  if [[ -n "$POST_ROTATE_HOOK" && -x "$POST_ROTATE_HOOK" ]]; then
    log "running hook $POST_ROTATE_HOOK"
    "$POST_ROTATE_HOOK" "$new_ip" "${old_ip:-}" || log "WARNING: hook failed"
  fi
}

main_restore() {
  [[ "$DRY_RUN" -eq 1 ]] || require_root
  load_conf
  python_ok
  local iface gw current protected plen
  iface="$(detect_iface)"
  gw="$(detect_gateway)"
  protected="$(load_protected "$iface")"
  current="$(read_state || true)"
  [[ -n "$current" ]] || { log "nothing to restore"; exit 0; }
  plen="$(primary_prefix_len "$iface")"
  log "restoring rotated IPv6 $current on $iface"
  apply_ip "$iface" "$gw" "$current" "" "$protected" "$plen"
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
    apply_ip "$iface" "$gw" "$new_ip" "$current" "$protected" "$plen"
    exit 0
  fi

  apply_ip "$iface" "$gw" "$new_ip" "${current:-}" "$protected" "$plen"
}

if [[ "$SHOW_STATUS" -eq 1 ]]; then
  print_status
  exit 0
fi
if [[ "$RESTORE" -eq 1 ]]; then
  main_restore
  exit 0
fi
main_rotate
