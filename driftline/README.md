# Driftline

Driftline — стол, который перечитывает публичные страницы и оставляет заметку, когда меняется текст. Это маленький продукт с подпиской, а не автомат «запустил и пошли деньги».

Полный разбор, почему выбрана именно эта модель, лежит в [BUSINESS_PLAN.md](BUSINESS_PLAN.md).

## Запуск

Нужен Node.js 22 или новее.

```bash
cd driftline
npm start
```

Стол открывается на [http://127.0.0.1:8787](http://127.0.0.1:8787). Вне этого компьютера слушай все интерфейсы: `HOST=0.0.0.0 PORT=8787 npm start`.

Проверки: `npm test`.

## Как увидеть, что петля работает

1. Открой бесплатный стол и добавь страницу `http://127.0.0.1:8787/sample/catalog` с фокусом `Price`.
2. На образце нажми «Raise the sample price by $1».
3. Вернись к странице и нажми Check now. В заметке будет старая и новая цена.

Пока процесс запущен, те же проверки идут сами каждые 20 секунд. Снаружи тот же проход можно дернуть так:

```bash
curl -X POST -H "x-driftline-cron: $DRIFTLINE_CRON_SECRET" http://127.0.0.1:8787/ops/run
```

Ручка `/ops/run` отвечает 404, пока секрет не задан.

## Когда появляются деньги

Бесплатный план работает без ключей. Платные планы включаются только после твоих аккаунтов:

| Переменная | Зачем |
| --- | --- |
| `PUBLIC_BASE_URL` | Адрес стола, например `https://desk.example.com` |
| `STRIPE_SECRET_KEY` | Секретный ключ Stripe |
| `STRIPE_WEBHOOK_SECRET` | Секрет подписи вебхука на `/billing/webhook` |
| `STRIPE_PRICE_STUDIO` | Price id подписки Studio, $15/мес |
| `STRIPE_PRICE_DESK` | Price id подписки Desk, $39/мес |
| `RESEND_API_KEY` и `RESEND_FROM` | Письмо при изменении. Без них заметка остаётся в столе |
| `DRIFTLINE_CRON_SECRET` | Внешний cron на `/ops/run` |
| `DRIFTLINE_ALLOW_LOOPBACK=0` | В продакшене так и оставь: локальные адреса смотреть нельзя |
| `DRIFTLINE_DB` | Путь к SQLite, по умолчанию `data/driftline.sqlite` |

В Stripe вебхук должен слать `checkout.session.completed` и `customer.subscription.deleted`. Успешный возврат из оплаты сам план не повышает: это делает только подписанный вебхук.

Driftline читает HTML, который отдал сервер. Он не исполняет JavaScript и не входит в закрытые кабинеты.
