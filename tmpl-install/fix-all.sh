#!/bin/bash
# tmpl-fix-all.sh — apply production fixes from x60 incident to an already-installed tmpl server.
# Safe to re-run (idempotent). Run as root on each EXIT server (Hiddify+tmpl). For relay see --relay.
#
# What it fixes:
#  1) admin_path removed from tmpl-sub haproxy ACL (admin UUID link works without login form)
#  2) tmpl domain cert published to haproxy ssl/ (fixes "Not secure" on https://xN.kirz.co.uk/)
#  3) tmpl-sub retries 20→2 + timeout server 8s (subscription spinner)
#  4) sub.py shorter upstream timeouts
#  5) hook.sh + acme-copy.sh keep publishing SNI cert
#  6) optional: --clear-owner-password  → empty owner password (login by UUID link only)
#  7) --relay → keep UDP/443 forwarded (HTTP/3 / Happ Alt-Svc), persist iptables
#
# Usage:
#   bash fix-all.sh
#   bash fix-all.sh --clear-owner-password
#   bash fix-all.sh --relay
#   bash fix-all.sh --relay --exit 1.2.3.4
set -euo pipefail
[ $(id -u) = 0 ] || { echo "run as root"; exit 1; }

CLEAR_PASS=no; RELAY=no; EXIT_IP=""
while [ $# -gt 0 ]; do case $1 in
  --clear-owner-password) CLEAR_PASS=yes; shift;;
  --relay) RELAY=yes; shift;;
  --exit) EXIT_IP=$2; shift 2;;
  -h|--help) sed -n '2,20p' "$0"; exit 0;;
  *) echo "unknown $1"; exit 2;;
esac; done

log(){ echo "[$(date +%H:%M:%S)] $*"; }
TS=$(date +%Y%m%d-%H%M%S)
B=/root/backup-tmpl-fix-$TS
mkdir -p "$B"

if [ "$RELAY" = yes ]; then
  log "RELAY mode: REJECT UDP/443 (fast fail for Happ HTTP/3 on LTE -> TCP fallback)"
  while iptables -t nat -D PREROUTING -p udp --dport 443 -j RETURN 2>/dev/null; do :; done
  iptables -t nat -I PREROUTING 1 -p udp --dport 443 -j RETURN
  while iptables -D INPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable 2>/dev/null; do :; done
  while iptables -D INPUT -p udp --dport 443 -j DROP 2>/dev/null; do :; done
  iptables -I INPUT 1 -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable
  if [ -n "$EXIT_IP" ]; then
    iptables -t nat -C TMPL-RELAY -p udp -j DNAT --to-destination "$EXIT_IP" 2>/dev/null \
      || iptables -t nat -A TMPL-RELAY -p udp -j DNAT --to-destination "$EXIT_IP"
  fi
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null; log "netfilter saved"; fi
  log "RELAY done (UDP443 REJECT on, other UDP still DNAT)"; exit 0
fi

[ -f /etc/tmpl/params.json ] || { echo "ERROR: /etc/tmpl/params.json missing — tmpl not installed?"; exit 1; }
[ -d /opt/hiddify-manager ] || { echo "ERROR: Hiddify not found"; exit 1; }

cp -a /etc/tmpl/hap-ins.py /etc/tmpl/sub.py /etc/tmpl/hook.sh /etc/tmpl/acme-copy.sh /etc/tmpl/params.json "$B/" 2>/dev/null || true
cp -a /opt/hiddify-manager/haproxy/haproxy.cfg "$B/" 2>/dev/null || true
log "backup -> $B"

python3 - <<'PY'
import json,os
f='/etc/tmpl/params.json'
P=json.load(open(f))
if P.get('admin_path') and not P.get('admin_path_saved'):
    P['admin_path_saved']=P['admin_path']
P['admin_path']=None
open(f+'.n','w').write(json.dumps(P,indent=1)); os.chmod(f+'.n',0o600); os.replace(f+'.n',f)
print('admin_path for ACL: None (saved=', P.get('admin_path_saved'), ')')
PY

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/tmpl/hap-ins.py')
t=p.read_text()
t=t.replace(
    "pp='('+'|'.join(dict.fromkeys(x for x in (cp,P.get('legacy_path'),P.get('admin_path')) if x))+')'",
    "pp='('+'|'.join(dict.fromkeys(x for x in (cp,P.get('legacy_path')) if x))+')'  # admin_path EXCLUDED"
)
t=t.replace('retries 20','retries 2')
if 'timeout server 8s' not in t:
    t=t.replace(
        'timeout connect 1s\\n  server s1 127.0.0.1:2099\\nbackend tmpl_sub_tcp',
        'timeout connect 1s\\n  timeout server 8s\\n  server s1 127.0.0.1:2099\\nbackend tmpl_sub_tcp')
    t=t.replace(
        'backend tmpl_sub_tcp\\n  mode tcp\\n  retries 2\\n  timeout connect 1s\\n  server s1',
        'backend tmpl_sub_tcp\\n  mode tcp\\n  retries 2\\n  timeout connect 1s\\n  timeout server 8s\\n  server s1')
p.write_text(t)
print('hap-ins.py ok')
PY

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/tmpl/sub.py')
t=p.read_text()
t=t.replace(
    "ALTP=[x for x in (P.get('legacy_path'),P.get('admin_path')) if x and x!=P['client_path']]",
    "ALTP=[x for x in (P.get('legacy_path'),) if x and x!=P['client_path']]"
)
t=t.replace("timeout=20)","timeout=4)")
t=t.replace("socket.create_connection(('127.0.0.1',443),timeout=20)","socket.create_connection(('127.0.0.1',443),timeout=4)")
t=t.replace('for attempt in range(3):','for attempt in range(2):')
t=t.replace('time.sleep(0.5)','time.sleep(0.2)')
p.write_text(t)
print('sub.py ok')
PY

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/tmpl/hook.sh')
t=p.read_text()
snippet='''# ensure tmpl domain SNI cert in haproxy ssl
D=$(cat /etc/tmpl/domain 2>/dev/null || true)
if [ -n "$D" ] && [ -s /etc/tmpl/$D.crt ] && [ -s /etc/tmpl/$D.key ]; then
  install -m600 /etc/tmpl/$D.crt /opt/hiddify-manager/ssl/$D.crt
  install -m600 /etc/tmpl/$D.key /opt/hiddify-manager/ssl/$D.crt.key
fi
'''
if 'ssl/$D.crt' not in t:
    if '/etc/tmpl/fw.sh' in t:
        t=t.replace('/etc/tmpl/fw.sh', snippet+'/etc/tmpl/fw.sh', 1)
    else:
        t=t.rstrip()+'\n'+snippet
    p.write_text(t)
print('hook.sh ok')
PY

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/tmpl/acme-copy.sh')
t=p.read_text()
extra='''
# publish to haproxy SNI dir
if [ -s /etc/tmpl/$D.crt ] && [ -s /etc/tmpl/$D.key ]; then
  install -m600 /etc/tmpl/$D.crt /opt/hiddify-manager/ssl/$D.crt
  install -m600 /etc/tmpl/$D.key /opt/hiddify-manager/ssl/$D.crt.key
fi
'''
if 'ssl/$D.crt' not in t:
    p.write_text(t.rstrip()+'\n'+extra)
print('acme-copy.sh ok')
PY

D=$(cat /etc/tmpl/domain)
if [ -s /etc/tmpl/$D.crt ] && [ -s /etc/tmpl/$D.key ]; then
  install -m600 /etc/tmpl/$D.crt /opt/hiddify-manager/ssl/$D.crt
  install -m600 /etc/tmpl/$D.key /opt/hiddify-manager/ssl/$D.crt.key
  log "SNI cert published for $D"
else
  log "WARNING: /etc/tmpl/$D.crt missing — issue cert first"
fi

python3 /etc/tmpl/hap-ins.py || true

python3 - <<'PY'
from pathlib import Path
import json
p=Path('/opt/hiddify-manager/haproxy/haproxy.cfg')
t=p.read_text()
i=t.rfind('backend tmpl_sub_http')
if i>=0:
    head,tail=t[:i],t[i:]
    tail=tail.replace('retries 20','retries 2')
    if 'timeout server 8s' not in tail:
        tail=tail.replace('timeout connect 1s\n  server s1 127.0.0.1:2099','timeout connect 1s\n  timeout server 8s\n  server s1 127.0.0.1:2099')
    t=head+tail
ap=json.load(open('/etc/tmpl/params.json')).get('admin_path_saved') or ''
if ap:
    t2=t.replace('|'+ap,'').replace(ap+'|','').replace('|'+ap+')',')')
    # also form (a|admin|b) -> careful: only exact path token
    t2=t.replace('|'+ap,'')
    if t2!=t:
        t=t2
        print('stripped admin_path from live ACL:', ap)
p.write_text(t)
print('live haproxy backends ok')
PY

haproxy -c -f /opt/hiddify-manager/haproxy/haproxy.cfg >/tmp/hapc.out 2>&1 || {
  log "WARNING haproxy -c:"; tail -5 /tmp/hapc.out
}
systemctl reload hiddify-haproxy
systemctl restart tmpl-sub
sleep 1
systemctl is-active hiddify-haproxy tmpl-sub >/dev/null && log "haproxy+tmpl-sub active"

if [ "$CLEAR_PASS" = yes ]; then
  HM=/opt/hiddify-manager
  ( set +u; cd $HM && source common/utils.sh && activate_python_venv
    hiddify-panel-cli shell <<'PY'
from hiddifypanel.models import AdminUser
a=AdminUser.get_super_admin()
a.update_password("")
print("owner password cleared; UUID-link login:", a.uuid)
PY
  )
  AP=$(mysql -N hiddifypanel -e "select value from str_config where child_id=0 and \`key\`='proxy_path_admin'")
  UUID=$(mysql -N hiddifypanel -e "select uuid from admin_user where mode='super_admin' order by id limit 1")
  log "Admin link (no password): https://<domain>/$AP/$UUID/"
fi

echo
echo "===== VERIFY ====="
grep -n 'path_reg' /opt/hiddify-manager/haproxy/haproxy.cfg | head -5
echo -n "SNI $D -> "; echo | openssl s_client -connect 127.0.0.1:443 -servername "$D" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || echo fail
echo "done. backup=$B"
EOF
