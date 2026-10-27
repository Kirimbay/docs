# Hiddify template installer (🦉 Сова, 🐅 Тигр, 🦆 Утка, 🐟 Рыба; optional 🦀 Краб)

Built from the live server-20 template (2026-10-26). Copy the whole directory (install.sh, rollback.sh, files/) to the server.

    scp -r tmpl-install root@SERVER:/root/
    bash /root/tmpl-install/install.sh --domain ro1.kirz.co.uk --sub-domains "x.kirvpn.ru,x.kirvpn.us" \
         [--animals сова,тигр,утка,рыба] [--ports 2053,8444,2083,36099] [--disable-old no|yes] [--takeover] [--cf-ip RELAY_OR_SERVER_IP]
    # optional env CF_API_TOKEN: cert via Cloudflare DNS-01, and with --cf-ip creates DNS-only A record if absent

Default animals: Сова (VLESS gRPC TLS, 2053), Тигр (VLESS Reality vision, dest 127.0.0.1:<Сова>, 8444), Утка (VMess WS TLS, 2083),
Рыба (Hysteria2 UDP, 36099). Optional: Краб (Trojan HTTPUpgrade TLS, 2097) - NOT in the default set (did not work for testers);
enable only explicitly with `--animals сова,тигр,краб,утка,рыба`.
`--ports`: one value per selected animal, in fixed order Сова,Тигр,Краб,Утка,Рыба (skip the ones not selected), e.g. default
2053,8444,2083,36099; with краб: 2053,8444,2097,2083,36099. A 5-value list is always read as the full Сова,Тигр,Краб,Утка,Рыба order.
Re-running with the defaults on a server that had Краб removes it (inbound, port 2097, firewall rule, subscription entry).

What it does (idempotent, safe to re-run):
1. Full backup -> /root/backup-tmpl-install-<time>/ (DB dump, /opt/hiddify-manager tgz, haproxy.cfg, /etc/tmpl, tmpl units, iptables, bool_config).
2. Detects client_path (haproxy generate_204 line / DB proxy_path_client), public IP, sub domains (DB if not given); checks ports free.
3. Downloads pinned xray 26.2.6 + sing-box 1.12.12 (sha256 verified, amd64/arm64) into /etc/tmpl/bin.
4. params.json: reuses existing Reality keys/shortId/paths if present (existing clients keep working), else generates new.
5. Installs sub.py (links for plain/base64, JSON injection for HiddifyNext/sing-box incl. empty groups, filter switch
   params.json "filter_hiddify"), hap-ins.py (rule in ALL http frontends incl. HTTP/3 QUIC; any GET /<client|legacy|admin path>/[child/]<uuid>[/...] regardless of UA/headers/query; haproxy retries if tmpl-sub restarts), hook, sync, fw, health, verify, acme renew cron.
6. Cert: keeps valid cert; else LE via Hiddify acme.sh (HTTP-01 webroot through Hiddify nginx, or DNS-01 with CF_API_TOKEN).
7. Units enabled (survive reboot); tmpl-hook.path/timer re-insert the haproxy block after every apply_configs/reboot.
8. verify.py: all sub domains x paths x Happ/v2rayN/HiddifyNext/SFI, sing-box check of outbounds. Any failure -> automatic rollback.
9. --disable-old yes: only after verify PASS, disables Hiddify protocols present in a real user's sub (reality, hysteria2, tuic,
   ss2022, ssh, wireguard, mieru, naive; plain TLS transports are reported, not touched), apply_configs.sh --no-gui,
   waits for hook, strict verify (exactly the enabled animals). Failure -> rollback (re-enables + apply).

Rollback: `bash /etc/tmpl/rollback.sh [/root/backup-tmpl-install-<time>] [--restore-db]`
Re-enables disabled protocols (+apply), removes units/cron/haproxy block/fw rules, restores a previous /etc/tmpl (and its units) if one existed.
Check anytime: `/etc/tmpl/verify.py [--strict]`, log /var/log/tmpl-health.log.
Test user (template-only, not in Hiddify DB): first UUID in /etc/tmpl/extra-uuids — sub.py serves it the enabled animals directly.

Port conflicts / --takeover: before touching anything, files/conflicts.py lists every process on the template ports
(systemd unit + matching Hiddify setting, e.g. hysteria_port -> hysteria_enable, special_port -> reality_enable).
Without --takeover the installer aborts with that list (exit 3, nothing changed). With --takeover (implies --disable-old yes):
other services (e.g. CustomProxy, zmeya-xray) are stopped+disabled (takeover-units.txt), matching Hiddify protocols are
turned off (+apply). Ports held by Hiddify tls_ports/http_ports or unknown processes are never taken over: use --ports.
Rollback re-enables both.

Hiddify 14 / other layouts: haproxy config = the file loaded by hiddify-haproxy (-f args, file or dir; stored as params hap_cfg,
watched by tmpl-hook.path). hap-ins.py uses the classic anchors if present, otherwise inserts before the first path-based
use_backend rule of every frontend; if none found or `haproxy -c` fails, it changes nothing and exits 1 (installer aborts+rolls back).

tmpl-sync (every 60s): user changes are applied to tmpl-xray live via xray API (adu/rmu) - no restart; restart only when
inbound settings change. tmpl-hy2 (sing-box, no user API) restarts only when the user list actually changes.
Sub fallback: if Hiddify returns empty/404/302/5xx (all its protocols disabled), known client UAs (Happ, v2rayN/NG, Hiddify,
sing-box SFI/SFA, Streisand, Shadowrocket, Nekobox, Karing, ...) still get the enabled animals (JSON for Hiddify/sing-box).

## 2026-10-26 additions
- One-liner: `curl -fsSL https://ro1.kirz.co.uk:8090/get.sh | bash -s -- --domain x<N>.kirz.co.uk` (dist built by ../dist/build.sh; get.sh checks the tarball's sha256).
- Relay: `get.sh ... | bash -s -- --relay --exit EXIT_IP [--keep 22,8090]` (or `relay.sh`; `--remove` undoes). Own chains TMPL-RELAY (nat PREROUTING, only dst-type LOCAL, not lo), TMPL-RELAY-POST (MASQUERADE to exit), TMPL-RELAY-FWD; ip_forward in /etc/sysctl.d/99-tmpl-relay.conf; saved via netfilter-persistent. Re-run replaces rules. UDP 443 is NOT forwarded: nat PREROUTING #1 `-p udp --dport 443 -j RETURN` + INPUT #1 REJECT icmp-port-unreachable (no HTTP/3; other UDP e.g. 24328/24329/36099 and all TCP unaffected), saved to /etc/iptables/rules.v4.
- `--animals` (Russian or latin names, default сова,тигр,утка,рыба; краб optional). Re-running with fewer animals removes the dropped ones: inbound, port, firewall rule and subscription entry.
- `disable-old.sh [--undo]`: backs up, sets the DB flags, restarts hiddify-panel and background-tasks, clears Hiddify's proxy cache, runs apply_configs, then `verify --strict` (only animals allowed). Any failure triggers an automatic undo.
- The tmpl-sub rule goes into every path-routing frontend, including in-httpmode-quic (HTTP/3); verify checks this. The sha256 of every deployed file is checked after install.
- New server: restore the Hiddify backup WITH settings. Both paths (proxy_path_client and legacy proxy_path) come from the settings, not from the users.
- No HTTP/3 Alt-Svc (Happ caches `Alt-Svc: h3`, MTS LTE drops UDP 443 -> sub timeouts): hap-ins.py comments out (`# tmpl-h3 `) every
  alt-svc h3 line in the loaded haproxy cfg and in /opt/hiddify-manager/haproxy/ templates (backups `*.bak-h3`, so panel updates/apply_configs
  don't bring it back) and adds `http-response set-header alt-svc clear` to every http frontend; `haproxy -c` before reload. rollback.sh
  restores templates from `*.bak-h3` and un-comments the cfg. verify.py fails if Alt-Svc on / or sub paths contains h3.
