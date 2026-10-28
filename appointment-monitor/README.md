# Монитор записи к врачу (Дубна / Московская область)

Telegram-бот и CLI для мониторинга свободных талонов на [zdrav.mosreg.ru](https://zdrav.mosreg.ru/).

- Только **чтение** расписания — запись не создаёт
- Проверка каждые 5 минут (настраивается)
- Данные хранятся локально в папке `data/` на вашем компьютере
- Запускайте **в России** (ПК, ноутбук или VPS)

## Быстрый старт (Telegram-бот)

### 1. Создайте бота

1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot`
2. Скопируйте токен

### 2. Установка

```bash
cd appointment-monitor
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

В `.env` укажите только:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
CHECK_INTERVAL_SEC=300
DAYS=21
```

### 3. Запуск

```bash
python bot.py
```

Окно должно оставаться открытым (или используйте systemd — ниже).

### 4. Настройка в Telegram

1. Откройте своего бота → `/start`
2. `/polis 5040200838017611 01.12.2000` — ваш полис и дата рождения
3. `/departments` — выберите специальность → поликлинику в Дубне → «Подписаться»
4. `/check` — проверить сейчас
5. `/list` — ваши подписки

Когда появятся талоны — бот пришлёт сообщение. Записывайтесь сразу на [zdrav.mosreg.ru](https://zdrav.mosreg.ru/) или через [@eregistratura_mo_bot](https://t.me/eregistratura_mo_bot).

## Команды бота

| Команда | Описание |
|--------|----------|
| `/start`, `/help` | Справка |
| `/polis номер дата` | Сохранить полис ОМС |
| `/departments` | Выбрать специальность и поликлинику |
| `/list` | Список подписок |
| `/check` | Проверить все подписки сейчас |
| `/unfollow 1` | Удалить подписку по номеру из `/list` |
| `/me` | Ваши данные |
| `/delete` | Удалить все данные из бота |

## CLI-режим (без интерактива)

Если нужен простой скрипт для одного врача через `.env`:

```bash
# заполните OMS_NUMBER, OMS_BIRTHDAY, DEPARTMENT_ID, LPU_CODE, TELEGRAM_CHAT_ID
python monitor.py departments
python monitor.py watch
```

## systemd (Linux, чтобы работало 24/7)

```ini
[Unit]
Description=Zdrav appointment Telegram bot
After=network-online.target

[Service]
WorkingDirectory=/path/to/appointment-monitor
EnvironmentFile=/path/to/appointment-monitor/.env
ExecStart=/path/to/appointment-monitor/.venv/bin/python bot.py
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
```

## Когда ловить талоны

Новые окна часто открывают **около 7:00 в будни**. Имеет смысл держать бота включённым с утра. Также иногда появляются отменённые записи днём.

## Безопасность

- Не публикуйте `.env` и папку `data/`
- Бот неофициальный; полис хранится только у вас локально
- При смене API портала может потребоваться обновление

## Структура

```
appointment-monitor/
  bot.py           # Telegram-бот (основной режим)
  monitor.py       # CLI для одного пользователя
  zdrav_client.py  # API zdrav.mosreg.ru
  storage.py       # локальная база подписок
  data/            # создаётся при работе (не коммитить)
```
