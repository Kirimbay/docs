#!/bin/bash
# Template installer for Hiddify servers: extra configs (default 🦉 Сова, 🐅 Тигр, 🦆 Утка, 🐟 Рыба; optional 🦀 Краб) on separate
# xray/sing-box instances + subscription wrapper. Idempotent. See README.md.
# bash install.sh --domain <sub>.kirz.co.uk [--sub-domains "a,b"] [--animals сова,тигр,утка,рыба] [--ports 2053,8444,2083,36099]
#      [--disable-old yes|no] [--takeover] [--cf-ip <A-record IP>]   env: CF_API_TOKEN (optional, DNS-01 + A record)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); F=$HERE/files; T=/etc/tmpl; HM=/opt/hiddify-manager; TAKEOVER=no
XRAY_VER=26.2.6; SB_VER=1.12.12
declare -A SHA=([xray-amd64]=29ce535b56e207a406ffa1c2d4842dcc410be003eff8ec508bb732abc9f8e385 [xray-arm64]=b52d8263453fbd6f4747fd6a1ecf70cd43a664243615dc892ea4674c01b2b5ee
                [sb-amd64]=7c103cb2f9a7dc54cb82962043596718ed27989a478d6405f0939a9b775f889f [sbv-amd64]=91e646d2f8e16eb8535e4145d77999b5cdc1a5dd017ff1b29e6faf960493ca62 [sbv-arm64]=b4ce9cdf6ebffbb164d5b7a7c2791da7cadc48209c552bf32372556254826bc7 [sb-arm64]=fbdafe76b417ef96abea90d450859db9eb97f411abdf9be7cd7204695892c8f7)
DOMAIN=""; SUBD=""; PORTS=""; DISOLD=no; CFIP=""; ANIMALS="сова,тигр,утка,рыба"
while [ $# -gt 0 ]; do case $1 in
 --domain) DOMAIN=$2; shift 2;; --animals) ANIMALS=$2; shift 2;; --sub-domains) SUBD=$2; shift 2;; --ports) PORTS=$2; shift 2;;
 --disable-old) DISOLD=$2; shift 2;; --takeover) TAKEOVER=yes; shift;; --cf-ip) CFIP=$2; shift 2;; -h|--help) sed -n 2,6p "$0"; exit 0;;
 *) echo "unknown arg $1"; exit 2;; esac; done
log(){ echo "[$(date +%H:%M:%S)] $*"; }; die(){ echo "ERROR: $*" >&2; exit 1; }
[ $(id -u) = 0 ] || die "run as root"; [ -n "$DOMAIN" ] || die "--domain required"
[ -d $HM ] || die "Hiddify not found ($HM)"; [ -d $F ] || die "files/ dir missing next to install.sh"
HAP=$(python3 $F/hap-ins.py --find); [ -f "$HAP" ] || die "Hiddify haproxy config not found (checked hiddify-haproxy -f args)"
HVER=$(cat $HM/VERSION 2>/dev/null || cat $HM/hiddify-panel/VERSION 2>/dev/null || echo "?")
[ $TAKEOVER = yes ] && DISOLD=yes
case $DISOLD in yes|no) ;; *) die "--disable-old yes|no";; esac
# --animals: Russian (or latin) names, comma separated. сова=VLESS gRPC, тигр=Reality, краб=Trojan, утка=VMess, рыба=Hysteria2
AN=""; for a in $(python3 -c 'import sys;print(sys.argv[1].lower().replace(",", " ").replace(";", " "))' "$ANIMALS"); do case $a in
 сова|sova|owl) k=sova;; тигр|tigr|tiger) k=tigr;; краб|krab|crab) k=krab;; утка|utka|duck) k=utka;; рыба|ryba|fish) k=ryba;; *) die "unknown animal '$a' (сова,тигр,краб,утка,рыба)";; esac
 case " $AN " in *" $k "*) ;; *) AN="$AN $k";; esac; done; AN=${AN# }; [ -n "$AN" ] || die "--animals is empty"
has(){ case " $AN " in *" $1 "*) return 0;; esac; return 1; }
# --ports: one port per selected animal, in fixed order Сова,Тигр,Краб,Утка,Рыба (default 2053,8444,2083,36099 for the 4 default animals);
# 5 values = legacy full list. Unselected animals keep their default port (only used as template placeholder, never opened).
SOVA=2053; TIGR=8444; KRAB=2097; UTKA=2083; RYBA=36099
if [ -n "$PORTS" ]; then IFS=, read -ra PV <<<"$PORTS"; for p in "${PV[@]}"; do [[ $p =~ ^[0-9]+$ ]] && [ $p -ge 1 ] && [ $p -le 65535 ] || die "bad port '$p' in --ports"; done
  SEL=(); for k in sova tigr krab utka ryba; do has $k && SEL+=($k); done
  if [ ${#PV[@]} = 5 ]; then SOVA=${PV[0]}; TIGR=${PV[1]}; KRAB=${PV[2]}; UTKA=${PV[3]}; RYBA=${PV[4]}
  elif [ ${#PV[@]} = ${#SEL[@]} ]; then i=0; for k in "${SEL[@]}"; do eval "${k^^}=${PV[$i]}"; i=$((i+1)); done
  else die "--ports needs ${#SEL[@]} values (one per animal: ${SEL[*]}) or 5 (Сова,Тигр,Краб,Утка,Рыба)"; fi; fi
DUP=$(for k in $AN; do eval echo \$${k^^}; done | sort | uniq -d); [ -z "$DUP" ] || die "duplicate port(s) in --ports: $DUP"
PORTS=$(for k in $AN; do eval echo -n "$k=\$${k^^},"; done); PORTS=${PORTS%,}
OTCP=""; for k in sova tigr krab utka; do has $k && { eval "OTCP=\"\$OTCP \$${k^^}\""; }; done; OTCP=${OTCP# }; OUDP=""; has ryba && OUDP=$RYBA
OLDP=$(python3 -c "import json;print(*json.load(open('/etc/tmpl/params.json')).get('ports',[]))" 2>/dev/null)
CTCP=""; CUDP=""; set -- $OLDP $SOVA $TIGR $KRAB $UTKA $RYBA; i=0
for p in "$@"; do i=$((i+1)); r=$(( (i-1)%5 )); if [ $r = 4 ]; then [ "$p" = "$OUDP" ] || CUDP="$CUDP $p"; else case " $OTCP " in *" $p "*) ;; *) CTCP="$CTCP $p";; esac; fi; done
set --
TS=$(date +%Y%m%d-%H%M%S); B=/root/backup-tmpl-install-$TS; SUMMARY=()
sum(){ SUMMARY+=("$*"); log "$*"; }

# ---------- 1. backup ----------
log "backup -> $B"; mkdir -p $B/systemd
mysqldump hiddifypanel > $B/hiddifypanel.sql || die "DB dump failed"
tar czf $B/hiddify-manager.tgz --exclude='*/.venv*' --exclude='*/__pycache__' --exclude='*.log' --exclude='*/log/*' -C / opt/hiddify-manager 2>/dev/null
cp -a $HAP $B/haproxy.cfg
if [ -d $T ]; then tar czf $B/etc-tmpl.tgz -C / etc/tmpl; touch $B/had-tmpl; fi
cp -a /etc/systemd/system/tmpl-* $B/systemd/ 2>/dev/null; cp -a /etc/cron.d/tmpl-acme $B/ 2>/dev/null
systemctl list-unit-files 'tmpl-*' --no-legend 2>/dev/null | awk '$2=="enabled"{print $1}' > $B/tmpl-enabled.txt
iptables-save > $B/iptables.rules; ip6tables-save > $B/ip6tables.rules
mysql -N hiddifypanel -e "select \`key\`,value from bool_config where child_id=0" > $B/bool_config.tsv
cp -a "$HERE/rollback.sh" $B/ 2>/dev/null; echo "$B" > /root/.tmpl-last-backup
FAILED=0
abort(){ echo "FAILED: $*" >&2; log "rolling back from $B"; bash "$HERE/rollback.sh" "$B"; exit 1; }

# ---------- 2. detect ----------
CP=$(grep -oP 'path -i /\K[^/ ]+(?=/generate_204)' $HAP | head -1)
[ -n "$CP" ] || CP=$(mysql -N hiddifypanel -e "select value from str_config where child_id=0 and \`key\`='proxy_path_client'")
[ -n "$CP" ] || abort "cannot detect Hiddify client_path"
LP=$(mysql -N hiddifypanel -e "select value from str_config where child_id=0 and \`key\`='proxy_path'" 2>/dev/null)   # legacy (deprecated) sub path, also routed to tmpl-sub
AP=$(mysql -N hiddifypanel -e "select value from str_config where child_id=0 and \`key\`='proxy_path_admin'" 2>/dev/null) # admin path: old links /<admin>/<uuid>/ -> served via client path
PUBIP=$(curl -s4 --max-time 8 https://api.ipify.org || ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+')
[ -n "$SUBD" ] || SUBD=$(mysql -N hiddifypanel -e "select domain from domain where mode in ('direct','sub_link_only','cdn','relay','auto_cdn_ip')" | paste -sd,)
log "animals: $AN (tcp $OTCP udp ${OUDP:-none})"
log "SUBSCRIPTION PATHS: client proxy_path_client=$CP  legacy proxy_path=${LP:-EMPTY}  (old links need BOTH to stay the same; restore Hiddify settings, not only users)"
[ -n "$LP" ] || log "WARNING: legacy proxy_path is empty"
log "admin_path=${AP:+set} public_ip=$PUBIP sub_domains=$SUBD domain=$DOMAIN ports=$PORTS"
log "Hiddify version $HVER, haproxy config $HAP"
CONF=$(python3 $F/conflicts.py "${OTCP// /,}" "$OUDP") || abort "conflict detection failed"
if [ "$CONF" != "[]" ]; then
  echo "$CONF" > $B/conflicts.json
  echo "Port conflicts on template ports:"; echo "$CONF" | python3 -c "import json,sys
for c in json.load(sys.stdin): print(f\"  {c['proto']}/{c['port']}: {c['proc']} unit={c['unit']} kind={c['kind']} hiddify_keys={c['keys']}\")"
  BAD=$(echo "$CONF" | python3 -c "import json,sys;print(' '.join(f\"{c['proto']}/{c['port']}\" for c in json.load(sys.stdin) if c['kind']=='unknown' or any(k.startswith('!') for k in c['keys']) or (c['kind']=='hiddify' and not c['keys'])))")
  [ $TAKEOVER = yes ] || { echo "Aborting (nothing changed). Re-run with --takeover to stop these services / disable these Hiddify protocols, or choose --ports."; exit 3; }
  [ -z "$BAD" ] || { echo "Cannot take over automatically: $BAD (Hiddify tls/http port or unknown process). Use --ports. Nothing changed."; exit 3; }
  UNITS=$(echo "$CONF" | python3 -c "import json,sys;print(' '.join(sorted({c['unit'] for c in json.load(sys.stdin) if c['kind']=='service'})))")
  KEYS=$(echo "$CONF" | python3 -c "import json,sys;print(' '.join(sorted({k for c in json.load(sys.stdin) for k in c['keys']})))")
  if [ -n "$UNITS" ]; then echo $UNITS > $B/takeover-units.txt; for u in $UNITS; do systemctl disable --now $u || abort "stop $u"; done; sum "takeover: stopped+disabled $UNITS"; fi
  if [ -n "$KEYS" ]; then
    echo $KEYS >> $B/disabled-old.txt
    ( set +u; cd $HM && source common/utils.sh && activate_python_venv && for k in $KEYS; do hiddify-panel-cli set-setting -k $k -v False || exit 1; done ) || abort "set-setting"
    ( cd $HM && bash apply_configs.sh --no-gui ) > $B/apply-takeover.log 2>&1 || abort "apply_configs (takeover) failed"
    sum "takeover: disabled Hiddify $KEYS (apply OK)"; fi
  sleep 3; CONF=$(python3 $F/conflicts.py "${OTCP// /,}" "$OUDP"); [ "$CONF" = "[]" ] || abort "ports still busy after takeover: $CONF"
fi

# ---------- 3. binaries ----------
case $(uname -m) in x86_64) AR=amd64; XA=64;; aarch64) AR=arm64; XA=arm64-v8a;; *) abort "arch $(uname -m)";; esac
mkdir -p $T/bin $T/geo; chmod 700 $T
if ! $T/bin/tmpl-xray version 2>/dev/null | grep -q "Xray $XRAY_VER "; then
  W=$(mktemp -d); curl -sfL -o $W/x.zip https://github.com/XTLS/Xray-core/releases/download/v$XRAY_VER/Xray-linux-$XA.zip || abort "xray download"
  echo "${SHA[xray-$AR]}  $W/x.zip" | sha256sum -c --quiet || abort "xray sha256 mismatch"
  (cd $W && python3 -c "import zipfile;zipfile.ZipFile('x.zip').extract('xray')") && install -m755 $W/xray $T/bin/tmpl-xray.new && mv -f $T/bin/tmpl-xray.new $T/bin/tmpl-xray; rm -rf $W
  sum "installed xray $XRAY_VER"; fi
SBV=$F/bin/sing-box-$SB_VER-v2api-$AR; HY2STATS=false
if [ -f $SBV ] && echo "${SHA[sbv-$AR]}  $SBV" | sha256sum -c --quiet 2>/dev/null; then
  HY2STATS=true
  if ! $T/bin/tmpl-sing-box version 2>/dev/null | grep -q "with_v2ray_api"; then install -m755 $SBV $T/bin/tmpl-sing-box.new && mv -f $T/bin/tmpl-sing-box.new $T/bin/tmpl-sing-box; sum "installed sing-box $SB_VER (+v2ray_api, hy2 traffic stats)"; fi
elif ! $T/bin/tmpl-sing-box version 2>/dev/null | grep -q "version $SB_VER"; then
  W=$(mktemp -d); curl -sfL -o $W/s.tgz https://github.com/SagerNet/sing-box/releases/download/v$SB_VER/sing-box-$SB_VER-linux-$AR.tar.gz || abort "sing-box download"
  echo "${SHA[sb-$AR]}  $W/s.tgz" | sha256sum -c --quiet || abort "sing-box sha256 mismatch"
  tar xzf $W/s.tgz -C $W && install -m755 $W/sing-box-$SB_VER-linux-$AR/sing-box $T/bin/tmpl-sing-box.new && mv -f $T/bin/tmpl-sing-box.new $T/bin/tmpl-sing-box; rm -rf $W
  sum "installed official sing-box $SB_VER (WARNING: no v2ray_api -> hy2 traffic not counted)"; fi
$T/bin/tmpl-sing-box version 2>/dev/null | grep -q with_v2ray_api && HY2STATS=true
cp -n $HM/xray/bin/geo*.dat $T/geo/ 2>/dev/null; ls $T/geo/geoip.dat >/dev/null 2>&1 || abort "geo files missing"

# ---------- 4. params (reuse existing keys => existing client configs stay valid) ----------
AN="$AN" LP=$LP AP=$AP HY2STATS=$HY2STATS HAP=$HAP python3 - "$DOMAIN" "$CP" "$SUBD" "$SOVA,$TIGR,$KRAB,$UTKA,$RYBA" "$DISOLD" <<'PY' || abort "params"
import json,sys,os,secrets,string,subprocess
d,cp,subd,ports,dis=sys.argv[1:]
f='/etc/tmpl/params.json'; P=json.load(open(f)) if os.path.exists(f) else {}
rnd=lambda n:''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(n))
if not P.get('reality_priv'):
    o=subprocess.run(['/etc/tmpl/bin/tmpl-xray','x25519'],capture_output=True,text=True).stdout
    kv={l.split(':',1)[0].strip().lower():l.split(':',1)[1].strip() for l in o.splitlines() if ':' in l}
    P['reality_priv']=kv.get('privatekey') or kv['private key']; P['reality_pub']=kv.get('password') or kv['public key']
P.setdefault('short_id',secrets.token_hex(4)); P.setdefault('grpc_service',rnd(12))
P.setdefault('vmess_path','/'+rnd(14)); P.setdefault('trojan_path','/'+rnd(32)); P.setdefault('hy2_obfs',None)
P.update(hap_cfg=os.environ['HAP'],domain=d,host=d,client_path=cp,sub_domains=[x for x in subd.split(',') if x],ports=[int(x) for x in ports.split(',')])
P['animals']=os.environ['AN'].split(); P['legacy_path']=os.environ.get('LP') or None; P['admin_path']=os.environ.get('AP') or None
P['hy2_stats']=os.environ.get('HY2STATS')=='true'; P.setdefault('access_log',True)
P['filter_hiddify']=(dis=='yes') or bool(P.get('filter_hiddify',False))
open(f+'.new','w').write(json.dumps(P,indent=1)); os.chmod(f+'.new',0o600); os.replace(f+'.new',f)
PY
echo $DOMAIN > $T/domain.new && mv -f $T/domain.new $T/domain
[ -s $T/extra-uuids ] || { printf '# tmpl-test (template-only test user)\n%s\n' "$(cat /proc/sys/kernel/random/uuid)" > $T/extra-uuids.new && mv -f $T/extra-uuids.new $T/extra-uuids; }
TESTU=$(grep -v '^#' $T/extra-uuids | head -1)

# ---------- 5. files ----------
for f in stats.py v2stats.py conflicts.py sub.py hap-ins.py hook.sh sync.py fw.sh units.sh health.sh verify.py acme-copy.sh acme-pre.sh acme-post.sh acme-renew.sh; do
  sed -e "s/__SOVA__/$SOVA/g; s/__TIGR__/$TIGR/g; s/__KRAB__/$KRAB/g; s/__UTKA__/$UTKA/g; s/__RYBA__/$RYBA/g" $F/$f > $T/$f.new && chmod 755 $T/$f.new && mv -f $T/$f.new $T/$f
done
cp -a "$HERE/rollback.sh" $T/rollback.sh; chmod 755 $T/rollback.sh
cp -a "$HERE/disable-old.sh" $T/disable-old.sh; chmod 755 $T/disable-old.sh
printf 'OPEN_TCP="%s"\nOPEN_UDP="%s"\nCLOSE_TCP="%s"\nCLOSE_UDP="%s"\n' "$OTCP" "$OUDP" "${CTCP# }" "${CUDP# }" > $T/fw.ports.new && mv -f $T/fw.ports.new $T/fw.ports
# expected sha256 of every deployed file = exactly this tree (after port substitution); checked again after start
( cd $F && for f in stats.py v2stats.py conflicts.py sub.py hap-ins.py hook.sh sync.py fw.sh units.sh health.sh verify.py acme-copy.sh acme-pre.sh acme-post.sh acme-renew.sh; do
  sed -e "s/__SOVA__/$SOVA/g; s/__TIGR__/$TIGR/g; s/__KRAB__/$KRAB/g; s/__UTKA__/$UTKA/g; s/__RYBA__/$RYBA/g" $f | sha256sum | sed "s#-\$#$T/$f#"; done
  sha256sum "$HERE/rollback.sh" | sed "s#  .*#  $T/rollback.sh#"; sha256sum "$HERE/disable-old.sh" | sed "s#  .*#  $T/disable-old.sh#" ) > $T/files.sha256.new && mv -f $T/files.sha256.new $T/files.sha256
sha256sum --quiet -c $T/files.sha256 || abort "deployed files differ from the installer tree"
python3 -m py_compile $T/stats.py $T/v2stats.py $T/sub.py $T/sync.py $T/hap-ins.py $T/verify.py || abort "python syntax"

# ---------- 6. DNS record + certificate ----------
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "$CFIP" ]; then
  ZONE=$(echo $DOMAIN | awk -F. '{print $(NF-1)"."$NF}'); H="Authorization: Bearer $CF_API_TOKEN"
  ZID=$(curl -s -H "$H" "https://api.cloudflare.com/client/v4/zones?name=$ZONE" | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][0]['id'])") || abort "CF zone lookup"
  CUR=$(curl -s -H "$H" "https://api.cloudflare.com/client/v4/zones/$ZID/dns_records?type=A&name=$DOMAIN" | python3 -c "import json,sys;r=json.load(sys.stdin)['result'];print(r[0]['content'] if r else '')")
  if [ -z "$CUR" ]; then curl -sf -X POST -H "$H" -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4/zones/$ZID/dns_records" \
      -d "{\"type\":\"A\",\"name\":\"$DOMAIN\",\"content\":\"$CFIP\",\"proxied\":false,\"ttl\":120}" >/dev/null || abort "CF create A"; sum "created DNS A $DOMAIN -> $CFIP (DNS-only)"; sleep 20
  elif [ "$CUR" != "$CFIP" ]; then sum "WARNING: DNS A $DOMAIN = $CUR (not $CFIP) - left unchanged"; else sum "DNS A $DOMAIN -> $CFIP already present"; fi
fi
certok(){ [ -s $T/$DOMAIN.crt ] && openssl x509 -in $T/$DOMAIN.crt -noout -checkend $((15*86400)) >/dev/null && openssl x509 -in $T/$DOMAIN.crt -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$DOMAIN"; }
if ! certok; then
  AH=$HM/acme.sh/lib; [ -x $AH/acme.sh ] || abort "acme.sh not found in $AH"; A=$AH/data/${DOMAIN}_ecc; [ -s $A/fullchain.cer ] || [ ! -s $AH/certs/${DOMAIN}_ecc/fullchain.cer ] || A=$AH/certs/${DOMAIN}_ecc
  if [ -s $A/fullchain.cer ] && openssl x509 -in $A/fullchain.cer -noout -checkend $((15*86400)) >/dev/null; then :
  elif [ -n "${CF_API_TOKEN:-}" ]; then CF_Token=$CF_API_TOKEN $AH/acme.sh --home $AH --config-home $AH/data --issue -d $DOMAIN --ecc --server letsencrypt --dns dns_cf || abort "acme DNS-01 failed"
  else bash $T/acme-pre.sh; $AH/acme.sh --home $AH --config-home $AH/data --issue -d $DOMAIN --ecc --server letsencrypt -w $HM/acme.sh/www/; rc=$?; bash $T/acme-post.sh; [ $rc = 0 ] || abort "acme HTTP-01 failed (DNS A of $DOMAIN must reach this server port 80)"; fi
  bash $T/acme-copy.sh; certok || abort "certificate not installed"; sum "certificate for $DOMAIN issued/installed"
else sum "certificate for $DOMAIN valid, kept"; fi


# publish domain cert into haproxy SNI (needed for https://$DOMAIN/ admin+sub; animals ports use /etc/tmpl certs)
if [ -s $T/$DOMAIN.crt ] && [ -s $T/$DOMAIN.key ]; then
  install -m600 $T/$DOMAIN.crt /opt/hiddify-manager/ssl/$DOMAIN.crt
  install -m600 $T/$DOMAIN.key /opt/hiddify-manager/ssl/$DOMAIN.crt.key
  sum "haproxy SNI cert installed for $DOMAIN"
fi

# ---------- 7. units, sync, start ----------
bash $T/units.sh || abort "units.sh"
sed -i "s#^PathChanged=.*#PathChanged=$HAP#" /etc/systemd/system/tmpl-hook.path && systemctl daemon-reload
python3 $T/sync.py || abort "sync.py"
XRAY_LOCATION_ASSET=$T/geo $T/bin/tmpl-xray run -test -c $T/xray.json >/dev/null 2>&1 || abort "xray config test failed"
if has ryba; then $T/bin/tmpl-sing-box check -c $T/hy2.json || abort "hy2 config check failed"; else systemctl disable -q --now tmpl-hy2 2>/dev/null; rm -f $T/hy2.json; sum "Рыба not selected: tmpl-hy2 stopped+disabled"; fi
$T/fw.sh
# enable one by one (a single unknown unit made the old combined call enable NOTHING -> no reboot survival)
for u in tmpl-stats.timer tmpl-xray $(has ryba && echo tmpl-hy2) tmpl-sub tmpl-sync.timer tmpl-health.timer tmpl-hook.path tmpl-hook.timer; do systemctl enable -q $u && systemctl is-enabled -q $u || abort "enable $u"; done
systemctl restart tmpl-xray $(has ryba && echo tmpl-hy2) tmpl-sub && systemctl start tmpl-stats.timer tmpl-sync.timer tmpl-health.timer tmpl-hook.path tmpl-hook.timer || abort "start units"
r=$($T/hap-ins.py) || abort "hap-ins: $r"; [ "$r" = CHANGED ] && { systemctl reload hiddify-haproxy || abort "haproxy reload"; }
sleep 4
checkports(){ local p; for p in $OTCP; do ss -lntH "sport = :$p" | grep -q . || return 1; done; for p in $OUDP; do ss -lnuH "sport = :$p" | grep -q . || return 1; done
  for p in ${CTCP# }; do case " $OTCP " in *" $p "*) ;; *) [ "$p" = "$SOVA" ] && has tigr && continue; ss -lntpH "sport = :$p" | grep -q tmpl-xray && return 1;; esac; done; return 0; }
checkports || abort "template ports not listening"
systemctl is-active -q hiddify-haproxy || abort "hiddify-haproxy down"
sok=0; for i in 1 2 3 4 5 6; do n=$(wc -l </var/log/tmpl-stats.log 2>/dev/null || echo 0); python3 $T/stats.py || abort "tmpl-stats failed"; if tail -n +$((n+1)) /var/log/tmpl-stats.log 2>/dev/null | grep -q "WARN tmpl-xray"; then sleep 5; else sok=1; break; fi; done; [ $sok = 1 ] || abort "tmpl-stats cannot read xray stats"
sha256sum --quiet -c $T/files.sha256 || abort "post-install: deployed files differ from the installer tree (stale copy?)"
# Hiddify may regenerate haproxy.cfg right after install (panel apply) -> make sure our block is in place before verify
HC=$(python3 -c "import json;print(json.load(open('/etc/tmpl/params.json'))['hap_cfg'])")
for i in $(seq 1 20); do grep -q '# BEGIN tmpl-sub' "$HC" && systemctl is-active -q hiddify-haproxy && break; r=$($T/hap-ins.py) && [ "$r" = CHANGED ] && systemctl reload hiddify-haproxy; sleep 6; done
grep -q '# BEGIN tmpl-sub' "$HC" || abort "haproxy block keeps disappearing (Hiddify apply running?)"
vok=0; for i in 1 2 3; do systemctl reload hiddify-haproxy || abort "haproxy reload"; sleep 3; if $T/verify.py; then vok=1; break; fi; log "verify retry $i (re-insert haproxy block)"; r=$($T/hap-ins.py) && [ "$r" = CHANGED ] && systemctl reload hiddify-haproxy; sleep 15; done
log "verify (template added, Hiddify configs untouched)"; [ $vok = 1 ] || abort "verify failed"
[ -f $B/disabled-old.txt ] && cp $B/disabled-old.txt $T/
sum "template installed and verified: animals $AN, ports $PORTS, sub wrapper OK on $SUBD"

# ---------- 8. disable old Hiddify protocols (optional, separate script) ----------
if [ $DISOLD = yes ]; then bash $T/disable-old.sh || abort "disable-old failed (it already undid its own changes)"; sum "old Hiddify protocols disabled, strict verify PASS"; fi
echo; echo "================ SUMMARY ================"; printf ' - %s\n' "${SUMMARY[@]}"
echo " - SUBSCRIPTION PATHS: proxy_path_client=$CP  legacy proxy_path=${LP:-EMPTY}"; echo " - domain $DOMAIN  public IP $PUBIP  test user $TESTU"
echo " - Hiddify $HVER, haproxy cfg $HAP"
echo " - backup $B   rollback: bash $T/rollback.sh $B"
