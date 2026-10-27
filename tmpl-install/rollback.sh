#!/bin/bash
# Roll back a tmpl install: bash rollback.sh [BACKUP_DIR] [--restore-db]
#  - re-enables Hiddify protocols the installer disabled (disabled-old.txt) + apply_configs
#  - removes tmpl units/cron/haproxy tmpl-sub blocks/tmpl-h3 marks/firewall rules
#  - does NOT restore a previous /etc/tmpl (that used to re-insert hap blocks via hook)
#  - --restore-db: also restore the full hiddifypanel DB dump (loses panel changes made since backup!)
RDB=""; for a in "$@"; do [ "$a" = --restore-db ] && RDB=1; done; [ "${1:-}" = --restore-db ] && shift
B=${1:-$(cat /root/.tmpl-last-backup 2>/dev/null)}; [ -d "$B" ] || { echo "backup dir not found: $B"; exit 1; }
HM=/opt/hiddify-manager; T=/etc/tmpl
HAP=$(python3 -c "import json;print(json.load(open('$T/params.json')).get('hap_cfg',''))" 2>/dev/null); [ -f "$HAP" ] || HAP=$HM/haproxy/haproxy.cfg
echo "rollback from $B"
DIS=$(cat $T/disabled-old.txt $B/disabled-old.txt 2>/dev/null | tr ' ' '\n' | sort -u | grep . )
PORTS=$(python3 -c "import json;print(*json.load(open('$T/params.json')).get('ports',[2053,8444,2097,2083,36099]))" 2>/dev/null || echo 2053 8444 2097 2083 36099)
U="tmpl-hook.path tmpl-hook.timer tmpl-sync.timer tmpl-fw.timer tmpl-health.timer tmpl-sub tmpl-xray tmpl-hy2"
[ -f $T/stats.py ] && python3 $T/stats.py  # flush last template traffic into Hiddify before stopping
U="tmpl-stats.timer $U"
systemctl disable --now $U 2>/dev/null
rm -rf /etc/systemd/system/kirvpn-torrent-watcher.service.d/tmpl.conf
rm -f /etc/systemd/system/tmpl-* /etc/cron.d/tmpl-acme
set -- $PORTS
for X in iptables ip6tables; do for p in $1 $2 $3 $4; do while $X -D INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; do :; done; done
  while $X -D INPUT -p udp --dport $5 -j ACCEPT 2>/dev/null; do :; done; done
# Alt-Svc h3 fix (hap-ins.py): restore Hiddify templates from *.bak-h3
find $HM/haproxy -name '*.bak-h3' 2>/dev/null | while read b; do o=${b%.bak-h3}; [ "$o" = "$HAP" ] && continue; cp -a "$b" "$o" && rm -f "$b" && echo "restored $o"; done
# Always purge every tmpl-sub block and every '# tmpl-h3 ' mark from live haproxy.cfg (loop until clean)
purge_hap() {
  [ -f "$HAP" ] || return 0
  cp -a "$HAP" "$HAP.bak-rb-$(date +%Y%m%d-%H%M%S)"
  local n=0
  while grep -qE '# BEGIN tmpl-sub|# END tmpl-sub|# tmpl-h3 ' "$HAP"; do
    n=$((n+1)); [ "$n" -gt 20 ] && { echo "WARN: hap purge loop exceeded"; break; }
    sed -e '/# BEGIN tmpl-sub/,/# END tmpl-sub/d' -e 's/# tmpl-h3 //' "$HAP" > "$HAP.tmpl-rb" || break
    mv "$HAP.tmpl-rb" "$HAP"
  done
  # orphan markers if blocks were half-removed earlier
  if grep -qE '# BEGIN tmpl-sub|# END tmpl-sub|# tmpl-h3 ' "$HAP"; then
    sed -e '/# BEGIN tmpl-sub/d' -e '/# END tmpl-sub/d' -e 's/# tmpl-h3 //' "$HAP" > "$HAP.tmpl-rb" && mv "$HAP.tmpl-rb" "$HAP"
  fi
  HCK="-f $HAP"; for x in $(dirname $HAP)/*.cfg; do [ "$x" = "$HAP" ] || HCK="$HCK -f $x"; done
  if haproxy -c $HCK >/dev/null 2>&1; then
    systemctl reload hiddify-haproxy
    rm -f "$HAP.bak-h3"
    echo "haproxy purged of tmpl-sub/tmpl-h3 (passes: $n)"
  else
    echo "WARN: haproxy -c failed after purge; restoring last .bak-rb"
    L=$(ls -1t "$HAP".bak-rb-* 2>/dev/null | head -1)
    [ -n "$L" ] && cp -a "$L" "$HAP"
  fi
  if grep -qE 'tmpl-sub|tmpl-h3' "$HAP"; then echo "WARN: hap still has tmpl markers:"; grep -nE 'tmpl-sub|tmpl-h3' "$HAP" | head; else echo "hap tmpl markers: none"; fi
}
purge_hap
if [ -n "$RDB" ]; then mysql hiddifypanel < $B/hiddifypanel.sql && echo "DB restored"; NEEDAPPLY=1; fi
if [ -n "$DIS" ]; then ( set +u; cd $HM && source common/utils.sh && activate_python_venv && for k in $DIS; do hiddify-panel-cli set-setting -k $k -v True; done ); echo "re-enabled:" $DIS; NEEDAPPLY=1; fi
for u in $(cat $B/takeover-units.txt 2>/dev/null); do systemctl enable --now $u && echo "re-enabled $u"; done
mv $T $T.removed-$(date +%Y%m%d-%H%M%S) 2>/dev/null
# Do not restore previous /etc/tmpl: that re-ran hook.sh and put tmpl-sub back into haproxy.cfg
systemctl daemon-reload
if [ -n "${NEEDAPPLY:-}" ]; then systemctl restart hiddify-panel hiddify-panel-background-tasks; sleep 8; (cd $HM && bash apply_configs.sh --no-gui) > /root/tmpl-rollback-apply.log 2>&1; echo "apply_configs rc=$?"; fi
# Final purge after apply_configs (Hiddify may rewrite hap from templates)
HAP=$HM/haproxy/haproxy.cfg
purge_hap
systemctl is-active hiddify-haproxy; echo "rollback done (old /etc/tmpl kept as $T.removed-*; previous tmpl NOT restored)"
