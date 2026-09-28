# Монитор столиков Uno Mas (TableCheck)

Опрос доступности ресторана [Uno Mas — Centara Mirage Beach Resort Dubai](https://www.tablecheck.com/en/shops/centara-mirage-beach-resort-dubai-uno-mas/reserve) и Telegram-уведомления, когда появляется свободный слот.

- Только **чтение** публичной доступности — бронь **не** создаёт
- По умолчанию: **4 взрослых + 2 детей**, опрос каждые **15 минут**
- Важно: у Uno Mas бронь открывается примерно **за 24 часа** и закрывается **за 5 часов** до времени еды. Даты дальше окна всегда «заняты» / недоступны

## Почему кажется, что «всё занято»

На странице бронирования написано:

> bookings for Uno Mas can be made only **24 hours in advance** until **5 hours prior** to the mealtime

То есть смотреть неделю вперёд бессмысленно — слоты ещё не открыты. Монитор как раз ловит момент, когда открывается следующий день или появляется отмена.

Максимум гостей на форме — **6** (как раз ваш состав).

## Быстрый старт

### 1. Telegram-бот

1. [@BotFather](https://t.me/BotFather) → `/newbot` → скопируйте токен
2. Напишите боту любое сообщение
3. Узнайте свой `chat_id`: откройте  
   `https://api.telegram.org/bot<TOKEN>/getUpdates`  
   и найдите `"chat":{"id": ...}`

### 2. Установка

```bash
cd tablecheck-monitor
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

В `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
NUM_ADULTS=4
NUM_CHILDREN=2
CHECK_INTERVAL_SEC=900
DAYS=2
MEAL_FILTER=all
```

`MEAL_FILTER`: `all` | `lunch` | `dinner`

### 3. Проверка и запуск

```bash
python monitor.py check          # один проход, печать в консоль
python monitor.py notify-test    # тестовое сообщение в Telegram
python monitor.py watch          # цикл каждые 15 минут + уведомления о новых слотах
```

Окно должно оставаться открытым (или используйте systemd ниже).

Когда появится новый свободный слот — бот пришлёт дату/время и ссылку на бронь. Забронируйте вручную сразу: слоты уходят быстро.

## Команды

| Команда | Описание |
|--------|----------|
| `python monitor.py check` | Проверить доступность один раз |
| `python monitor.py watch` | Следить и слать Telegram при **новых** слотах |
| `python monitor.py notify-test` | Проверить Telegram |

Состояние «уже уведомляли» хранится в `data/state.json`.

## systemd (Linux, 24/7)

```ini
[Unit]
Description=Uno Mas TableCheck availability monitor
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/tablecheck-monitor
ExecStart=/path/to/tablecheck-monitor/.venv/bin/python monitor.py watch
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

## Параллельно с ботом — позвонить в отель

Ресепшн Centara Mirage: **+971 4 522 9999** / `cdd@chr.co.th`  
Можно попросить concierge/ресторан поставить в лист ожидания — у TableCheck нет гостевого «notify me» на свободные даты.

## Ограничения

- Не обходит очередь и не бронирует автоматически
- Уважайте сайт: интервал по умолчанию 15 минут, не уменьшайте без нужды
- TableCheck может изменить API формы — тогда скрипт нужно обновить
