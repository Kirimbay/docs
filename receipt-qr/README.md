# КвитQR

Мини-сервис: фото квитанции (ПД-4) → проверка полей → банковский QR (ST00012).

## Запуск

```bash
cd receipt-qr
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# нужен tesseract с русским:
#   sudo apt install tesseract-ocr tesseract-ocr-rus
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

Откройте http://127.0.0.1:8787

## Как пользоваться

1. Загрузите фото квитанции
2. Проверьте и поправьте поля (рукописное назначение почти всегда нужно править)
3. Нажмите «Сделать QR» и отсканируйте в приложении банка

Лицевой счёт (`л/с`) уходит в отдельное поле QR `PersAcc` и **не** дописывается в назначение.

## API

- `POST /api/parse` — multipart `file` → `{ fields, raw_text, hints }`
- `POST /api/qr` — JSON полей → `{ payload, data_url, png_base64 }`
- `POST /api/qr.png` — JSON → PNG-файл
- `GET /api/health`

## Тесты

```bash
cd receipt-qr
PYTHONPATH=. python3 -m pytest -q
```
