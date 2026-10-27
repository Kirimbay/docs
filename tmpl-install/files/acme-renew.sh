#!/bin/bash
# daily: renew tmpl cert if due (LE HTTP-01 via haproxy:80 -> hiddify-nginx webroot, graceful reloads only),
# copy to /etc/tmpl (outside Hiddify ssl dir), restart tmpl-xray/hy2 only if cert changed.
D=$(cat /etc/tmpl/domain); AH=/opt/hiddify-manager/acme.sh/lib; A=$AH/data/${D}_ecc
$AH/acme.sh --home $AH --config-home $AH/data --renew -d $D --ecc -w /opt/hiddify-manager/acme.sh/www/ \
  --pre-hook "bash /etc/tmpl/acme-pre.sh" --post-hook "bash /etc/tmpl/acme-post.sh" --reloadcmd "bash /etc/tmpl/acme-copy.sh"
bash /etc/tmpl/acme-copy.sh
