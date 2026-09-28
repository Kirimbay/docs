# Монитор столиков Uno Mas (TableCheck)

Бот, который каждые 15 минут проверяет свободные столики в [Uno Mas](https://www.tablecheck.com/en/shops/centara-mirage-beach-resort-dubai-uno-mas/reserve) и пишет вам в Telegram, когда появляется **новый** слот.

- Только смотрит доступность — **не бронирует** сам
- По умолчанию: **4 взрослых + 2 детей**
- У Uno Mas бронь открывается примерно **за 24 часа** и закрывается **за 5 часов** до еды

---

## Как пользоваться (по шагам)

### 1. Создайте Telegram-бота

1. Откройте [@BotFather](https://t.me/BotFather) → `/newbot` → придумайте имя
2. Скопируйте токен вида `123456:AAH...`
3. Напишите своему новому боту любое сообщение (например `hi`)
4. Откройте в браузере:  
   `https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates`  
   Найдите `"chat":{"id": 123456789}` — это ваш `TELEGRAM_CHAT_ID`

### 2. Настройте `.env`

```bash
cd tablecheck-monitor
cp .env.example .env
```

Минимум:

```env
TELEGRAM_BOT_TOKEN=123456:AAH...
TELEGRAM_CHAT_ID=123456789
NUM_ADULTS=4
NUM_CHILDREN=2
CHECK_INTERVAL_SEC=900
MEAL_FILTER=all
```

| Параметр | Значение |
|----------|----------|
| `MEAL_FILTER=all` | обед + ужин |
| `MEAL_FILTER=dinner` | только ужин (с 16:00 Dubai) |
| `MEAL_FILTER=lunch` | только обед |
| `CHECK_INTERVAL_SEC=900` | опрос раз в 15 минут |

### 3. Запуск на своём компьютере (быстрый тест)

```bash
pip install -r requirements.txt
python monitor.py notify-test   # должно прийти сообщение в Telegram
python monitor.py check         # показать свободные слоты сейчас
python monitor.py watch         # следить постоянно (окно не закрывать)
```

Когда придёт уведомление — сразу бронируйте по ссылке из сообщения.

---

## Куда разместить, чтобы работало 24/7

Нужен любой маленький Linux-сервер с интернетом. Ресурсы почти нулевые (один Python-процесс).

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **VPS** (Hetzner, Timeweb, DigitalOcean, Aeza…) | дёшево, стабильно | нужен SSH |
| **Ваш домашний ПК / ноутбук** | бесплатно | должен быть включён |
| **Raspberry Pi** | тихо, всегда дома | нужно настроить |
| **Бесплатные PaaS** (Railway, Render, Fly.io) | просто | иногда «засыпают», лимиты |

**Самый простой путь для 24/7:** любой дешёвый VPS + Docker или systemd ниже.

### Вариант A — Docker (удобно)

На сервере:

```bash
cd tablecheck-monitor
cp .env.example .env   # заполните токены
docker compose up -d --build
docker compose logs -f
```

Остановить: `docker compose down`

### Вариант B — systemd (без Docker)

```bash
# на сервере, из папки репозитория:
sudo bash deploy/install-systemd.sh /opt/uno-mas-monitor
# если .env ещё пустой — скрипт создаст его и остановится;
# заполните TELEGRAM_* и запустите снова
```

Полезные команды:

```bash
sudo systemctl status uno-mas-monitor
sudo journalctl -u uno-mas-monitor -f
sudo systemctl restart uno-mas-monitor
```

---

## Если дадите сервер — да, настрою

Могу поставить бота за вас, если пришлёте:

1. **SSH-доступ** (хост + пользователь; ключ или временный пароль)
2. **Telegram-токен** и **chat_id** (или создадите сами через BotFather)
3. Пожелания: только ужин / обед+ужин, интервал опроса

Не нужно root на весь мир — достаточно sudo или пользователя, который может поставить Docker/systemd.

После установки проверю `notify-test` и оставлю сервис автозапуском.

---

## Команды

| Команда | Что делает |
|---------|------------|
| `python monitor.py check` | Один раз проверить слоты |
| `python monitor.py watch` | Следить и слать Telegram при **новых** слотах |
| `python monitor.py notify-test` | Тест Telegram |

Уже отправленные слоты помнятся в `data/state.json`, чтобы не спамить одно и то же.

## Параллельно с ботом

Ресепшн отеля: **+971 4 522 9999** / `cdd@chr.co.th`  
Можно попросить concierge поставить в waitlist — у TableCheck нет кнопки «уведомить, когда освободится».

## Ограничения

- Не бронирует автоматически
- Интервал по умолчанию 15 минут — не уменьшайте без нужды
- Если TableCheck поменяет форму — скрипт нужно обновить
