from __future__ import annotations

import logging
from pathlib import Path

import click

from .backup import BackupManager
from .config import DEFAULT_CONFIG_PATH, load_config
from .database import HubDatabase
from .sync import HealthChecker, SubscriptionAggregator, SyncEngine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _db(config_path: Path) -> HubDatabase:
    return HubDatabase()


@click.group()
@click.option("--config", "config_path", type=click.Path(path_type=Path), default=DEFAULT_CONFIG_PATH)
@click.pass_context
def main(ctx: click.Context, config_path: Path) -> None:
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = config_path
    ctx.obj["config"] = load_config(config_path)
    ctx.obj["db"] = _db(config_path)


@main.command("health")
@click.pass_context
def health_cmd(ctx: click.Context) -> None:
    """Check health of all configured nodes."""
    checker = HealthChecker(ctx.obj["config"], ctx.obj["db"])
    results = checker.check_all()
    for row in results:
        status = "OK" if row["healthy"] else "FAIL"
        click.echo(f"[{status}] {row['node_id']} ({row['country']}) {row.get('latency_ms', '')} {row.get('error', '')}")


@main.command("list-users")
@click.pass_context
def list_users_cmd(ctx: click.Context) -> None:
    """List users stored in the hub."""
    for user in ctx.obj["db"].list_users():
        state = "enabled" if user.enable else "disabled"
        click.echo(f"{user.uuid}  {user.name}  {state}  {user.package_days}d  {user.usage_limit_gb}GB")


@main.command("create-user")
@click.argument("name")
@click.option("--uuid", default=None, help="Fixed UUID (same on all nodes)")
@click.option("--days", type=int, default=None)
@click.option("--gb", type=float, default=None)
@click.option("--node", "nodes", multiple=True, help="Limit to specific node ids")
@click.pass_context
def create_user_cmd(ctx: click.Context, name: str, uuid: str | None, days: int | None, gb: float | None, nodes: tuple[str, ...]) -> None:
    engine = SyncEngine(ctx.obj["config"], ctx.obj["db"])
    user = engine.create_user(name, uuid=uuid, package_days=days, usage_limit_gb=gb, nodes=list(nodes) or None)
    hub_url = ctx.obj["config"].hub.public_url.rstrip("/")
    click.echo(f"Created {user.uuid}")
    click.echo(f"Unified subscription: {hub_url}/sub/{user.uuid}")


@main.command("renew-user")
@click.argument("uuid")
@click.option("--days", type=int, default=None)
@click.option("--gb", type=float, default=None)
@click.pass_context
def renew_user_cmd(ctx: click.Context, uuid: str, days: int | None, gb: float | None) -> None:
    engine = SyncEngine(ctx.obj["config"], ctx.obj["db"])
    user = engine.renew_user(uuid, package_days=days, usage_limit_gb=gb)
    click.echo(f"Renewed {user.name} ({user.uuid}) for {user.package_days} days")


@main.command("disable-user")
@click.argument("uuid")
@click.pass_context
def disable_user_cmd(ctx: click.Context, uuid: str) -> None:
    engine = SyncEngine(ctx.obj["config"], ctx.obj["db"])
    user = engine.disable_user(uuid)
    click.echo(f"Disabled {user.name} ({user.uuid})")


@main.command("sync-all")
@click.option("--node", "nodes", multiple=True)
@click.pass_context
def sync_all_cmd(ctx: click.Context, nodes: tuple[str, ...]) -> None:
    """Push all hub users to all nodes."""
    engine = SyncEngine(ctx.obj["config"], ctx.obj["db"])
    result = engine.sync_all_users(nodes=list(nodes) or None)
    click.echo(f"OK: {len(result['ok'])}, failed: {len(result['failed'])}")
    for item in result["failed"]:
        click.echo(f"  FAIL {item}")


@main.command("import-from-node")
@click.argument("node_id")
@click.pass_context
def import_from_node_cmd(ctx: click.Context, node_id: str) -> None:
    """Import users from one existing Hiddify node into the hub."""
    engine = SyncEngine(ctx.obj["config"], ctx.obj["db"])
    count = engine.import_from_node(node_id)
    click.echo(f"Imported {count} users from {node_id}")


@main.command("subscription-url")
@click.argument("uuid")
@click.pass_context
def subscription_url_cmd(ctx: click.Context, uuid: str) -> None:
    hub_url = ctx.obj["config"].hub.public_url.rstrip("/")
    click.echo(f"{hub_url}/sub/{uuid}")


@main.command("backup")
@click.argument("output", type=click.Path(path_type=Path))
@click.option("--encrypt", default=None, help="Encryption password")
@click.pass_context
def backup_cmd(ctx: click.Context, output: Path, encrypt: str | None) -> None:
    manager = BackupManager(ctx.obj["config_path"], ctx.obj["db"])
    path = manager.export_backup(output, encrypt_key=encrypt)
    click.echo(f"Backup saved to {path}")


@main.command("restore")
@click.argument("backup_file", type=click.Path(exists=True, path_type=Path))
@click.option("--encrypt", default=None)
@click.option("--skip-config", is_flag=True)
@click.option("--skip-users", is_flag=True)
@click.pass_context
def restore_cmd(ctx: click.Context, backup_file: Path, encrypt: str | None, skip_config: bool, skip_users: bool) -> None:
    manager = BackupManager(ctx.obj["config_path"], ctx.obj["db"])
    result = manager.import_backup(
        backup_file,
        encrypt_key=encrypt,
        restore_config=not skip_config,
        restore_users=not skip_users,
    )
    click.echo(result)


@main.command("serve")
@click.pass_context
def serve_cmd(ctx: click.Context) -> None:
    """Start web admin + subscription aggregator."""
    import uvicorn

    from .web import create_app

    config = ctx.obj["config"]
    app = create_app(config, ctx.obj["config_path"], ctx.obj["db"])
    uvicorn.run(app, host=config.hub.listen_host, port=config.hub.listen_port)


if __name__ == "__main__":
    main()
