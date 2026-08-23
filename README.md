# Docs

## Hiddify: блок торрентов одной командой

На сервере с Hiddify Manager (от root):

```bash
rm -f /tmp/hiddify-block-torrents.sh
curl -fsSL -H 'Cache-Control: no-cache' \
  "https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-block-torrents-0aec/scripts/hiddify-block-torrents.sh?$(date +%s)" \
  -o /tmp/hiddify-block-torrents.sh
grep -m1 '^VERSION=' /tmp/hiddify-block-torrents.sh   # must be 1.7.4+
sudo bash /tmp/hiddify-block-torrents.sh
hiddify-block-torrents doctor
```

Нужна строка `kernel: OUTPUT allowlist ON`. Пользователи ничего не настраивают: ядро режет исходящие NEW не на веб-портах. Если `doctor` неизвестен — в PATH старая копия, скачайте файл заново.

```bash
hiddify-block-torrents status
hiddify-block-torrents who
```

Подробности: [hiddify-block-torrents.mdx](./hiddify-block-torrents.mdx). Скрипт: [scripts/hiddify-block-torrents.sh](./scripts/hiddify-block-torrents.sh).

---

# Mintlify Starter Kit

Click on `Use this template` to copy the Mintlify starter kit. The starter kit contains examples including

- Guide pages
- Navigation
- Customizations
- API Reference pages
- Use of popular components

### Development

Install the [Mintlify CLI](https://www.npmjs.com/package/mint) to preview the documentation changes locally. To install, use the following command

```
npm i -g mint
```

Run the following command at the root of your documentation (where docs.json is)

```
mint dev
```

### Publishing Changes

Install our Github App to auto propagate changes from your repo to your deployment. Changes will be deployed to production automatically after pushing to the default branch. Find the link to install on your dashboard. 

#### Troubleshooting

- If the dev environment isn't running - Run `mint update` to ensure you have the most recent version of the CLI.
- Page loads as a 404 - Make sure you are running in a folder with `docs.json`
