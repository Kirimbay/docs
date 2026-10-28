# курс — USD · EUR · CNY · BTC

Секции курсов: доллар, евро и юань по ЦБ РФ + биткоин (CoinGecko).

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
| `GET /` | Лендинг с секциями |
| `GET /api/rates` | JSON со всеми курсами |
| `GET /api/health` | Healthcheck |

Источники: `cbr-xml-daily.ru` (+ XML ЦБ) и CoinGecko. Кэш ~5 минут.

## Деплой

См. [deploy/README.md](deploy/README.md) — тот же VPS, что и КвитQR (`qr.vele.uk`).
