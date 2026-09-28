# Монитор столиков Uno Mas (TableCheck)

Telegram-бот для [Uno Mas](https://www.tablecheck.com/en/shops/centara-mirage-beach-resort-dubai-uno-mas/reserve) с кнопками:

- **▶ Старт мониторинг** — проверять свободные столики каждые 15 мин
- **⏹ Стоп мониторинг** — молчать (удобно после брони)
- **🔍 Проверить сейчас** — один раз, без включения слежения
- **ℹ️ Статус** — включён ли мониторинг

Только смотрит доступность — **не бронирует** сам.  
По умолчанию: **4 взрослых + 2 детей**.  
У Uno Mas бронь открывается примерно **за 24 часа** и закрывается **за 5 часов** до еды.

---

## Быстрый старт

1. [@BotFather](https://t.me/BotFather) → `/newbot` → токен  
2. Настройка:

```bash
cd tablecheck-monitor
cp .env.example .env
# TELEGRAM_BOT_TOKEN=...
pip install -r requirements.txt
python bot.py
```

3. В Telegram: `/start` → появятся кнопки. После брони нажмите **Стоп**.

`MEAL_FILTER`: `all` | `lunch` | `dinner`

CLI без кнопок: `python monitor.py check`

---

## Деплой 24/7

### Docker

```bash
cp .env.example .env   # заполните токен
docker compose up -d --build
```

### systemd

```bash
sudo bash deploy/install-systemd.sh /opt/uno-mas-monitor
```

Сервис запускает `bot.py`. Команды:

```bash
sudo systemctl status uno-mas-monitor
sudo journalctl -u uno-mas-monitor -f
```

---

## Если дать сервер

Нужны SSH + токен бота — можно поставить удалённо.

Ресепшн отеля: **+971 4 522 9999** / `cdd@chr.co.th`
