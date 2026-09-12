from __future__ import annotations

import argparse
import logging
import sys

from .client import HiddifyAdminClient, HiddifyError
from .config import load_config
from .proxy import serve_merge_proxy
from .sync import sync_users


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sync Hiddify users to a Netherlands node and merge that exit into existing subscriptions."
    )
    parser.add_argument("--config", required=True, help="Path to config.yaml")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="Ping Sweden panels and the NL panel")
    check.set_defaults(func=_cmd_check)

    sync = sub.add_parser("sync", help="Copy/enable/disable NL users from Sweden panels")
    sync.add_argument("--dry-run", action="store_true")
    sync.set_defaults(func=_cmd_sync)

    merge = sub.add_parser("merge", help="Run HTTP proxy that injects NL configs into Sweden subscriptions")
    merge.set_defaults(func=_cmd_merge)
    return parser


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _cmd_check(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    failed = 0
    for panel in cfg.sweden:
        try:
            with HiddifyAdminClient(
                panel.base_url,
                panel.admin_proxy_path,
                panel.admin_api_key,
                verify_tls=panel.verify_tls,
            ) as client:
                client.ping()
            print(f"OK sweden/{panel.id} {panel.base_url}")
        except HiddifyError as exc:
            failed += 1
            print(f"FAIL sweden/{panel.id}: {exc}")
    try:
        with HiddifyAdminClient(
            cfg.netherlands.base_url,
            cfg.netherlands.admin_proxy_path,
            cfg.netherlands.admin_api_key,
            verify_tls=cfg.netherlands.verify_tls,
        ) as client:
            client.ping()
        print(f"OK netherlands {cfg.netherlands.base_url}")
    except HiddifyError as exc:
        failed += 1
        print(f"FAIL netherlands: {exc}")
    return 1 if failed else 0


def _cmd_sync(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    stats = sync_users(cfg, dry_run=args.dry_run)
    print(stats.as_dict())
    return 1 if stats.errors else 0


def _cmd_merge(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    serve_merge_proxy(cfg)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
