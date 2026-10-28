#!/bin/bash
# Relay mode: forward all TCP (except kept ports) and all UDP from this server to the exit server.
# bash relay.sh --exit EXIT_IP [--keep 22,8090]      bash relay.sh --remove
# Idempotent: own chains TMPL-RELAY (nat PREROUTING) / TMPL-RELAY-POST (nat POSTROUTING) / TMPL-RELAY-FWD (filter FORWARD),
# re-run replaces the rules. Persists via netfilter-persistent; ip_forward via /etc/sysctl.d/99-tmpl-relay.conf.
set -uo pipefail
EXIT=""; KEEP=22; REMOVE=no; NOPERSIST=${TMPL_RELAY_NOPERSIST:-no}
while [ $# -gt 0 ]; do case $1 in
 --exit) EXIT=$2; shift 2;; --keep) KEEP=$2; shift 2;; --remove) REMOVE=yes; shift;; --relay) shift;;
 -h|--help) sed -n 2,5p "$0"; exit 0;; *) echo "unknown arg $1"; exit 2;; esac; done
die(){ echo "ERROR: $*" >&2; exit 1; }; log(){ echo "[relay] $*"; }
[ $(id -u) = 0 ] || die "run as root"
need_ipt(){ command -v iptables >/dev/null && return 0
  log "installing iptables"; apt-get update -qq >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q iptables >/dev/null || die "cannot install iptables"
  command -v iptables >/dev/null || die "iptables still missing"; }
need_ipt
SC=/etc/sysctl.d/99-tmpl-relay.conf
flush(){ # remove jumps + chains (safe if absent)
  while iptables -t nat -D PREROUTING -j TMPL-RELAY 2>/dev/null; do :; done
  while iptables -t nat -D POSTROUTING -j TMPL-RELAY-POST 2>/dev/null; do :; done
  while iptables -D FORWARD -j TMPL-RELAY-FWD 2>/dev/null; do :; done
  for c in "nat TMPL-RELAY" "nat TMPL-RELAY-POST" "filter TMPL-RELAY-FWD"; do set -- $c
    iptables -t $1 -F $2 2>/dev/null; iptables -t $1 -X $2 2>/dev/null; done; }
persist(){ [ $NOPERSIST = yes ] && return 0
  if ! command -v netfilter-persistent >/dev/null; then
    echo iptables-persistent iptables-persistent/autosave_v4 boolean false | debconf-set-selections 2>/dev/null
    echo iptables-persistent iptables-persistent/autosave_v6 boolean false | debconf-set-selections 2>/dev/null
    { apt-get install -y -q --no-download iptables-persistent >/dev/null 2>&1 || apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -q iptables-persistent >/dev/null; } || die "cannot install iptables-persistent"; fi
  netfilter-persistent save >/dev/null 2>&1 || die "netfilter-persistent save failed"
  [ -s /etc/iptables/rules.v4 ] || { mkdir -p /etc/iptables; iptables-save > /etc/iptables/rules.v4; }; log "rules saved (/etc/iptables/rules.v4)"; }
if [ $REMOVE = yes ]; then
  flush; iptables -t nat -D PREROUTING -p udp --dport 443 -j RETURN 2>/dev/null; iptables -D INPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable 2>/dev/null
  rm -f $SC; [ $NOPERSIST = yes ] || sysctl -qw net.ipv4.ip_forward=0
  persist; log "relay removed (ip_forward disabled)"; exit 0; fi
[[ $EXIT =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "--exit IPv4 required"
KP=(); IFS=, read -ra KA <<<"$KEEP"; for p in "${KA[@]}"; do [[ $p =~ ^[0-9]+$ ]] && [ $p -ge 1 ] && [ $p -le 65535 ] || die "bad --keep port '$p'"; KP+=($p); done
case ",$KEEP," in *,22,*) ;; *) log "WARNING: 22 not in --keep -> SSH to this relay will go to the exit server";; esac
ip -4 addr | grep -q "inet $EXIT/" && die "--exit is this server's own IP"
flush
iptables -t nat -N TMPL-RELAY; iptables -t nat -N TMPL-RELAY-POST; iptables -N TMPL-RELAY-FWD
# only traffic addressed to this host itself; keep local ports; never touch loopback
iptables -t nat -A TMPL-RELAY -i lo -j RETURN
iptables -t nat -A TMPL-RELAY -m addrtype ! --dst-type LOCAL -j RETURN
for p in "${KP[@]}"; do iptables -t nat -A TMPL-RELAY -p tcp --dport $p -j RETURN; done
iptables -t nat -A TMPL-RELAY -p tcp -j DNAT --to-destination $EXIT
iptables -t nat -A TMPL-RELAY -p udp -j DNAT --to-destination $EXIT
iptables -t nat -A TMPL-RELAY-POST -d $EXIT -m conntrack --ctstate DNAT -j MASQUERADE
iptables -A TMPL-RELAY-FWD -d $EXIT -m conntrack --ctstate DNAT -j ACCEPT
iptables -A TMPL-RELAY-FWD -s $EXIT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -I PREROUTING 1 -j TMPL-RELAY; iptables -t nat -I POSTROUTING 1 -j TMPL-RELAY-POST; iptables -I FORWARD 1 -j TMPL-RELAY-FWD
# no HTTP/3: reject UDP 443 (fast ICMP -> clients fall back to TCP instead of hanging on cached Alt-Svc h3; MTS LTE drops UDP 443)
# nat RETURN must stay ABOVE the TMPL-RELAY jump (re-inserted every run), so it is re-placed at 1 if -C finds it lower; INPUT: -C before -I. Other UDP (24328/24329/36099) untouched.
[ "$(iptables -t nat -S PREROUTING | sed -n 2p)" = "-A PREROUTING -p udp -m udp --dport 443 -j RETURN" ] || {
  while iptables -t nat -D PREROUTING -p udp --dport 443 -j RETURN 2>/dev/null; do :; done
  iptables -t nat -C PREROUTING -p udp --dport 443 -j RETURN 2>/dev/null || iptables -t nat -I PREROUTING 1 -p udp --dport 443 -j RETURN; }
iptables -C INPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable 2>/dev/null || iptables -I INPUT 1 -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable
[ $NOPERSIST = yes ] || { echo "net.ipv4.ip_forward=1" > $SC; sysctl -q -p $SC || die "sysctl"; }
persist
log "relay ON: all TCP except ${KP[*]} and all UDP except 443 (rejected, no h3) -> $EXIT (MASQUERADE); undo: bash relay.sh --remove"
