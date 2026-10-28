# Деплой «курс» на VPS с Hiddify

Боевой адрес: **https://dollar.vele.uk**

## 1. DNS

A-запись:

- `dollar.vele.uk` → `138.124.242.142`

## 2. SSH для агента

На сервере (консоль хостера или свой SSH) — один раз:

```bash
# или содержимое usd-rate/deploy/authorize-agent.sh:
mkdir -p /root/.ssh && chmod 700 /root/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINRNSqGqxlpcISxN7xXPe/arc10/z1mB8WmvrvCrpe2W cursor-usd-rate-20260914' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
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
