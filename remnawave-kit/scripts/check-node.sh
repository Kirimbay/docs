#!/usr/bin/env bash
# Самопроверка ноды на самые частые причины палева. Запускать НА ноде.
# Использование: NODE_DOMAIN=cdn.example.com bash check-node.sh
set -u
: "${NODE_DOMAIN:?}"
ok(){ echo "[ OK ] $*"; }; bad(){ echo "[FAIL] $*"; }; warn(){ echo "[WARN] $*"; }

mine=$(curl -4fsS https://api.ipify.org || true)
res=$(getent ahostsv4 "$NODE_DOMAIN" | awk '{print $1; exit}')
[ "$mine" = "$res" ] && ok "DNS $NODE_DOMAIN -> $res совпадает с IP сервера" || bad "DNS $res != IP сервера $mine"

hdr=$(curl -sk --max-time 10 --resolve "$NODE_DOMAIN:443:127.0.0.1" -D - -o /dev/null "https://$NODE_DOMAIN/")
echo "$hdr" | head -1 | grep -q '200' && ok "https://$NODE_DOMAIN/ отдаёт 200 (сайт-заглушка через Xray fallback на Reality target)" || bad "заглушка не отвечает 200: $(echo "$hdr" | head -1)"
echo "$hdr" | grep -qi '^server:' && ok "есть заголовок Server" || warn "нет заголовка Server (зонд видит нетипичный сайт)"

st=$(curl -sk --max-time 10 --resolve "$NODE_DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$NODE_DOMAIN/nope-$RANDOM")
[ "$st" = 404 ] && ok "несуществующая страница -> 404 как у обычного сайта" || warn "несуществующая страница -> $st"

end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$NODE_DOMAIN" 2>/dev/null | openssl x509 -noout -enddate -issuer -dates 2>/dev/null)
echo "$end" | sed 's/^/       /'
nb=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$NODE_DOMAIN" 2>/dev/null | openssl x509 -noout -startdate -enddate 2>/dev/null)
if [ -n "$nb" ]; then
  s=$(date -d "$(echo "$nb" | sed -n 's/notBefore=//p')" +%s); e=$(date -d "$(echo "$nb" | sed -n 's/notAfter=//p')" +%s)
  days=$(( (e - s) / 86400 ))
  [ "$days" -ge 30 ] && ok "срок жизни сертификата $days дн." || bad "сертификат живёт всего $days дн. (короткие сертификаты считаются признаком прокси)"
fi

for p in 9443; do
  ss -ltn "( sport = :$p )" | grep -q "127.0.0.1:$p" && ok "порт $p слушает только на 127.0.0.1" || warn "порт $p не на 127.0.0.1 (или Caddy не запущен)"
done
ss -ltn | awk 'NR>1{print $4}' | grep -Ev '127\.0\.0\.1|\[::1\]|%lo' | sed 's/^/       слушает снаружи: /'

ver=$(docker exec remnanode xray version 2>/dev/null | head -1)
echo "       $ver"
echo "$ver" | grep -Eq 'Xray (2[6-9]|[3-9][0-9])\.' && ok "версия Xray свежая" || warn "проверь версию Xray (нужно >= 26.10.21)"

grep -qE '^\s*net\.ipv6\.conf\.all\.disable_ipv6\s*=\s*1' /etc/sysctl.conf /etc/sysctl.d/* 2>/dev/null && ok "IPv6 отключён" || warn "IPv6 включён: убедись, что нет утечки выхода с адреса входа"

echo
echo "Проверка выхода (должен быть IP Cloudflare WARP, НЕ IP сервера) — делай с клиента через VPN: curl https://ifconfig.co"
echo "Для проверки XMUX на живом клиенте: ss -tn state established '( sport = :443 )' | wc -l  (на клиенте/сервере должно быть 2-3 соединения на клиента)"
