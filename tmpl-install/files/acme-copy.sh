#!/bin/bash
D=$(cat /etc/tmpl/domain); A=/opt/hiddify-manager/acme.sh/lib/data/${D}_ecc
[ -s $A/fullchain.cer ] || A=/opt/hiddify-manager/acme.sh/lib/certs/${D}_ecc
if [ -s $A/fullchain.cer ] && ! cmp -s $A/fullchain.cer /etc/tmpl/$D.crt && openssl x509 -in $A/fullchain.cer -noout -checkend 86400 && openssl x509 -in $A/fullchain.cer -noout -issuer | grep -q "Let's Encrypt"; then
 install -m600 $A/$D.key /etc/tmpl/.$D.key.new && mv -f /etc/tmpl/.$D.key.new /etc/tmpl/$D.key; install -m644 $A/fullchain.cer /etc/tmpl/.$D.crt.new && mv -f /etc/tmpl/.$D.crt.new /etc/tmpl/$D.crt
 systemctl restart tmpl-xray tmpl-hy2; echo "$(date -Is) cert updated, tmpl restarted"; fi

# publish to haproxy SNI dir so https://$D/ (panel/sub) has matching cert
if [ -s /etc/tmpl/$D.crt ] && [ -s /etc/tmpl/$D.key ]; then
  install -m600 /etc/tmpl/$D.crt /opt/hiddify-manager/ssl/$D.crt
  install -m600 /etc/tmpl/$D.key /opt/hiddify-manager/ssl/$D.crt.key
fi
