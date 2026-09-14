# Деплой «курс» на VPS с Hiddify

Боевой адрес: **https://dollar.vele.uk**

## 1. DNS

A-запись:

- `dollar.vele.uk` → `138.124.242.142`

## 2. SSH для агента

На сервере (консоль хостера или свой SSH):

```bash
bash /path/to/authorize-agent.sh
```

## 3. Установка с машины агента

```bash
USD_DOMAIN=dollar.vele.uk SSH_KEY=/tmp/qr-ssh/id_ed25519 \
  ./deploy/remote-install.sh root@138.124.242.142
```

Поднимает:

- приложение в `/opt/usd-rate` (venv + uvicorn на `127.0.0.1:8790`)
- nginx TLS на `127.0.0.1:8791`
- systemd `usd-rate.service`
- snippet/backend для HAProxy Hiddify (`usd_rate`)

## Проверка

```bash
curl -sS https://dollar.vele.uk/api/health
# → {"status":"ok","usd":...,"date":"..."}
```
