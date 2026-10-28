set -e
mkdir -p /etc/tmpl/bin /etc/tmpl/geo; cp -n /opt/hiddify-manager/xray/bin/geo*.dat /etc/tmpl/geo/ 2>/dev/null || true
w(){ cat > /etc/systemd/system/.$1.new && mv -f /etc/systemd/system/.$1.new /etc/systemd/system/$1; }  # atomic
w tmpl-xray.service <<U
[Unit]
Description=Template xray (Сова __SOVA__, Тигр __TIGR__, Краб Trojan __KRAB__, VMess __UTKA__) - separate from Hiddify
After=network-online.target mariadb.service
Wants=network-online.target
[Service]
Environment=XRAY_LOCATION_ASSET=/etc/tmpl/geo
ExecStartPre=/etc/tmpl/fw.sh
ExecStart=/etc/tmpl/bin/tmpl-xray run -c /etc/tmpl/xray.json
Restart=always
TimeoutStopSec=5
RestartSec=3
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
U
w tmpl-hy2.service <<U
[Unit]
Description=Template Hysteria2 (Рыба UDP __RYBA__) sing-box
After=network-online.target mariadb.service
Wants=network-online.target
[Service]
ExecStartPre=/etc/tmpl/fw.sh
ExecStart=/etc/tmpl/bin/tmpl-sing-box run -c /etc/tmpl/hy2.json
Restart=always
TimeoutStopSec=5
RestartSec=3
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
U
w tmpl-sub.service <<U
[Unit]
Description=Template subscription wrapper 127.0.0.1:2099
After=network-online.target
[Service]
ExecStart=/usr/bin/python3 /etc/tmpl/sub.py
Restart=always
TimeoutStopSec=5
[Install]
WantedBy=multi-user.target
U
w tmpl-sync.service <<U
[Unit]
Description=Template user sync from Hiddify DB
After=mariadb.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /etc/tmpl/sync.py
U
w tmpl-sync.timer <<U
[Timer]
OnBootSec=30
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
U
w tmpl-hook.service <<U
[Unit]
Description=Re-apply template haproxy block + firewall after Hiddify apply
[Service]
Type=oneshot
ExecStart=/etc/tmpl/hook.sh
U
w tmpl-hook.timer <<U
[Timer]
OnBootSec=40
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
U
w tmpl-hook.path <<U
[Path]
PathChanged=/opt/hiddify-manager/haproxy/haproxy.cfg
Unit=tmpl-hook.service
[Install]
WantedBy=multi-user.target
U
w tmpl-health.service <<U
[Service]
Type=oneshot
ExecStart=/etc/tmpl/health.sh
U
w tmpl-health.timer <<U
[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
U
w tmpl-stats.service <<U
[Unit]
Description=Template traffic -> Hiddify usage (xray + hy2 stats, reset-on-read, spooled)
After=mariadb.service tmpl-xray.service
[Service]
Type=oneshot
TimeoutStartSec=120
ExecStart=/usr/bin/python3 /etc/tmpl/stats.py
U
w tmpl-stats.timer <<U
[Timer]
OnBootSec=90
OnUnitActiveSec=60
AccuracySec=5s
[Install]
WantedBy=timers.target
U
# find torrent watcher (if installed) reads the shared RAM access log: order it after tmpl-xray too
if [ -f /etc/systemd/system/kirvpn-torrent-watcher.service ]; then mkdir -p /etc/systemd/system/kirvpn-torrent-watcher.service.d
 printf '[Unit]\nAfter=tmpl-xray.service\nWants=tmpl-xray.service\n' > /etc/systemd/system/kirvpn-torrent-watcher.service.d/tmpl.conf; fi
echo '17 3 * * * root /etc/tmpl/acme-renew.sh >> /var/log/tmpl-acme.log 2>&1' > /etc/cron.d/tmpl-acme
systemctl daemon-reload
