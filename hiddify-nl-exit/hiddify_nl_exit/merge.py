from __future__ import annotations

import base64
import json
import re
from typing import Any
from urllib.parse import unquote

import yaml

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

PROXY_OUTBOUND_TYPES = {
    "vless",
    "vmess",
    "trojan",
    "shadowsocks",
    "hysteria",
    "hysteria2",
    "tuic",
    "wireguard",
    "ssh",
    "naive",
    "shadowtls",
    "anytls",
    "mieru",
    "vless-flow",
}

GROUP_OUTBOUND_TYPES = {"selector", "urltest", "loadbalance"}

URI_PREFIXES = (
    "vless://",
    "vmess://",
    "trojan://",
    "ss://",
    "ssr://",
    "hysteria2://",
    "hy2://",
    "tuic://",
    "wireguard://",
    "hysteria://",
    "anytls://",
)


def parse_uuid_from_path(path: str, user_proxy_path: str) -> str | None:
    parts = [p for p in unquote(path).split("/") if p]
    if len(parts) < 2:
        return None
    if parts[0] != user_proxy_path.strip("/"):
        return None
    candidate = parts[1]
    return candidate if UUID_RE.match(candidate) else None


def parse_userinfo_expired(header: str | None, now_ts: int) -> bool:
    if not header:
        return False
    fields = {}
    for chunk in header.split(";"):
        if "=" not in chunk:
            continue
        key, value = chunk.strip().split("=", 1)
        fields[key.strip()] = value.strip()
    try:
        expire = int(fields["expire"])
        if expire and expire < now_ts:
            return True
    except (KeyError, ValueError):
        pass
    try:
        download = int(fields.get("download") or 0)
        total = int(fields.get("total") or 0)
        if total > 0 and download >= total:
            return True
    except ValueError:
        pass
    return False


def looks_like_html(body: str) -> bool:
    stripped = body.lstrip().lower()
    return stripped.startswith("<!doctype") or stripped.startswith("<html") or "<head" in stripped[:200]


def _b64_decode(text: str) -> str | None:
    compact = "".join(text.split())
    if not compact:
        return None
    padding = "=" * (-len(compact) % 4)
    try:
        decoded = base64.b64decode(compact + padding, validate=False).decode("utf-8")
    except Exception:
        return None
    if any(decoded.lower().startswith(prefix) or f"\n{prefix}" in decoded.lower() for prefix in URI_PREFIXES):
        return decoded
    if "proxies:" in decoded or '"outbounds"' in decoded:
        return decoded
    return None


def _b64_encode(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def extract_uri_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        lower = line.lower()
        if lower.startswith("#") or lower.startswith("//"):
            lines.append(line)
            continue
        if any(lower.startswith(prefix) for prefix in URI_PREFIXES):
            lines.append(line)
    return lines


def merge_uri_lists(sweden: str, netherlands: str) -> str:
    se_lines = extract_uri_lines(sweden)
    nl_lines = extract_uri_lines(netherlands)
    seen = set(se_lines)
    out = list(se_lines)
    for line in nl_lines:
        if line not in seen:
            out.append(line)
            seen.add(line)
    return "\n".join(out) + ("\n" if out else "")


def _unique_tag(tag: str, existing: set[str]) -> str:
    tag = tag or "Netherlands"
    if tag not in existing:
        return tag
    if "🇳🇱" not in tag:
        tagged = f"🇳🇱 {tag}"
        if tagged not in existing:
            return tagged
        tag = tagged
    index = 2
    while f"{tag}-{index}" in existing:
        index += 1
    return f"{tag}-{index}"


def merge_singbox(sweden: dict[str, Any], netherlands: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(sweden))
    se_out = merged.setdefault("outbounds", [])
    existing = {item.get("tag") for item in se_out if isinstance(item, dict) and item.get("tag")}
    nl_tags: list[str] = []

    for item in netherlands.get("outbounds") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") not in PROXY_OUTBOUND_TYPES:
            continue
        outbound = json.loads(json.dumps(item))
        outbound["tag"] = _unique_tag(str(outbound.get("tag") or "Netherlands"), existing)
        existing.add(outbound["tag"])
        se_out.append(outbound)
        nl_tags.append(outbound["tag"])

    for item in netherlands.get("endpoints") or []:
        if isinstance(item, dict):
            merged.setdefault("endpoints", []).append(json.loads(json.dumps(item)))

    if not nl_tags:
        return merged

    for item in se_out:
        if not isinstance(item, dict):
            continue
        if item.get("type") not in GROUP_OUTBOUND_TYPES:
            continue
        members = item.setdefault("outbounds", [])
        if not isinstance(members, list):
            continue
        for tag in nl_tags:
            if tag not in members:
                members.append(tag)
    return merged


def merge_clash(sweden: dict[str, Any], netherlands: dict[str, Any]) -> dict[str, Any]:
    merged = yaml.safe_load(yaml.safe_dump(sweden)) or {}
    se_proxies = merged.setdefault("proxies", [])
    if not isinstance(se_proxies, list):
        se_proxies = []
        merged["proxies"] = se_proxies
    existing = {p.get("name") for p in se_proxies if isinstance(p, dict) and p.get("name")}
    nl_names: list[str] = []
    for proxy in netherlands.get("proxies") or []:
        if not isinstance(proxy, dict):
            continue
        item = dict(proxy)
        item["name"] = _unique_tag(str(item.get("name") or "Netherlands"), existing)
        existing.add(item["name"])
        se_proxies.append(item)
        nl_names.append(item["name"])
    if nl_names:
        for group in merged.get("proxy-groups") or []:
            if not isinstance(group, dict):
                continue
            members = group.setdefault("proxies", [])
            if not isinstance(members, list):
                continue
            for name in nl_names:
                if name not in members:
                    members.append(name)
    return merged


def _try_json(text: str) -> Any | None:
    try:
        return json.loads(text)
    except ValueError:
        return None


def _try_yaml(text: str) -> Any | None:
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def merge_subscription_bodies(sweden_body: str, netherlands_body: str) -> str:
    if not netherlands_body.strip() or looks_like_html(netherlands_body):
        return sweden_body
    if looks_like_html(sweden_body):
        return sweden_body

    se_json = _try_json(sweden_body)
    nl_json = _try_json(netherlands_body)
    if isinstance(se_json, dict) and isinstance(nl_json, dict) and "outbounds" in se_json:
        return json.dumps(merge_singbox(se_json, nl_json), ensure_ascii=False, indent=2)
    if isinstance(se_json, list) and isinstance(nl_json, list):
        return json.dumps(se_json + nl_json, ensure_ascii=False, indent=2)

    se_yaml = _try_yaml(sweden_body) if se_json is None else None
    nl_yaml = _try_yaml(netherlands_body) if nl_json is None else (nl_json if isinstance(nl_json, dict) else None)
    if isinstance(se_yaml, dict) and "proxies" in se_yaml and isinstance(nl_yaml, dict):
        return yaml.safe_dump(merge_clash(se_yaml, nl_yaml), allow_unicode=True, sort_keys=False)

    se_plain = _b64_decode(sweden_body) or sweden_body
    nl_plain = _b64_decode(netherlands_body) or netherlands_body
    encoded_sweden = _b64_decode(sweden_body) is not None
    merged = merge_uri_lists(se_plain, nl_plain)
    if encoded_sweden:
        return _b64_encode(merged)
    if extract_uri_lines(sweden_body) or extract_uri_lines(netherlands_body):
        return merged
    return sweden_body
