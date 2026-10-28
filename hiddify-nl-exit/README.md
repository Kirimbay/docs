# Hiddify: нидерландский выход в старых подписках

Скрипты делают две вещи:

1. **`sync`** — копирует пользователей с 10 шведских панелей на Hiddify в NL **с тем же UUID**. Живой на Швеции → включён в NL. Истёк или выключен → выключен в NL (кэш в приложении тоже перестаёт коннектиться).
2. **`merge`** — HTTP-прокси перед шведской подпиской. Ссылка у человека **не меняется**. В ответ дописываются конфиги NL (реальный выход из Нидерландов, не relay).

Hiddify сам не умеет multi-node. Relay сюда не подходит: у сайтов остался бы шведский IP.

## Что нужно заранее

- Отдельный сервер в NL, на нём Hiddify той же мажорной версии.
- Домен на IP NL, **без** Cloudflare proxy. Alias в панели: `🇳🇱 Netherlands`.
- В NL включите 1–2 протокола (VLESS+Reality, при необходимости Hysteria2). WARP **выключите**.
- Железо с запасом: это общая точка для всех 10 ферм.

## Установка на NL (синк)

```bash
sudo mkdir -p /opt/hiddify-nl-exit
sudo cp -a hiddify-nl-exit/. /opt/hiddify-nl-exit/
cd /opt/hiddify-nl-exit
python3 -m venv .venv
.venv/bin/pip install -e .
sudo cp config.example.yaml config.yaml
sudo nano config.yaml
```

В `config.yaml`:

- URL, **admin** proxy path и UUID супер-админа каждой шведской панели и NL.
- **user** proxy path (клиентский, не админский) — из Settings → Too Advanced / Client Proxy Path.
- С NL должен открываться админ-API всех 10 шведских панелей (whitelist IP NL).

Проверка и первый прогон:

```bash
.venv/bin/python -m hiddify_nl_exit --config config.yaml check
.venv/bin/python -m hiddify_nl_exit --config config.yaml sync --dry-run
.venv/bin/python -m hiddify_nl_exit --config config.yaml sync
```

Таймер раз в минуту:

```bash
sudo cp systemd/hiddify-nl-sync.service systemd/hiddify-nl-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hiddify-nl-sync.timer
```

`apply_users_command` оставляйте, если на NL есть Hysteria2/TUIC: иначе после disable протокол может ещё пускать.

## Склейка подписки (merge)

Прокси должен стоять **на том же хосте, что уже прописан в sub-ссылке**, иначе клиентам придётся менять URL.

`origin_url` — панель **в обход** этого прокси (иначе петля). Обычно внутренний HTTP Hiddify, например `http://127.0.0.1:9000`. Host от клиента прокси сохраняет, чтобы панель отдала конфиги нужного домена.

Если подписка уже на отдельном домене (`sub link only`):

1. На шведском сервере запустите merge (`127.0.0.1:8471`, origin = локальная панель).
2. Направьте HTTP этого домена на `:8471` (nginx / HAProxy), Reality/коннект-домены не трогайте.

Если sub и Reality на одном 443 — вынесите в HAProxy на 8471 **только HTTP панели**, не весь 443.

```bash
sudo cp systemd/hiddify-nl-merge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hiddify-nl-merge.service
```

На каждой из 10 шведских машин — свой `config.yaml` с одним элементом `sweden` (id `se01`…`se10`) и `server_names` этого хоста.

## Как проверить

1. Тестовый живой пользователь на одной шведской панели.
2. `sync` — тот же UUID появился в NL.
3. Обновить подписку в Hiddify Next **той же ссылкой** — в списке Швеция и 🇳🇱.
4. Включить только NL и открыть `ifconfig.me` — нидерландский IP.
5. Выключить пользователя на Швеции → через минуту `sync` выключит NL → после обновления sub флаг пропал, старый NL-коннект не проходит.
6. Включить обратно (как после оплаты) — флаг и доступ возвращаются.

## Поведение

| Событие | Список в приложении | Реальный доступ в NL |
| --- | --- | --- |
| Живая подписка | SE + NL | да |
| Истёк срок / кончился трафик на SE | после обновления sub NL нет | нет, UUID выключен на NL |
| Оплата / enable на SE | после sync и обновления sub NL снова есть | да |

Пока клиент не обновил sub, строка может висеть в кэше. Доступ режет `enable=false` на NL, не исчезновение флага.

Лимит GB по-прежнему считает шведская панель (`is_active`). На NL лимит специально большой: рубильник только on/off.

## Команды

```bash
python -m hiddify_nl_exit --config config.yaml check
python -m hiddify_nl_exit --config config.yaml sync [--dry-run]
python -m hiddify_nl_exit --config config.yaml merge
```
