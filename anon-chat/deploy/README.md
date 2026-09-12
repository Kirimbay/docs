# Деплой «Сарафана» на VPS с Hiddify

## Боевой адрес

- URL: https://chat.one.vele.uk
- Сервис: `komnata.service` на VPS (`127.0.0.1:3847`)
- Данные: `/var/lib/komnata/` (история, фото, VAPID, push-подписки)
- Приложение: `/opt/komnata/` (код; `data` и `uploads` — симлинки в `/var/lib/komnata`)
- Маршрут: HAProxy map `http_domain` → backend `komnata`
- TLS: Let's Encrypt в `/opt/hiddify-manager/ssl/chat.one.vele.uk.crt`

Hiddify занимает `:80` / `:443` (HAProxy). Чат ставится локально, наружу — через Host-based ACL в HAProxy.

## Бэкап и перенос на другую машину

Всё важное лежит в **одном каталоге** `/var/lib/komnata/`:

- `store.json` — сообщения и закрепы
- `uploads/` — фото
- `vapid.json` — ключи Web Push (нужны, чтобы старые уведомления продолжили работать)
- `push-subs.json` — подписки устройств

### Снять бэкап на текущем сервере

```bash
bash /opt/komnata/deploy/backup.sh /root/sarafan-backup.tar.gz
# или из репо:
DATA_DIR=/var/lib/komnata bash anon-chat/deploy/backup.sh ./sarafan-backup.tar.gz
```

### Восстановить на новом сервере

```bash
# 1) Поставь приложение (remote-install или скопируй /opt/komnata)
# 2) Скопируй архив и восстанови данные:
bash /opt/komnata/deploy/restore.sh /root/sarafan-backup.tar.gz
# 3) Перенеси DNS A-запись на новый IP, обнови TLS/HAProxy
```

Сохрани `ADMIN_PASSWORD` из unit-файла (`/etc/systemd/system/komnata.service`) — бэкап кладёт копию сервиса в архив и в `/root/komnata.service.from-backup`.

### Ежедневный бэкап (опционально)

```bash
mkdir -p /root/sarafan-backups /opt/komnata/deploy
cp anon-chat/deploy/backup.sh anon-chat/deploy/restore.sh /opt/komnata/deploy/
cp anon-chat/deploy/sarafan-backup.service anon-chat/deploy/sarafan-backup.timer /etc/systemd/system/
# fix ExecStart path date stamp: use backup.sh with fixed dir
systemctl daemon-reload
systemctl enable --now sarafan-backup.timer
```

## Сжатие фото

Новые загрузки жмутся в **WebP** (макс. сторона 1440px, качество ~68).  
Уже лежащие файлы можно пережать:

```bash
cd /opt/komnata && node deploy/recompress-uploads.js
# проверка без записи:
DRY_RUN=1 node deploy/recompress-uploads.js
```

Env: `IMAGE_MAX_PX`, `IMAGE_QUALITY`, `MAX_UPLOAD_MB`.

## 1. DNS

Создай A-запись (и при желании AAAA) для поддомена, например:

- `chat.one.vele.uk` → IP VPS (`138.124.242.142`)

Пока запись не указывает на сервер, публичный HTTPS для чата не заработает.

## 2. SSH для агента

На сервере (консоль хостера или свой SSH):

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMZd6u1b1kzuJVb3lHzqsVW5RHsrrdsUdyKhdNTE3nyw cursor-temp-20260820-chat' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Или: `bash anon-chat/deploy/authorize-agent.sh` (скопировать файл на сервер).

## 3. Установка с машины агента

```bash
CHAT_DOMAIN=chat.one.vele.uk \
ADMIN_PASSWORD='свой-секрет' \
SSH_KEY=/tmp/chat-ssh/id_ed25519 \
  bash anon-chat/deploy/remote-install.sh root@138.124.242.142
```

После установки: выпустить сертификат через Hiddify `acme.sh/get_cert.sh`, добавить backend `komnata` и строку в `maps/http_domain`, затем `systemctl reload hiddify-haproxy`.

## Сервисы

- `komnata.service` — Node-чат на `127.0.0.1:3847`
- HAProxy Host `chat.one.vele.uk` → backend `komnata`
- данные: `/var/lib/komnata/`
