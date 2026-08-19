# Ротация IPv6 для Ubuntu + Hiddify Manager

Раз в сутки в **03:00 по локальному времени сервера** скрипт меняет **дополнительный** IPv6 из пула хостера.

Hiddify Manager при этом не трогается:

- не правится `/opt/hiddify-manager`
- не перезапускаются `hiddify-panel`, xray, sing-box, nginx, haproxy
- не меняются IPv4, link-local `fe80::` и **основной** IPv6 (панель, SSH, AAAA домена панели)

Клиенты по-прежнему заходят на стабильные адреса. Меняется исходящий IPv6, которым сервер (и прокси) ходит в интернет.

## Как это устроено

1. Текущие глобальные IPv6 на интерфейсе запоминаются как защищённые и никогда не снимаются.
2. Из `/64` (или из списка) берётся новый адрес и вешается на тот же интерфейс с `noprefixroute`.
3. Добавляется отдельный default-маршрут с низким metric и `src <новый IPv6>`. Системный default от netplan/RA **не удаляется**.
4. Старый ротационный адрес снимается только после успешного `ping6`.
5. В 03:00 срабатывает systemd-таймер. После reboot тот же адрес поднимается снова (`--restore`), без внеочередной смены.

Xray/sing-box в Hiddify слушают все адреса интерфейса и для исходящих IPv6 берут source, который задаёт ядро. Поэтому достаточно смены маршрута — шаблоны Hiddify переписывать не нужно.

## Перед установкой

На сервере:

```bash
ip -6 addr show scope global
ip -6 route show default
timedatectl
```

Нужно:

- пул от хостера уже **маршрутизирован** на VPS (обычно `/64`; любой адрес из него можно добавить командой `ip`);
- IPv6 default route есть;
- в Hiddify **не** включён режим «только IPv4»;
- если весь трафик уходит в WARP, нативная ротация IPv6 на выход не повлияет.

Если хостер выдал не префикс, а список адресов — все они должны быть включены в панели хостера, затем используйте `MODE=pool`.

## Установка

С машины, где лежит этот каталог:

```bash
sudo bash ipv6-rotate/install.sh
sudo nano /etc/ipv6-rotate/ipv6-rotate.conf
```

Проверьте `SUBNET`, `INTERFACE`, `GATEWAY`. Для списка адресов:

```bash
sudo nano /etc/ipv6-rotate/pool.txt
# MODE=pool в ipv6-rotate.conf
```

Часовой пояс (03:00 берётся из него):

```bash
sudo timedatectl set-timezone Europe/Moscow
```

Прогон:

```bash
sudo rotate-ipv6.sh --dry-run
sudo rotate-ipv6.sh
sudo rotate-ipv6.sh --status
systemctl list-timers ipv6-rotate.timer
```

## Откат, логи, ручная смена

Все команды на сервере. Основной IPv6 и Hiddify при откате не трогаются.

```bash
# журнал смен: история + /var/log/ipv6-rotate.log + journalctl
sudo rotate-ipv6.sh --log
sudo tail -f /var/log/ipv6-rotate.log

# текущий и предыдущий extra-IPv6
sudo rotate-ipv6.sh --status

# сменить адрес прямо сейчас (как в 03:00)
sudo rotate-ipv6.sh

# поставить конкретный адрес из пула
sudo rotate-ipv6.sh --set 2a03:xxxx:xxxx:xxxx::abcd

# вернуть предыдущий extra-IPv6
sudo rotate-ipv6.sh --rollback

# снять extra-IPv6, остаётся только основной (если ротация мешает)
sudo rotate-ipv6.sh --off

# остановить ночную смену, текущий extra-IP не трогать
sudo rotate-ipv6.sh --pause
sudo rotate-ipv6.sh --resume

# полное снятие таймера и extra-IP
sudo bash ipv6-rotate/uninstall.sh
```

Формат истории (`/var/lib/ipv6-rotate/history`):

```
2026-08-20T03:00:01+03:00 rotate 2a03:...::a -> 2a03:...::b ok
```

При неудачном ping новая смена сама откатывается, в истории будет `fail-ping`.

## Что не сломается

| Компонент | Поведение |
| --- | --- |
| Основной IPv6 / IPv4 | не удаляются |
| Панель Hiddify, SSH | слушают стабильные адреса |
| Apply Config / обновление Hiddify | скрипт их не вызывает |
| Клиентские подписки с доменом на основном IP | без изменений |

Исходящие с самого сервера (apt, Telegram-бот панели) тоже пойдут с нового IPv6. На работу панели это обычно не влияет.

## Если нужно менять IPv6, на который заходят клиенты

По умолчанию крутится **выходной** адрес. Чтобы крутить ещё и входной:

1. Оставьте AAAA **панели** на основном IPv6.
2. Заведите отдельный поддомен только для прокси, TTL 120, proxy off.
3. Включите хук Cloudflare (или свой скрипт) через `POST_ROTATE_HOOK`.
4. В Hiddify этот поддомен должен резолвиться в крутящийся адрес (через DNS, без «Force IP» на статический IPv6).

Пример хука: `hooks/cloudflare-aaaa.sh`.
