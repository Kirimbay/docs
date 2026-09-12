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


def _network_of_addr(addr, prefixlen):
    return ipaddress.IPv6Network((addr, prefixlen), strict=False)


def pick_subnet(subnet, protected_raw, current_raw="", rotate_prefixlen=0):
    net = ipaddress.IPv6Network(subnet, strict=False)
    protected = _protected(protected_raw)
    current = None
    if current_raw and current_raw.strip():
        current = ipaddress.IPv6Address(current_raw.strip())
    if net.prefixlen > 120:
        raise SystemExit("subnet prefix is too small for rotation")

    rotate_prefixlen = int(rotate_prefixlen or 0)
    if rotate_prefixlen and net.prefixlen >= rotate_prefixlen:
        rotate_prefixlen = 0

    blocked = set()
    if rotate_prefixlen:
        if current is not None:
            blocked.add(_network_of_addr(current, rotate_prefixlen))
        for p in protected:
            blocked.add(_network_of_addr(p, rotate_prefixlen))

    if rotate_prefixlen and net.prefixlen < rotate_prefixlen:
        n_subnets = 2 ** (rotate_prefixlen - net.prefixlen)
        host_space = 2 ** (128 - rotate_prefixlen)
        for _ in range(8000):
            idx = random.randint(0, n_subnets - 1)
            base = int(net.network_address) + idx * host_space
            sub = ipaddress.IPv6Network((base, rotate_prefixlen))
            if sub in blocked:
                continue
            host = random.randint(2, host_space - 2)
            addr = ipaddress.IPv6Address(base + host)
            if addr in protected:
                continue
            return str(addr)
        raise SystemExit("failed to pick a new /%s from %s" % (rotate_prefixlen, net))

    start = int(net.network_address) + 2
    end = int(net.broadcast_address) - 1
    if end <= start:
        raise SystemExit("subnet has no usable hosts")
    for _ in range(4000):
        addr = ipaddress.IPv6Address(random.randint(start, end))
        if addr in protected or addr == net.network_address:
            continue
        if current is not None and addr == current:
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


def _pool_addrs(pool_file: str):
    addrs = []
    path = Path(pool_file)
    if not path.exists():
        return addrs
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        addrs.append(str(ipaddress.IPv6Address(line)))
    return addrs


def belongs(ip: str, mode: str, subnet: str, pool_file: str) -> str:
    addr = ipaddress.IPv6Address(ip)
    if mode == "pool":
        allowed = _pool_addrs(pool_file)
        if str(addr) not in allowed:
            raise SystemExit("%s is not in %s" % (addr, pool_file))
        return str(addr)
    if not subnet:
        raise SystemExit("SUBNET is empty")
    net = ipaddress.IPv6Network(subnet, strict=False)
    if addr not in net:
        raise SystemExit("%s is not in %s" % (addr, net))
    if addr == net.network_address:
        raise SystemExit("%s is the network address" % addr)
    return str(addr)


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
    s.add_argument("current", nargs="?", default="")
    s.add_argument("--rotate-prefixlen", type=int, default=0)

    pool = sub.add_parser("pool")
    pool.add_argument("pool_file")
    pool.add_argument("protected")
    pool.add_argument("current", nargs="?", default="")

    b = sub.add_parser("belongs")
    b.add_argument("ip")
    b.add_argument("mode")
    b.add_argument("subnet")
    b.add_argument("pool_file")

    args = p.parse_args()
    if args.cmd == "normalize":
        print(normalize(args.ip))
    elif args.cmd == "network":
        print(network_of(args.addr))
    elif args.cmd == "subnet":
        print(
            pick_subnet(
                args.subnet,
                args.protected,
                args.current,
                args.rotate_prefixlen,
            )
        )
    elif args.cmd == "pool":
        print(pick_pool(args.pool_file, args.protected, args.current))
    elif args.cmd == "belongs":
        print(belongs(args.ip, args.mode, args.subnet, args.pool_file))
    else:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
