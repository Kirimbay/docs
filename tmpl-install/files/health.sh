#!/bin/bash
# hourly health -> /var/log/tmpl-health.log
D=$(cat /etc/tmpl/domain); L=/var/log/tmpl-health.log; S="OK"; m=""
read SOVA TIGR KRAB UTKA RYBA < <(python3 -c "import json;p=json.load(open('/etc/tmpl/params.json'))['ports'];print(*p)")
. /etc/tmpl/fw.ports 2>/dev/null; for p in ${OPEN_TCP-$SOVA $UTKA $KRAB $TIGR}; do ss -lnt "sport = :$p" | grep -q LISTEN || { S=FAIL; m+=" tcp$p:down"; }; done
for p in ${OPEN_UDP-$RYBA}; do ss -lnu "sport = :$p" | grep -q ":$p" || { S=FAIL; m+=" udp$p:down"; }; done
for s in tmpl-xray tmpl-sub $([ -n "${OPEN_UDP-x}" ] && echo tmpl-hy2); do systemctl is-active -q $s || { S=FAIL; m+=" $s:inactive"; }; done
end=$(openssl x509 -in /etc/tmpl/$D.crt -noout -enddate | cut -d= -f2); days=$(( ($(date -d "$end" +%s)-$(date +%s))/86400 ))
[ $days -lt 15 ] && { S=FAIL; m+=" cert:${days}d"; }
/etc/tmpl/verify.py --quick >/tmp/tmpl-health-verify.txt 2>&1 || { S=FAIL; m+=" sub:$(tail -1 /tmp/tmpl-health-verify.txt)"; }
echo "$(date -Is) $S cert=${days}d users=$(cat /etc/tmpl/users.count)$m" >> $L
