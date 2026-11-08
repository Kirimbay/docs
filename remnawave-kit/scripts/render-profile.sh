#!/usr/bin/env bash
# Генерирует ключи Reality, shortId, случайный путь XHTTP, регистрирует WARP (wgcf)
# и собирает готовый Config Profile для Remnawave в ./out/config-profile.json
# Запускать на любой машине с Linux amd64 и интернетом (не обязательно на ноде).
# Использование: NODE_DOMAIN=cdn.example.com bash render-profile.sh
set -euo pipefail
: "${NODE_DOMAIN:?}"
HERE="$(dirname "$(readlink -f "$0")")"
OUT="$PWD/out"; mkdir -p "$OUT"; cd "$OUT"

need() { command -v "$1" >/dev/null || { echo "нужен $1"; exit 1; }; }
need curl; need unzip; need openssl; need jq

if [ ! -x ./xray ]; then
  curl -fsSL -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip
  unzip -o -q xray.zip xray && rm xray.zip
fi

if [ ! -x ./wgcf ]; then
  ver=$(curl -fsSL https://api.github.com/repos/ViRb3/wgcf/releases/latest | jq -r .tag_name)
  curl -fsSL -o wgcf "https://github.com/ViRb3/wgcf/releases/download/${ver}/wgcf_${ver#v}_linux_amd64"
  chmod +x wgcf
fi
if [ ! -f wgcf-account.toml ]; then ./wgcf register --accept-tos; fi
./wgcf generate
WARP_PRIV=$(awk -F' = ' '/^PrivateKey/{print $2}' wgcf-profile.conf)
WARP_V4=$(awk -F' = ' '/^Address/{print $2}' wgcf-profile.conf | tr ',' '\n' | grep -E '^[0-9.]+/' | head -1 | cut -d/ -f1)

x=$(./xray x25519)
REALITY_PRIV=$(printf '%s\n' "$x" | awk -F': ' '/PrivateKey|Private key/{print $2}')
REALITY_PUB=$(printf '%s\n' "$x" | awk -F': ' '/PublicKey|Public key|Password/{print $2; exit}')
SID1=$(openssl rand -hex 8)
SID2=$(openssl rand -hex 6)
PATH_SEG=$(openssl rand -hex 6)

sed -e "s|__XHTTP_PATH__|$PATH_SEG|" \
    -e "s|__NODE_DOMAIN__|$NODE_DOMAIN|" \
    -e "s|__REALITY_PRIVATE_KEY__|$REALITY_PRIV|" \
    -e "s|__SHORT_ID_1__|$SID1|" -e "s|__SHORT_ID_2__|$SID2|" \
    -e "s|__WARP_PRIVATE_KEY__|$WARP_PRIV|" -e "s|__WARP_ADDRESS_V4__|$WARP_V4|" \
    "$HERE/../profile/config-profile.json" > config-profile.json

./xray -test -config config-profile.json >/dev/null 2>&1 \
  && echo "xray -test: OK" \
  || { echo "xray -test: ОШИБКА (на машине может не быть geoip.dat; на ноде он есть)"; }

cat > host-values.txt <<EOF
Address (Host -> Address):  $NODE_DOMAIN
Port:                       443
SNI:                        $NODE_DOMAIN
Fingerprint:                firefox
ALPN:                       h2
Path:                       /$PATH_SEG
Public key (Reality):       $REALITY_PUB
Short ID:                   $SID1
xhttpExtraParams:           см. profile/host-xhttp-extra.json
EOF

chmod 600 config-profile.json host-values.txt wgcf-account.toml wgcf-profile.conf
echo
echo "Готово: $OUT/config-profile.json  и  $OUT/host-values.txt (секреты, не публикуй, не коммить)."
