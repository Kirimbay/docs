# Hiddify: RoscomVPN routing + Cloudflare ping

На сервере с Hiddify Manager, под `root`.

Установка:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-roscomvpn-install-48ca/hiddify/install-roscomvpn.sh)
```

Откат к стоку Hiddify:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-roscomvpn-install-48ca/hiddify/install-roscomvpn.sh) --uninstall
```

Что ставит:

- ping URL в подписке: `https://cp.cloudflare.com/generate_204` (для всех клиентов, кто читает `test-url`)
- заголовок `routing` **только** для Happ и INCY; остальные приложения его не получают
- тумблер роутинга можно выключить
- повтор патча при рестарте панели после обновления Hiddify
- если Hiddify сильно поменяет код подписки, панель всё равно стартанёт

После установки или отката пользователи обновляют подписку. Если в Happ уже появился профиль RoscomVPN, после `--uninstall` его можно удалить или выключить в приложении — сервер его больше не присылает.
