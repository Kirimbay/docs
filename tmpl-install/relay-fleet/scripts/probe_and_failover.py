#!/usr/bin/env python3
"""Probe relay→exit paths and optionally flip Cloudflare A records to a healthy front.

Usage:
  CF_TOKEN=… python3 probe_and_failover.py --inventory inventory.yaml --dry-run
  CF_TOKEN=… python3 probe_and_failover.py --inventory inventory.yaml --apply
  CF_TOKEN=… python3 probe_and_failover.py --inventory inventory.yaml --apply --failback
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None


def load_inventory(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        return yaml.safe_load(text)
    # minimal YAML subset via json if file is json; else require pyyaml
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise SystemExit(
            "PyYAML required for YAML inventory: pip install pyyaml\n" + str(e)
        )


def cf_token(inv: dict[str, Any]) -> str:
    tok = os.environ.get("CF_TOKEN") or os.environ.get("CF_API_TOKEN") or ""
    if not tok:
        f = inv.get("cf_token_file")
        if f and Path(f).is_file():
            tok = Path(f).read_text(encoding="utf-8").strip()
    if not tok:
        raise SystemExit("CF_TOKEN / CF_API_TOKEN / cf_token_file missing")
    return tok


def zone_id_for(name: str, zones: dict[str, str]) -> str:
    # longest matching zone suffix
    parts = name.split(".")
    for i in range(len(parts) - 1):
        z = ".".join(parts[i:])
        if z in zones:
            return zones[z]
    raise KeyError(f"no zone for {name}")


def cf_request(token: str, url: str, method: str = "GET", data: dict | None = None) -> dict:
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"CF {method} {url}: {e.code} {err}") from e


def cf_set_a(token: str, zones: dict[str, str], name: str, ip: str, ttl: int = 60) -> None:
    zid = zone_id_for(name, zones)
    listed = cf_request(
        token,
        f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records?type=A&name={name}",
    )
    records = listed.get("result") or []
    payload = {"type": "A", "name": name, "content": ip, "ttl": ttl, "proxied": False}
    if not records:
        r = cf_request(
            token,
            f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records",
            method="POST",
            data=payload,
        )
        if not r.get("success"):
            raise RuntimeError(f"create {name}: {r}")
        return
    rid = records[0]["id"]
    r = cf_request(
        token,
        f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records/{rid}",
        method="PUT",
        data=payload,
    )
    if not r.get("success"):
        raise RuntimeError(f"update {name}: {r}")


def ssh_probe(
    key: str,
    host: str,
    exit_ip: str,
    ports: list[int],
    tries: int,
    timeout: int,
) -> dict[str, Any]:
    """Run TCP probes on remote relay via SSH BatchMode."""
    ports_csv = ",".join(str(p) for p in ports)
    remote = f"""
set +e
EXIT={exit_ip!r}
TRIES={tries}
TO={timeout}
PORTS="{ports_csv}"
declare -A OK
for p in $(echo "$PORTS" | tr ',' ' '); do OK[$p]=0; done
for i in $(seq 1 $TRIES); do
  for p in $(echo "$PORTS" | tr ',' ' '); do
    timeout $TO bash -c "echo >/dev/tcp/$EXIT/$p" 2>/dev/null && OK[$p]=$((OK[$p]+1))
  done
done
for p in $(echo "$PORTS" | tr ',' ' '); do
  echo "PORT $p ${{OK[$p]}}/$TRIES"
done
"""
    # fix quoting for EXIT
    remote = remote.replace(f"EXIT={exit_ip!r}", f"EXIT={exit_ip}")
    cmd = [
        "ssh",
        "-i",
        key,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        f"root@{host}",
        "bash",
        "-s",
    ]
    try:
        p = subprocess.run(
            cmd,
            input=remote,
            text=True,
            capture_output=True,
            timeout=tries * timeout * max(1, len(ports)) + 30,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "ssh_timeout", "scores": {}}
    if p.returncode != 0 and not p.stdout.strip():
        return {
            "ok": False,
            "error": f"ssh_rc={p.returncode} {p.stderr.strip()[:200]}",
            "scores": {},
        }
    scores: dict[int, tuple[int, int]] = {}
    for line in p.stdout.splitlines():
        if line.startswith("PORT "):
            # PORT 443 3/5
            parts = line.split()
            if len(parts) >= 3 and "/" in parts[2]:
                port = int(parts[1])
                a, b = parts[2].split("/", 1)
                scores[port] = (int(a), int(b))
    if not scores:
        return {"ok": False, "error": f"parse_fail:{p.stdout[:200]}", "scores": {}}
    # healthy if all probed ports meet — caller applies threshold on port 443 primarily
    return {"ok": True, "error": None, "scores": scores, "raw": p.stdout}


def score_ok(scores: dict[int, tuple[int, int]], ports: list[int], threshold: int) -> bool:
    if not scores:
        return False
    for port in ports:
        if port not in scores:
            return False
        got, _ = scores[port]
        if got < threshold:
            return False
    return True


def load_state(path: Path) -> dict[str, Any]:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"exits": {}}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def notify(inv: dict[str, Any], text: str) -> None:
    print(f"NOTIFY: {text}")
    tg = inv.get("telegram") or {}
    if not tg.get("enabled"):
        return
    token = os.environ.get(tg.get("bot_token_env") or "TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get(tg.get("chat_id_env") or "TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        return
    data = json.dumps({"chat_id": chat, "text": text[:3500]}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        print(f"telegram failed: {e}", file=sys.stderr)


def front_usable(f: dict[str, Any]) -> bool:
    ip = str(f.get("ip") or "")
    host = str(f.get("relay_host") or "")
    if not ip or ip.startswith("REPLACE") or not host or host.startswith("REPLACE"):
        return False
    return True


def pick_current(fronts: list[dict], state_ip: str | None) -> dict[str, Any] | None:
    if state_ip:
        for f in fronts:
            if f.get("ip") == state_ip and front_usable(f):
                return f
    for f in fronts:
        if f.get("id") == "primary" and front_usable(f):
            return f
    for f in fronts:
        if front_usable(f):
            return f
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true", help="allow Cloudflare updates")
    ap.add_argument(
        "--failback",
        action="store_true",
        help="allow switching back to preferred primary when healthy",
    )
    ap.add_argument("--only")
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("specify --dry-run or --apply", file=sys.stderr)
        return 2

    inv = load_inventory(Path(args.inventory))
    key = inv.get("ssh_key") or str(Path.home() / ".ssh" / "id_rsa")
    tries = int(inv.get("probe_tries") or 5)
    timeout = int(inv.get("probe_timeout_sec") or 2)
    threshold = int(inv.get("ok_threshold") or 3)
    ports = [int(p) for p in (inv.get("ports") or [443])]
    zones = inv.get("zones") or {}
    state_path = Path(inv.get("state_file") or "/tmp/relay-fleet-state.json")
    state = load_state(state_path)
    auto_failback = bool(inv.get("auto_failback")) or args.failback
    token = None
    if args.apply and not args.dry_run:
        token = cf_token(inv)

    exits = inv.get("exits") or {}
    rc = 0
    for eid, ex in exits.items():
        if args.only and args.only != str(eid):
            continue
        exit_ip = ex["exit_ip"]
        domains = ex.get("domains") or []
        fronts = ex.get("fronts") or []
        st = state.setdefault("exits", {}).setdefault(str(eid), {})
        current = pick_current(fronts, st.get("active_ip"))
        print(f"\n=== exit {eid} ({exit_ip}) active={current and current.get('ip')} ===")

        results: list[tuple[dict, dict]] = []
        for f in fronts:
            if not front_usable(f):
                print(f"  skip {f.get('id')}: placeholder")
                continue
            print(f"  probe {f.get('id')} host={f['relay_host']} front={f['ip']} …", flush=True)
            r = ssh_probe(key, f["relay_host"], exit_ip, ports, tries, timeout)
            results.append((f, r))
            if not r["ok"]:
                print(f"    FAIL {r.get('error')}")
            else:
                sc = " ".join(f"{p}={a}/{b}" for p, (a, b) in sorted(r["scores"].items()))
                healthy = score_ok(r["scores"], ports, threshold)
                print(f"    {sc} healthy={healthy}")

        healthy_fronts = [
            f
            for f, r in results
            if r.get("ok") and score_ok(r.get("scores") or {}, ports, threshold)
        ]
        if not healthy_fronts:
            msg = f"exit{eid}: NO healthy front→{exit_ip}. Buy/attach IP on SERV.HOST with live path."
            print("  " + msg)
            notify(inv, msg)
            rc = 1
            continue

        # prefer primary id if healthy; else keep current if healthy; else first healthy
        primary = next((f for f in fronts if f.get("id") == "primary" and front_usable(f)), None)
        target = None
        cur_healthy = current and any(f is current or f.get("ip") == current.get("ip") for f in healthy_fronts)
        # fix: match by ip
        cur_healthy = False
        if current:
            for hf in healthy_fronts:
                if hf.get("ip") == current.get("ip"):
                    cur_healthy = True
                    break

        primary_healthy = bool(
            primary
            and any(hf.get("ip") == primary.get("ip") for hf in healthy_fronts)
        )

        if cur_healthy and not (
            auto_failback and primary_healthy and current.get("ip") != primary.get("ip")
        ):
            target = current
            action = "keep"
        elif auto_failback and primary_healthy:
            target = primary
            action = (
                "failback"
                if current and current.get("ip") != primary.get("ip")
                else "keep"
            )
        elif cur_healthy:
            target = current
            action = "keep"
        else:
            # failover: prefer non-primary backups, else any healthy
            backups = [
                f
                for f in healthy_fronts
                if not primary or f.get("ip") != primary.get("ip")
            ]
            target = backups[0] if backups else healthy_fronts[0]
            action = "failover"

        assert target is not None
        print(f"  decision: {action} → {target.get('ip')} ({target.get('id')})")

        if action == "keep":
            st["active_ip"] = target["ip"]
            st["last_check_ts"] = int(time.time())
            continue

        if args.dry_run or not args.apply:
            print(f"  DRY: would set {domains} → {target['ip']}")
            notify(inv, f"DRY exit{eid}: {action} → {target['ip']}")
            continue

        assert token
        for d in domains:
            cf_set_a(token, zones, d, target["ip"], ttl=60)
            print(f"  CF {d} → {target['ip']}")
        st["active_ip"] = target["ip"]
        st["last_flip_ts"] = int(time.time())
        st["last_action"] = action
        notify(inv, f"exit{eid}: DNS {action} → {target['ip']} domains={len(domains)}")

    save_state(state_path, state)
    return rc


if __name__ == "__main__":
    sys.exit(main())
