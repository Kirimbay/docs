# Деплой КвитQR на VPS с Hiddify

Боевой адрес (после DNS + install): **https://qr.vele.uk**

## 1. DNS

A-запись:

- `qr.vele.uk` → `138.124.242.142`

## 2. SSH для агента

На сервере (консоль хостера или свой SSH):

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
# вставьте публичный ключ из deploy/authorize-agent.sh
bash /path/to/authorize-agent.sh
```

Или одной строкой — см. `authorize-agent.sh`.

## 3. Установка с машины агента

```bash
QR_DOMAIN=qr.vele.uk SSH_KEY=/tmp/qr-ssh/id_ed25519 \
  ./deploy/remote-install.sh root@138.124.242.142
```

Поднимает:

- приложение в `/opt/kvitqr` (venv + uvicorn на `127.0.0.1:8787`)
- nginx TLS на `127.0.0.1:8788`
- systemd `kvitqr.service`
- snippet/backend для HAProxy Hiddify

## Проверка

```bash
curl -sS https://qr.vele.uk/api/health
# → {"status":"ok"}
```
