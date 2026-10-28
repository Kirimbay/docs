from __future__ import annotations

import base64
import json
import time

from hiddify_nl_exit.merge import (
    merge_clash,
    merge_singbox,
    merge_subscription_bodies,
    parse_userinfo_expired,
    parse_uuid_from_path,
)
from hiddify_nl_exit.sync import is_live_sweden_user, sanitize_name


def test_parse_uuid_from_path() -> None:
    uuid = "6ebd2ea8-4d41-48b7-8fc2-7d6570da30a9"
    assert parse_uuid_from_path(f"/SePath/{uuid}/singbox/", "SePath") == uuid
    assert parse_uuid_from_path(f"/SePath/{uuid}", "SePath") == uuid
    assert parse_uuid_from_path(f"/other/{uuid}/singbox/", "SePath") is None
    assert parse_uuid_from_path("/SePath/not-a-uuid/singbox/", "SePath") is None


def test_parse_userinfo_expired() -> None:
    now = 1_800_000_000
    assert parse_userinfo_expired(f"upload=0;download=10;total=100;expire={now - 10}", now) is True
    assert parse_userinfo_expired(f"upload=0;download=10;total=100;expire={now + 10}", now) is False
    assert parse_userinfo_expired("upload=0;download=100;total=100;expire=9999999999", now) is True


def test_merge_singbox_adds_nl_to_selector() -> None:
    sweden = {
        "outbounds": [
            {"type": "selector", "tag": "select", "outbounds": ["se-vless"]},
            {"type": "urltest", "tag": "auto", "outbounds": ["se-vless"]},
            {"type": "vless", "tag": "se-vless", "server": "se.example.com"},
            {"type": "direct", "tag": "direct"},
        ]
    }
    netherlands = {
        "outbounds": [
            {"type": "selector", "tag": "select", "outbounds": ["nl-vless"]},
            {"type": "direct", "tag": "direct"},
            {"type": "vless", "tag": "nl-vless", "server": "nl.example.com"},
            {"type": "hysteria2", "tag": "nl-hy2", "server": "nl.example.com"},
        ]
    }
    merged = merge_singbox(sweden, netherlands)
    tags = [item["tag"] for item in merged["outbounds"]]
    assert tags.count("direct") == 1
    assert tags.count("select") == 1
    assert "nl-vless" in tags
    assert "nl-hy2" in tags
    selector = next(item for item in merged["outbounds"] if item["tag"] == "select")
    assert "nl-vless" in selector["outbounds"]
    assert "nl-hy2" in selector["outbounds"]


def test_merge_clash_adds_proxy_and_group() -> None:
    sweden = {
        "proxies": [{"name": "SE", "type": "vless", "server": "se.example.com"}],
        "proxy-groups": [{"name": "PROXY", "type": "select", "proxies": ["SE"]}],
    }
    netherlands = {
        "proxies": [{"name": "NL", "type": "vless", "server": "nl.example.com"}],
        "proxy-groups": [{"name": "PROXY", "type": "select", "proxies": ["NL"]}],
    }
    merged = merge_clash(sweden, netherlands)
    names = [p["name"] for p in merged["proxies"]]
    assert names == ["SE", "NL"]
    assert "NL" in merged["proxy-groups"][0]["proxies"]


def test_merge_base64_uri_list() -> None:
    se = base64.b64encode(b"vless://uuid@se.example.com:443#SE\n").decode()
    nl = "vless://uuid@nl.example.com:443#NL\n"
    merged = merge_subscription_bodies(se, nl)
    decoded = base64.b64decode(merged).decode()
    assert "se.example.com" in decoded
    assert "nl.example.com" in decoded


def test_html_is_not_merged() -> None:
    html = "<html><body>user panel</body></html>"
    nl = "vless://uuid@nl.example.com:443#NL\n"
    assert merge_subscription_bodies(html, nl) == html


def test_is_live_sweden_user() -> None:
    assert is_live_sweden_user({"enable": True, "is_active": True}) is True
    assert is_live_sweden_user({"enable": True, "is_active": False}) is False
    assert is_live_sweden_user({"enable": False, "is_active": True}) is False


def test_sanitize_name() -> None:
    assert sanitize_name("se01", "Иван / test") == "se01-Иван-test"


def test_singbox_json_subscription_merge() -> None:
    sweden = json.dumps(
        {
            "outbounds": [
                {"type": "selector", "tag": "select", "outbounds": ["se"]},
                {"type": "vless", "tag": "se", "server": "1.1.1.1"},
            ]
        }
    )
    netherlands = json.dumps(
        {
            "outbounds": [
                {"type": "vless", "tag": "nl", "server": "2.2.2.2"},
            ]
        }
    )
    merged = json.loads(merge_subscription_bodies(sweden, netherlands))
    assert any(item.get("tag") == "nl" for item in merged["outbounds"])
    selector = next(item for item in merged["outbounds"] if item["tag"] == "select")
    assert "nl" in selector["outbounds"]


def test_userinfo_not_expired_without_header() -> None:
    assert parse_userinfo_expired(None, int(time.time())) is False
