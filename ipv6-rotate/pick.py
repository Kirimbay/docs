#!/usr/bin/env python3
"""Pick the next IPv6 to assign. Used by rotate-ipv6.sh."""
from __future__ import annotations

import argparse
import ipaddress
import random
import sys
from pathlib import Path


def _protected(raw: str):
    out = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        out.add(ipaddress.IPv6Address(line))
    return out


def pick_subnet(subnet: str, protected_raw: str) -> str:
    net = ipaddress.IPv6Network(subnet, strict=False)
    protected = _protected(protected_raw)
    if net.prefixlen > 120:
        raise SystemExit("subnet prefix is too small for rotation")
    start = int(net.network_address) + 2
    end = int(net.broadcast_address) - 1
    if end <= start:
        raise SystemExit("subnet has no usable hosts")
    for _ in range(4000):
        addr = ipaddress.IPv6Address(random.randint(start, end))
        if addr in protected or addr == net.network_address:
            continue
        return str(addr)
    raise SystemExit("failed to pick a free IPv6 from subnet")


def pick_pool(pool_file: str, protected_raw: str, current_raw: str) -> str:
    protected = {str(a) for a in _protected(protected_raw)}
    current = str(ipaddress.IPv6Address(current_raw)) if current_raw.strip() else ""
    addrs = []
    for line in Path(pool_file).read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        ip = str(ipaddress.IPv6Address(line))
        if ip in protected:
            continue
        addrs.append(ip)
    if not addrs:
        raise SystemExit("pool.txt has no usable addresses (all protected or empty)")
    if current in addrs:
        return addrs[(addrs.index(current) + 1) % len(addrs)]
    return addrs[0]


def normalize(ip: str) -> str:
    return str(ipaddress.IPv6Address(ip))


def network_of(addr: str) -> str:
    return str(ipaddress.IPv6Interface(addr).network)


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("normalize")
    n.add_argument("ip")

    net = sub.add_parser("network")
    net.add_argument("addr")

    s = sub.add_parser("subnet")
    s.add_argument("subnet")
    s.add_argument("protected")

    pool = sub.add_parser("pool")
    pool.add_argument("pool_file")
    pool.add_argument("protected")
    pool.add_argument("current", nargs="?", default="")

    args = p.parse_args()
    if args.cmd == "normalize":
        print(normalize(args.ip))
    elif args.cmd == "network":
        print(network_of(args.addr))
    elif args.cmd == "subnet":
        print(pick_subnet(args.subnet, args.protected))
    elif args.cmd == "pool":
        print(pick_pool(args.pool_file, args.protected, args.current))
    else:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
