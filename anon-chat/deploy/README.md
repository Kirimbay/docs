# Деплой «Комнаты» на VPS с Hiddify

## Боевой адрес

- URL: https://chat.one.vele.uk
- Сервис: `komnata.service` на VPS (`127.0.0.1:3847`)
- Данные: `/var/lib/komnata/`
- Маршрут: HAProxy map `http_domain` → backend `komnata` (+ файл `haproxy/komnata.cfg`)
- TLS: Let's Encrypt в `/opt/hiddify-manager/ssl/chat.one.vele.uk.crt`

Hiddify занимает `:80` / `:443` (HAProxy). Чат ставится локально, наружу — через Host-based ACL в HAProxy.

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
