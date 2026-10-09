#!/usr/bin/env python3
"""Make a Hiddify Manager 12.3.3 panel backup load on panel 12.0.0.

12.0.0 restores a backup by inserting rows into MySQL ENUM columns
(see hiddifypanel/panel/hiddify.py set_db_from_json and
panel/init_db.py add_new_enum_values). Values added after 12.0.0 are
rejected and the restore aborts.

Compared with tag v12.0.0 (56f902dd), tag v12.3.3 (cf2e60de) adds:

* ProxyProto.dnstt and the proxy row named DNSTT
* DomainType.dnstt
* config keys dnstt_enable, dnstt_resolvers, dnstt_private_key,
  dnstt_public_key, additional_configs_urls, additional_configs_singbox,
  additional_configs_xrayjson
* db migrations _v114.._v119, so a 12.3.3 backup stores db_version 119.
  12.0.0's newest migration is _v113. The downgrade installer copies
  db_version out of the backup (init_db.upgrade_database) and then
  treats the database as newer than the code.

Users, admins, and every proxy/domain/setting that already existed in
12.0.0 are kept. DNSTT and the new settings are removed because 12.0.0
has no code for them.

Usage:
    python3 downgrade_backup_to_12_0_0.py backup.json
    python3 downgrade_backup_to_12_0_0.py backup.json -o backup-12.0.0.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any


# Newest migration function that exists in HiddifyPanel v12.0.0.
PANEL_DB_VERSION = 113

# StrEnum values from hiddifypanel/models at tag v12.0.0.
PROXY_TRANSPORTS = {
    "h2",
    "grpc",
    "faketls",
    "shadowtls",
    "restls1_2",
    "restls1_3",
    "WS",
    "tcp",
    "ssh",
    "httpupgrade",
    "xhttp",
    "custom",
    "shadowsocks",
    "udp",
}
PROXY_CDNS = {"CDN", "direct", "Fake", "relay"}
PROXY_PROTOS = {
    "vless",
    "trojan",
    "vmess",
    "ss",
    "v2ray",
    "ssr",
    "ssh",
    "tuic",
    "hysteria",
    "hysteria2",
    "wireguard",
    "naive",
    "mieru",
}
PROXY_L3 = {
    "tls",
    "tls_h2",
    "tls_h2_h1",
    "h3_quic",
    "reality",
    "http",
    "kcp",
    "ssh",
    "udp",
    "custom",
}
DOMAIN_MODES = {
    "direct",
    "sub_link_only",
    "cdn",
    "auto_cdn_ip",
    "relay",
    "worker",
    "fake",
    "reality",
    "special_reality_tcp",
    "special_reality_xhttp",
    "special_reality_grpc",
    "old_xtls_direct",
}
CHILD_MODES = {"virtual", "remote", "parent"}

# ConfigEnum member names at tag v12.0.0. Unknown keys are skipped by
# add_or_update_config, but db_version is read separately and must stay.
CONFIG_KEYS = {
    "create_easysetup_link",
    "wireguard_enable",
    "wireguard_port",
    "wireguard_ipv6",
    "wireguard_ipv4",
    "wireguard_private_key",
    "wireguard_public_key",
    "wireguard_noise_trick",
    "ssh_server_redis_url",
    "ssh_server_port",
    "ssh_server_enable",
    "first_setup",
    "core_type",
    "warp_enable",
    "warp_mode",
    "warp_plus_code",
    "warp_sites",
    "dns_server",
    "reality_fallback_domain",
    "reality_server_names",
    "reality_short_ids",
    "reality_private_key",
    "reality_public_key",
    "reality_port",
    "special_port",
    "restls1_2_domain",
    "restls1_3_domain",
    "show_usage_in_sublink",
    "cloudflare",
    "license",
    "country",
    "package_mode",
    "utls",
    "telegram_bot_token",
    "is_parent",
    "parent_panel",
    "parent_domain",
    "parent_admin_proxy_path",
    "panel_mode",
    "log_level",
    "unique_id",
    "last_hash",
    "cdn_forced_host",
    "lang",
    "admin_lang",
    "admin_secret",
    "default_useragent_string",
    "use_ip_in_config",
    "tls_ports",
    "tls_fragment_enable",
    "tls_fragment_size",
    "tls_fragment_sleep",
    "tls_fragment_packets",
    "tls_mixed_case",
    "tls_padding_enable",
    "tls_padding_length",
    "tls_ech_enable",
    "mux_enable",
    "mux_protocol",
    "mux_max_connections",
    "mux_min_streams",
    "mux_max_streams",
    "mux_padding_enable",
    "mux_brutal_enable",
    "mux_brutal_up_mbps",
    "mux_brutal_down_mbps",
    "http_ports",
    "mieru_tcp_ports",
    "mieru_udp_ports",
    "kcp_ports",
    "kcp_enable",
    "decoy_domain",
    "proxy_path",
    "proxy_path_admin",
    "proxy_path_client",
    "firewall",
    "netdata",
    "http_proxy_enable",
    "block_iran_sites",
    "allow_invalid_sni",
    "auto_update",
    "speed_test",
    "only_ipv4",
    "shared_secret",
    "telegram_enable",
    "telegram_adtag",
    "telegram_lib",
    "telegram_fakedomain",
    "v2ray_enable",
    "torrent_block",
    "tuic_enable",
    "tuic_port",
    "hysteria_enable",
    "hysteria_port",
    "hysteria_obfs_enable",
    "hysteria_up_mbps",
    "hysteria_down_mbps",
    "shadowsocks2022_enable",
    "shadowsocks2022_method",
    "shadowsocks2022_port",
    "ssfaketls_enable",
    "ssfaketls_fakedomain",
    "shadowtls_enable",
    "shadowtls_fakedomain",
    "ssr_enable",
    "ssr_fakedomain",
    "vmess_enable",
    "domain_fronting_domain",
    "domain_fronting_http_enable",
    "domain_fronting_tls_enable",
    "ws_enable",
    "grpc_enable",
    "httpupgrade_enable",
    "xhttp_enable",
    "naive_enable",
    "naive_port",
    "mieru_enable",
    "mieru_multiplexing",
    "mieru_handshake",
    "vless_enable",
    "trojan_enable",
    "reality_enable",
    "tcp_enable",
    "quic_enable",
    "xtls_enable",
    "h2_enable",
    "db_version",
    "last_priodic_usage_check",
    "branding_title",
    "branding_site",
    "branding_freetext",
    "not_found",
    "path_vmess",
    "path_vless",
    "path_trojan",
    "path_naive",
    "path_v2ray",
    "path_ss",
    "path_xhttp",
    "path_httpupgrade",
    "path_ws",
    "path_tcp",
    "path_grpc",
    "sub_full_singbox_enable",
    "sub_singbox_ssh_enable",
    "sub_full_xray_json_enable",
    "sub_full_links_enable",
    "sub_full_links_b64_enable",
    "sub_full_clash_enable",
    "sub_full_clash_meta_enable",
    "ssh_host_rsa_pk",
    "ssh_host_rsa_pub",
    "ssh_host_ed25519_pk",
    "ssh_host_ed25519_pub",
    "ssh_host_ecdsa_pk",
    "ssh_host_ecdsa_pub",
    "ssh_host_dsa_pk",
    "ssh_host_dsa_pub",
    "hiddifycli_enable",
}

# 12.0.0 Domain.extra_params is VARCHAR(200). 12.3.3 dumps it as an object.
EXTRA_PARAMS_MAX = 200


class BackupError(ValueError):
    pass


def enum_value(value: Any) -> str:
    """Turn ProxyProto.dnstt / 'dnstt' into 'dnstt'."""
    text = str(value).strip()
    if "." in text and text.split(".", 1)[0][:1].isupper():
        text = text.rsplit(".", 1)[-1]
    return text


def convert_backup(data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(data, dict):
        raise BackupError("Backup root must be a JSON object.")
    for key in ("users", "domains", "proxies", "hconfigs", "admin_users", "childs"):
        if key in data and not isinstance(data[key], list):
            raise BackupError(f"'{key}' must be a list.")

    notes: list[str] = []
    out = dict(data)

    removed_domains = _convert_domains(out, notes)
    _convert_proxies(out, notes)
    _convert_configs(out, notes)
    _convert_childs(out, notes)
    _scrub_domain_links(out, removed_domains, notes)
    return out, notes


def _convert_domains(data: dict[str, Any], notes: list[str]) -> set[str]:
    removed: set[str] = set()
    kept: list[dict[str, Any]] = []
    for domain in data.get("domains") or []:
        if not isinstance(domain, dict) or "domain" not in domain:
            notes.append("dropped a domain row without a domain name")
            continue
        mode = enum_value(domain.get("mode", ""))
        name = str(domain["domain"])
        if mode not in DOMAIN_MODES:
            removed.add(name.lower())
            notes.append(f"dropped domain {name} (mode {mode} is not in panel 12.0.0)")
            continue
        row = dict(domain)
        row["mode"] = mode
        if "extra_params" in row:
            row["extra_params"] = _extra_params_string(row["extra_params"])
        row.pop("internal_port_dnstt", None)
        kept.append(row)
    data["domains"] = kept
    return removed


def _extra_params_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) > EXTRA_PARAMS_MAX:
        return ""
    return text


def _scrub_domain_links(data: dict[str, Any], removed: set[str], notes: list[str]) -> None:
    if not removed:
        return
    for domain in data.get("domains") or []:
        shows = domain.get("show_domains") or []
        if isinstance(shows, list):
            filtered = [item for item in shows if str(item).lower() not in removed]
            if len(filtered) != len(shows):
                notes.append(f"removed dropped domains from show_domains of {domain.get('domain')}")
            domain["show_domains"] = filtered
        download = domain.get("download_domain")
        if download and str(download).lower() in removed:
            notes.append(f"cleared download_domain of {domain.get('domain')} (it pointed at a dropped domain)")
            domain["download_domain"] = ""


def _proxy_ok(proxy: dict[str, Any]) -> str | None:
    checks = (
        ("proto", PROXY_PROTOS),
        ("l3", PROXY_L3),
        ("transport", PROXY_TRANSPORTS),
        ("cdn", PROXY_CDNS),
    )
    for field, allowed in checks:
        value = enum_value(proxy.get(field, ""))
        if value not in allowed:
            return f"{field}={value}"
    return None


def _proxy_signature(row: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (str(row.get("name", "")), row["proto"], row["l3"], row["transport"], row["cdn"])


def _convert_proxies(data: dict[str, Any], notes: list[str]) -> None:
    """Drop rows 12.0.0 cannot store, then make proxy names unique.

    Proxy.add_or_update() looks up a row by name only. Identical copies
    (the same name, proto, l3, transport and cdn) collapse to the last
    copy. Rows that share a name but are different transports, such as
    several Reality proxies saved with a blank name, get distinct names
    so the restore keeps each of them.
    """
    collapsed: OrderedDict[tuple[str, str, str, str, str], dict[str, Any]] = OrderedDict()
    for proxy in data.get("proxies") or []:
        if not isinstance(proxy, dict):
            notes.append("dropped a proxy row that is not an object")
            continue
        reason = _proxy_ok(proxy)
        name = str(proxy.get("name", ""))
        if reason:
            notes.append(f"dropped proxy {name or '(unnamed)'} ({reason} is not in panel 12.0.0)")
            continue
        row = dict(proxy)
        row["name"] = name
        for field in ("proto", "l3", "transport", "cdn"):
            row[field] = enum_value(row.get(field, ""))
        row["params"] = _proxy_params(row.get("params"))
        signature = _proxy_signature(row)
        if signature in collapsed:
            notes.append(
                f"merged duplicate proxy {name or '(unnamed)'} "
                f"({row['proto']}/{row['transport']}/{row['l3']}/{row['cdn']})"
            )
        collapsed[signature] = row

    rows = list(collapsed.values())
    name_counts: dict[str, int] = {}
    for row in rows:
        name_counts[row["name"]] = name_counts.get(row["name"], 0) + 1
    used = {row["name"] for row in rows if row["name"] and name_counts[row["name"]] == 1}

    for row in rows:
        if row["name"] and name_counts[row["name"]] == 1:
            continue
        original = row["name"]
        base = original.strip() or f"{row['l3']} {row['transport']} {row['cdn']} {row['proto']}"
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base} {suffix}"
            suffix += 1
        row["name"] = candidate
        used.add(candidate)
        label = original or "(unnamed)"
        notes.append(
            f"renamed proxy {label} ({row['proto']}/{row['transport']}/{row['l3']}) to {candidate}"
        )
    data["proxies"] = rows


def _proxy_params(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _convert_configs(data: dict[str, Any], notes: list[str]) -> None:
    kept: list[dict[str, Any]] = []
    seen_db_version = False
    for conf in data.get("hconfigs") or []:
        if not isinstance(conf, dict) or "key" not in conf:
            notes.append("dropped a config row without a key")
            continue
        key = enum_value(conf.get("key", ""))
        if key not in CONFIG_KEYS:
            notes.append(f"dropped setting {key} (not in panel 12.0.0)")
            continue
        row = dict(conf)
        row["key"] = key
        if key == "db_version":
            seen_db_version = True
            original = row.get("value")
            try:
                current = int(original)
            except (TypeError, ValueError):
                current = PANEL_DB_VERSION + 1
            if current > PANEL_DB_VERSION:
                row["value"] = "113" if isinstance(original, str) else PANEL_DB_VERSION
                notes.append(
                    f"set db_version from {original} to {row['value']} "
                    f"(12.0.0 stops at migration {PANEL_DB_VERSION})"
                )
        kept.append(row)
    if not seen_db_version:
        child_id = ""
        childs = data.get("childs") or []
        if childs and isinstance(childs[0], dict):
            child_id = childs[0].get("unique_id") or ""
        kept.append({"key": "db_version", "value": str(PANEL_DB_VERSION), "child_unique_id": child_id})
        notes.append(f"added db_version {PANEL_DB_VERSION} (backup had none; the downgrade installer requires it)")
    data["hconfigs"] = kept


def _convert_childs(data: dict[str, Any], notes: list[str]) -> None:
    kept: list[dict[str, Any]] = []
    for child in data.get("childs") or []:
        if not isinstance(child, dict):
            notes.append("dropped a child row that is not an object")
            continue
        mode = enum_value(child.get("mode", ""))
        if mode not in CHILD_MODES:
            notes.append(f"dropped child {child.get('name')} (mode {mode} is not in panel 12.0.0)")
            continue
        row = dict(child)
        row["mode"] = mode
        kept.append(row)
    if "childs" in data:
        data["childs"] = kept


def users_only_backup(data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Keep accounts only.

    Panel 12.0.0 always reads admin_users while restoring users, because
    each user points at an admin via added_by_uuid. Domains, proxies,
    settings, and the node record are omitted, so a restore cannot apply
    the 12.3.3 proxy schema.
    """
    if not isinstance(data, dict):
        raise BackupError("Backup root must be a JSON object.")
    users = data.get("users")
    admins = data.get("admin_users")
    if not isinstance(users, list) or not isinstance(admins, list):
        raise BackupError("Backup must contain 'users' and 'admin_users' lists.")

    admin_uuids = {str(admin.get("uuid")) for admin in admins if isinstance(admin, dict)}
    missing = sorted({
        str(user.get("added_by_uuid"))
        for user in users
        if isinstance(user, dict) and user.get("added_by_uuid") and str(user.get("added_by_uuid")) not in admin_uuids
    })
    notes = [
        f"kept {len(users)} users and {len(admins)} admins",
        "removed domains, proxies, settings, and the node record",
    ]
    if missing:
        notes.append(f"{len(missing)} users point at an admin that is not in this file")
    return {"users": users, "admin_users": admins}, notes


def default_output_path(source: Path, users_only: bool = False) -> Path:
    suffix = source.suffix or ".json"
    marker = "users-only" if users_only else "12.0.0"
    return source.with_name(f"{source.stem}.{marker}{suffix}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rewrite a Hiddify 12.3.x backup so panel 12.0.0 can restore it.")
    parser.add_argument("backup", type=Path, help="Path to the JSON backup from panel 12.3.3")
    parser.add_argument("-o", "--output", type=Path, help="Where to write the backup")
    parser.add_argument("--users-only", action="store_true", help="Keep users and their admins, drop domains, proxies, and settings")
    args = parser.parse_args(argv)

    source: Path = args.backup
    if not source.is_file():
        print(f"File not found: {source}", file=sys.stderr)
        return 2
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
        if args.users_only:
            converted, notes = users_only_backup(data)
        else:
            converted, notes = convert_backup(data)
    except (json.JSONDecodeError, BackupError) as exc:
        print(f"Cannot convert {source}: {exc}", file=sys.stderr)
        return 2

    target = args.output or default_output_path(source, users_only=args.users_only)
    target.write_text(json.dumps(converted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target}")
    if notes:
        print("Changes:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("No 12.3.3-only fields found. The file already matches panel 12.0.0.")
    if args.users_only:
        print("Restore it in 12.0.0: Settings → Backup, enable only Restore Users.")
    else:
        print("Restore it in 12.0.0: Settings → Backup, enable settings, users, and domains.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
