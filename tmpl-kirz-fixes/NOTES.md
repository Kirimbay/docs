# tmpl kirz fixes

Patched installer lives in `/tmpl-install` in this repo and is published to:

`https://ro1.kirz.co.uk:8090/` (`get.sh` + `tmpl-install.tgz`).

## New install
```bash
curl -fsSL https://ro1.kirz.co.uk:8090/get.sh | bash -s -- --domain xN.kirz.co.uk
curl -fsSL https://ro1.kirz.co.uk:8090/get.sh | bash -s -- --relay --exit EXIT_IP
```

## Existing servers
```bash
bash /root/tmpl-install/fix-all.sh
bash /root/tmpl-install/fix-all.sh --relay --exit EXIT_IP
```
