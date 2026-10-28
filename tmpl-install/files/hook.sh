#!/bin/bash
# runs every minute + on haproxy.cfg change: firewall + haproxy block, idempotent
# ensure tmpl domain SNI cert in haproxy ssl (animals domain may be absent from Hiddify domain list)
D=$(cat /etc/tmpl/domain 2>/dev/null || true)
if [ -n "$D" ] && [ -s /etc/tmpl/$D.crt ] && [ -s /etc/tmpl/$D.key ]; then
  install -m600 /etc/tmpl/$D.crt /opt/hiddify-manager/ssl/$D.crt
  install -m600 /etc/tmpl/$D.key /opt/hiddify-manager/ssl/$D.crt.key
fi
/etc/tmpl/fw.sh
r=$(/etc/tmpl/hap-ins.py); S=/run/tmpl-hap.stamp; C=/opt/hiddify-manager/haproxy/haproxy.cfg; if [ "$r" = CHANGED ] || [ ! -e $S ] || [ $C -nt $S ]; then systemctl reload hiddify-haproxy && touch $S; echo "$(date -Is) hook: hap-ins=$r, haproxy reloaded" >> /var/log/tmpl-hook.log; fi
