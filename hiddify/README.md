# Hiddify: RoscomVPN routing + Cloudflare ping

На сервере с Hiddify Manager, под `root`:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/main/hiddify/install-roscomvpn.sh)
```

Что ставит:

- ping URL в подписке: `https://cp.cloudflare.com/generate_204`
- опциональный роутинг RoscomVPN для Happ и INCY (тумблер можно выключить)
- повтор патча при рестарте панели после обновления Hiddify
- если Hiddify сильно поменяет код подписки, панель всё равно стартанёт (патч просто не применится)


После установки пользователи обновляют подписку в приложении.
