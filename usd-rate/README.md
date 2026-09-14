# курс — доллар ЦБ РФ

Чистый полноэкранный курс USD→RUB по данным Центрального банка России.

**Сайт:** https://dollar.vele.uk

## Локально

```bash
cd usd-rate
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8790
```

Откройте http://127.0.0.1:8790

## API

| Endpoint | Описание |
|----------|----------|
| `GET /` | Лендинг с крупным курсом |
| `GET /api/rate` | JSON: value, previous, delta, date |
| `GET /api/health` | Healthcheck |

Источник: зеркало `cbr-xml-daily.ru` с запасным каналом `cbr.ru/XML_daily.asp`. Кэш ~5 минут.

## Деплой

См. [deploy/README.md](deploy/README.md) — тот же VPS, что и КвитQR (`qr.vele.uk`).
