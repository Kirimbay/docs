#!/bin/bash
# Turn OFF the old Hiddify protocols so subscriptions contain ONLY the template animals.
#   bash /etc/tmpl/disable-old.sh            (run after install.sh; safe to re-run)
#   bash /etc/tmpl/disable-old.sh --undo     (turn them back on)
# Order matters (lesson from server 8): DB flags -> restart hiddify-panel + background-tasks -> apply_configs -> verify --strict.
# Backup first; any failure -> automatic undo.
set -uo pipefail
HM=/opt/hiddify-manager; T=/etc/tmpl; HAP=$(python3 -c "import json;print(json.load(open('$T/params.json'))['hap_cfg'])" 2>/dev/null)
filt(){ python3 -c "import json,os;f='/etc/tmpl/params.json';P=json.load(open(f));P['filter_hiddify']=$1;open(f+'.n','w').write(json.dumps(P,indent=1));os.replace(f+'.n',f)"; systemctl restart tmpl-sub; }
log(){ echo "[$(date +%H:%M:%S)] $*"; }
[ $(id -u) = 0 ] && [ -f $T/params.json ] || { echo "run as root after install.sh"; exit 1; }
PROTO="vless_enable trojan_enable vmess_enable reality_enable hysteria_enable tuic_enable shadowsocks2022_enable shadowtls_enable ssr_enable v2ray_enable wireguard_enable ssh_server_enable naive_enable mieru_enable kcp_enable http_proxy_enable tcp_enable ws_enable grpc_enable httpupgrade_enable xhttp_enable h2_enable quic_enable"
setkeys(){ ( set +u; cd $HM && source common/utils.sh && activate_python_venv && for k in $2; do hiddify-panel-cli set-setting -k $k -v $1 || exit 1; done ); }
inval(){ ( cd $HM/hiddify-panel 2>/dev/null; timeout 90 $HM/.venv313/bin/hiddifypanel shell >/dev/null 2>&1 <<'PYI'
from hiddifypanel.hutils.proxy.shared import get_proxies
get_proxies.invalidate_all()
from hiddifypanel.models.config import hconfig
hconfig.invalidate_all()
try:
    from hiddifypanel.proxy_v3.config_builder.dump import invalidate_config_caches
    invalidate_config_caches()
except Exception: pass
PYI
); true; }   # Hiddify caches proxies (redis, 300 s) -> old hosts stayed in subs on ro1 until invalidated
apply(){ systemctl restart hiddify-panel hiddify-panel-background-tasks && sleep 8 && inval && \
  ( cd $HM && bash apply_configs.sh --no-gui ) >> $B/apply.log 2>&1 || return 1
  for i in $(seq 1 30); do grep -q '# BEGIN tmpl-sub' $HAP && systemctl is-active -q hiddify-haproxy && break; bash $T/hook.sh >/dev/null 2>&1; sleep 4; done
  inval; sleep 5; }
B=/root/backup-tmpl-disold-$(date +%Y%m%d-%H%M%S); mkdir -p $B
mysqldump hiddifypanel > $B/hiddifypanel.sql || { echo "DB backup failed"; exit 1; }
mysql -N hiddifypanel -e "select \`key\`,value from bool_config where child_id=0" > $B/bool_config.tsv
if [ "${1:-}" = --undo ]; then
  K=$(cat $T/disabled-old.txt 2>/dev/null | tr ' ' '\n' | sort -u | xargs); [ -n "$K" ] || { echo "nothing to undo"; exit 0; }
  log "re-enabling: $K"; setkeys True "$K" && apply || { echo "undo FAILED, see $B/apply.log"; exit 1; }
  rm -f $T/disabled-old.txt; python3 - <<'PY'
import json;f='/etc/tmpl/params.json';P=json.load(open(f));P['filter_hiddify']=False;open(f+'.n','w').write(json.dumps(P,indent=1));import os;os.replace(f+'.n',f)
PY
  systemctl restart tmpl-sub; $T/verify.py | tail -1; exit 0; fi
EN=""; for k in $PROTO; do [ "$(mysql -N hiddifypanel -e "select value from bool_config where child_id=0 and \`key\`='$k'")" = 1 ] && EN="$EN $k"; done; EN=${EN# }
if [ -n "$EN" ]; then
  echo "$EN" >> $T/disabled-old.txt; log "backup $B; disabling Hiddify:$EN"
  undo(){ echo "FAILED: $*" >&2; log "auto-undo"; setkeys True "$EN"; apply; filt False; sed -i "s/$EN//" $T/disabled-old.txt; $T/verify.py | tail -1; exit 1; }
  setkeys False "$EN" || undo "set-setting"
  apply || undo "apply_configs (see $B/apply.log)"
else log "old protocols already off"; fi
python3 - <<'PY'
import json,os;f='/etc/tmpl/params.json';P=json.load(open(f));P['filter_hiddify']=True;open(f+'.n','w').write(json.dumps(P,indent=1));os.replace(f+'.n',f)
PY
systemctl restart tmpl-sub; sleep 1
# strict = subscription has ONLY the animals, no old Hiddify hosts left
if $T/verify.py --strict > $B/verify.txt 2>&1; then log "$(tail -1 $B/verify.txt) - only animals in subscriptions"; echo "undo: bash $T/disable-old.sh --undo"
else grep FAIL $B/verify.txt | head -5; [ -n "$EN" ] && undo "strict verify: old hosts still in subscription"; exit 1; fi
