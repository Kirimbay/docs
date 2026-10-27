#!/bin/bash
# graceful (reload, not restart) acme webroot enable for tmpl domain
mkdir -p /opt/hiddify-manager/acme.sh/www/.well-known/acme-challenge
echo "location /.well-known/acme-challenge {root /opt/hiddify-manager/acme.sh/www/;}" >/opt/hiddify-manager/nginx/parts/acme.conf
chown -R nginx /opt/hiddify-manager/acme.sh/www/; systemctl reload hiddify-nginx
