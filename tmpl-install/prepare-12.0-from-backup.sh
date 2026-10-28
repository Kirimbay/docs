#!/bin/bash
# Перевод ноды Hiddify 12.3.x → рабочий сценарий как на 12.0.0 (под tmpl).
#
# ВАЖНО:
#  - Полную переустановку ОС этот скрипт НЕ делает (из SSH это нельзя безопасно).
#  - Схема: бэкап → чистая ОС → Hiddify 12.0.0 → restore → fix extra_params →
#    fix вкладки доменов (ident.me timeout) → apply → потом get.sh/tmpl.
#  - Restore в панели НЕ жмите дважды. Если делаете restore через этот скрипт — панель не трогайте.
#
# Использование:
#   1) На СТАРОЙ ноде (12.3.x), под root:
#        bash prepare-12.0-from-backup.sh export
#      Скопируйте каталог /root/hiddify-migrate-<ts>/ С СЕРВЕРА (scp/rsync) — после переустановки ОС он исчезнет.
#
#   2) Переустановите ОС (чистый Ubuntu 22.04), поставьте SSH, верните каталог migrate на новый сервер в /root/.
#
#   3) На НОВОЙ ОС, под root (migrate-каталог уже лежит в /root/hiddify-migrate-*):
#        bash prepare-12.0-from-backup.sh install-12.0
#        bash prepare-12.0-from-backup.sh restore-fix /root/hiddify-migrate-XXXX/panel-backup.json
#      или одной командой:
#        bash prepare-12.0-from-backup.sh after-os /root/hiddify-migrate-XXXX
#
#   4) Проверьте админку/подписки. Затем tmpl:
#        curl -fsSL https://ro1.kirz.co.uk:8090/get.sh | bash -s -- --domain xN.kirz.co.uk
#
set -euo pipefail

HM=/opt/hiddify-manager
TARGET_MGR_VER=12.0.0
TARGET_TAG=v12.0.0
MGR_ZIP_URL="https://github.com/hiddify/Hiddify-Manager/releases/download/${TARGET_TAG}/hiddify-manager.zip"

log(){ echo "[$(date +%H:%M:%S)] $*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }
need_root(){ [ "$(id -u)" = 0 ] || die "run as root"; }

activate_panel(){
  # shellcheck disable=SC1091
  source "$HM/common/utils.sh"
  activate_python_venv
}

cmd_export(){
  need_root
  [ -d "$HM" ] || die "Hiddify not found at $HM"
  local ver ts dest
  ver=$(cat "$HM/VERSION" 2>/dev/null || echo unknown)
  ts=$(date +%Y%m%d-%H%M%S)
  dest=/root/hiddify-migrate-$ts
  mkdir -p "$dest"
  log "export from Hiddify $ver -> $dest"

  # 1) panel JSON backup (тот же формат, что «Скачать бэкап» в админке)
  activate_panel
  local json_rel json_abs
  json_rel=$(hiddify-panel-cli backup | tee /tmp/hiddify-backup-path.txt | tail -1)
  # backup пишет относительный путь вида backup/YYYY_....json из cwd панели
  if [ -f "$HM/hiddify-panel/$json_rel" ]; then
    json_abs="$HM/hiddify-panel/$json_rel"
  elif [ -f "$json_rel" ]; then
    json_abs=$(readlink -f "$json_rel")
  else
    json_abs=$(ls -1t "$HM/hiddify-panel/backup/"*.json 2>/dev/null | head -1 || true)
  fi
  [ -n "${json_abs:-}" ] && [ -s "$json_abs" ] || die "panel backup json not found"
  cp -a "$json_abs" "$dest/panel-backup.json"
  log "panel-backup.json ($(wc -c <"$dest/panel-backup.json") bytes)"

  # 2) SQL dump (страховка; restore идёт из JSON)
  mysqldump hiddifypanel > "$dest/hiddifypanel.sql" || die "mysqldump failed"

  # 3) метаданные путей/доменов — чтобы сверить после restore
  mysql -N hiddifypanel -e "select \`key\`,value from str_config where child_id=0 and \`key\` in ('proxy_path','proxy_path_client','proxy_path_admin')" \
    > "$dest/paths.tsv" || true
  mysql -N hiddifypanel -e "select id,domain,mode from domain" > "$dest/domains.tsv" || true
  {
    echo "exported_at=$(date -Is)"
    echo "source_version=$ver"
    echo "hostname=$(hostname)"
    echo "ips=$(hostname -I)"
    echo "target_hiddify=$TARGET_MGR_VER"
  } > "$dest/META.txt"
  cat "$dest/paths.tsv" >> "$dest/META.txt" || true

  # 4) этот же скрипт + fix внутрь пакета (чтобы на новой ОС всё было под рукой)
  cp -a "$0" "$dest/prepare-12.0-from-backup.sh"
  chmod +x "$dest/prepare-12.0-from-backup.sh"

  tar czf "/root/hiddify-migrate-$ts.tgz" -C /root "hiddify-migrate-$ts"
  log "DONE export"
  echo
  echo "==================== СКОПИРУЙТЕ ОФФСАЙТ ===================="
  echo "  $dest/"
  echo "  /root/hiddify-migrate-$ts.tgz"
  echo "После переустановки ОС верните каталог в /root/ и продолжайте:"
  echo "  bash $dest/prepare-12.0-from-backup.sh after-os $dest"
  echo "============================================================"
}

cmd_install_12_0(){
  need_root
  if [ -d "$HM" ] && [ -f "$HM/VERSION" ]; then
    local cur; cur=$(cat "$HM/VERSION")
    if [ "$cur" = "$TARGET_MGR_VER" ]; then
      log "Hiddify $TARGET_MGR_VER already installed — skip install-12.0"
      return 0
    fi
    die "Found Hiddify $cur at $HM. Нужна ЧИСТАЯ ОС без другой версии. Снесите / переустановите ОС, либо удалите Hiddify вручную."
  fi

  log "Installing Hiddify Manager $TARGET_MGR_VER from $MGR_ZIP_URL"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl unzip ca-certificates

  local W; W=$(mktemp -d)
  curl -fL "$MGR_ZIP_URL" -o "$W/hiddify-manager.zip" || die "download failed"
  mkdir -p /opt
  rm -rf /opt/hiddify-manager
  unzip -q -o "$W/hiddify-manager.zip" -d /opt
  # zip может распаковаться как /opt/hiddify-manager или /opt/<subdir>
  if [ ! -d /opt/hiddify-manager ]; then
    local sub; sub=$(find /opt -maxdepth 1 -type d -name 'hiddify*' | head -1)
    [ -n "$sub" ] || die "unzip layout unexpected"
    mv "$sub" /opt/hiddify-manager
  fi
  ln -sfn /opt/hiddify-manager /opt/hiddify-config
  cd /opt/hiddify-manager
  # тихая установка без GUI
  bash install.sh --no-gui 2>&1 | tee /root/hiddify-12.0-install.log || {
    # некоторые сборки не принимают --no-gui
    bash install.sh 2>&1 | tee -a /root/hiddify-12.0-install.log
  }
  local ver; ver=$(cat /opt/hiddify-manager/VERSION 2>/dev/null || echo '?')
  log "installed VERSION=$ver (want $TARGET_MGR_VER)"
  [ "$ver" = "$TARGET_MGR_VER" ] || log "WARNING: VERSION file is $ver — проверьте вручную"
  rm -rf "$W"
  log "Hiddify 12.0 install finished. Дальше: restore-fix"
}

fix_extra_params(){
  # Памятка dwl: extra_params после restore с 12.3 → 12.0 иногда literal Python вместо JSON
  activate_panel
  hiddify-panel-cli shell <<'PY'
import json, ast
from hiddifypanel.models import Domain
from hiddifypanel.database import db

def fix(v):
    try:
        json.loads(v or "{}"); return v
    except Exception:
        try:
            return json.dumps(ast.literal_eval(v))
        except Exception:
            return "{}"

bad = [(d.id, d.domain, d.extra_params) for d in Domain.query.all() if fix(d.extra_params) != d.extra_params]
print("BAD:", bad)
for d in Domain.query.all():
    d.extra_params = fix(d.extra_params)
db.session.commit()
print("fixed:", len(bad))
PY
}

fix_domain_tab_identme(){
  # Вкладка «Домены» в админке зависает: ident.me без timeout.
  # Патч: urllib.request.urlopen(...ident.me...) → timeout=2
  python3 - <<'PY'
from pathlib import Path
files = list(Path("/opt/hiddify-manager").glob(".venv*/lib/python*/site-packages/hiddifypanel/hutils/network/net.py"))
if not files:
    raise SystemExit("net.py not found")
p = files[0]
t = p.read_text()
old = "urllib.request.urlopen(f'https://v{version}.ident.me/')"
new = "urllib.request.urlopen(f'https://v{version}.ident.me/', timeout=2)"
if new in t:
    print("already patched", p)
else:
    if old not in t:
        raise SystemExit("pattern not found in %s" % p)
    p.write_text(t.replace(old, new))
    print("patched", p)
PY
  systemctl restart hiddify-panel
  log "domain-tab ident.me timeout patched; hiddify-panel restarted"
}

cmd_restore_fix(){
  need_root
  local json=${1:-}
  [ -n "$json" ] || die "usage: $0 restore-fix /path/to/panel-backup.json"
  [ -s "$json" ] || die "backup json missing: $json"
  [ -d "$HM" ] || die "Hiddify not installed"
  local ver; ver=$(cat "$HM/VERSION" 2>/dev/null || echo '?')
  log "restore-fix on Hiddify $ver from $json"

  activate_panel
  # Эквивалент панели: users + domains + settings (как «обязательно включи восстановление настроек»)
  HIDDIFY_RESTORE_JSON=$json hiddify-panel-cli shell <<'PY'
import json, os
from hiddifypanel.panel import hiddify
from hiddifypanel.models import User, ConfigEnum, set_hconfig

path = os.environ["HIDDIFY_RESTORE_JSON"]
data = json.load(open(path, encoding="utf-8"))
set_hconfig(ConfigEnum.first_setup, False)
hiddify.set_db_from_json(
    data,
    set_users=True,
    set_domains=True,
    set_settings=True,
    set_admins=True,
    override_unique_id=False,
    override_child_unique_id=True,
    override_root_admin=False,
)
# убрать дефолтного юзера id=1 если появился (как в Backup.py)
if default := User.by_id(1):
    try:
        default.remove()
    except Exception as e:
        print("default user remove:", e)
print("set_db_from_json OK")
PY

  log "fix extra_params (Python-literal → JSON)"
  fix_extra_params

  log "fix domain tab (ident.me timeout)"
  fix_domain_tab_identme

  log "apply_configs.sh"
  (cd "$HM" && bash apply_configs.sh --no-gui) 2>&1 | tee /root/hiddify-restore-apply.log || \
    (cd "$HM" && bash apply_configs.sh) 2>&1 | tee -a /root/hiddify-restore-apply.log

  log "paths after restore:"
  mysql -N hiddifypanel -e "select \`key\`,value from str_config where child_id=0 and \`key\` in ('proxy_path','proxy_path_client','proxy_path_admin')" || true
  echo
  log "DONE restore-fix"
  echo "Проверьте админку ОДИН раз (не жмите Restore в UI повторно)."
  echo "Если админка/домены ок — ставьте tmpl:"
  echo "  curl -fsSL https://ro1.kirz.co.uk:8090/get.sh | bash -s -- --domain xN.kirz.co.uk"
}

cmd_after_os(){
  need_root
  local pack=${1:-}
  [ -n "$pack" ] || die "usage: $0 after-os /root/hiddify-migrate-XXXX"
  [ -d "$pack" ] || die "migrate pack not found: $pack"
  [ -s "$pack/panel-backup.json" ] || die "missing $pack/panel-backup.json"
  cmd_install_12_0
  cmd_restore_fix "$pack/panel-backup.json"
  cp -a "$pack/META.txt" /root/hiddify-migrate-META.txt 2>/dev/null || true
  log "Сверьте paths с META.txt (proxy_path / proxy_path_client должны совпасть со старым сервером)"
}

cmd_fix_only(){
  need_root
  [ -d "$HM" ] || die "Hiddify not found"
  fix_extra_params
  fix_domain_tab_identme
  (cd "$HM" && bash apply_configs.sh --no-gui) 2>&1 | tee /root/hiddify-fix-apply.log || \
    (cd "$HM" && bash apply_configs.sh) 2>&1 | tee -a /root/hiddify-fix-apply.log
  log "fix-only done"
}

usage(){
  sed -n '2,35p' "$0"
  echo
  echo "Commands:"
  echo "  export                         — бэкап JSON+SQL+META на текущей (12.3.x) ноде"
  echo "  install-12.0                   — поставить Hiddify 12.0.0 на ЧИСТОЙ ОС"
  echo "  restore-fix <panel-backup.json> — restore + fix extra_params + domain-tab + apply_configs"
  echo "  after-os <migrate-dir>         — install-12.0 + restore-fix"
  echo "  fix-only                       — extra_params + domain-tab + apply (если рестор уже в UI)"
}

main(){
  local cmd=${1:-}
  shift || true
  case "$cmd" in
    export) cmd_export "$@";;
    install-12.0|install-12.0.0) cmd_install_12_0 "$@";;
    restore-fix) cmd_restore_fix "$@";;
    after-os) cmd_after_os "$@";;
    fix-only) cmd_fix_only "$@";;
    -h|--help|help|"") usage;;
    *) die "unknown command: $cmd (see --help)";;
  esac
}

main "$@"
