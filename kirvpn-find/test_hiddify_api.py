#!/usr/bin/env python3
"""Mocked checks for the Hiddify admin API client. No live servers."""
from __future__ import annotations

import json
import threading
import time
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import app
import hiddify_api
import testing

KEY = "11111111-1111-4111-8111-111111111111"
OTHER_KEY = "22222222-2222-4222-8222-222222222222"
ADMIN = "AdminPath12"
EMPTY = "EmptyPath99"
LINKS = "LinkPath12"
SLOW = "SlowPath12"
CLIENT = "ClientPath12"
ANNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DANA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
BORIS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CARA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
TODAY = date.today().isoformat()
OLD = (date.today() - timedelta(days=40)).isoformat()

USERS = [
    {
        "id": 7,
        "name": "Anna",
        "enable": True,
        "usage_limit_GB": 10,
        "current_usage_GB": 1.5,
        "package_days": 30,
        "start_date": TODAY,
        "uuid": ANNA,
        "comment": "",
        "telegram_id": None,
        "last_online": "2026-10-01T00:00:00",
    },
    {
        "id": 8,
        "name": "Boris",
        "enable": True,
        "usage_limit_GB": 5,
        "current_usage_GB": 0,
        "package_days": 10,
        "start_date": OLD,
        "uuid": BORIS,
        "comment": "call +7 (999) 123-45-67",
        "username": "boris",
        "telegram_id": 79991234567,
        "last_online": "2026-10-15T00:00:00",
    },
    {
        "id": 9,
        "name": "Cara Off",
        "enable": False,
        "usage_limit_GB": 1,
        "current_usage_GB": 0,
        "package_days": 30,
        "start_date": TODAY,
        "uuid": CARA,
        "comment": "",
        "last_online": "2026-09-01T00:00:00",
    },
    {
        "id": 10,
        "name": "Dana",
        "enable": True,
        "usage_limit_GB": 2,
        "current_usage_GB": 0,
        "package_days": 0,
        "start_date": OLD,
        "uuid": DANA,
        "comment": "dana-note",
        "last_online": "2026-10-16T12:00:00",
    },
]

SEEN = []
BRANDING = {}


def _prefix(path_name: str) -> str:
    return "/%s/api/v2/admin/" % path_name


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _read(self) -> bytes:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        return self.rfile.read(n) if n else b""

    def _send(self, code: int, obj) -> None:
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth_ok(self) -> bool:
        return self.headers.get("Hiddify-API-Key") == KEY

    def _dispatch(self, method: str, body: bytes) -> None:
        path = self.path.split("?", 1)[0]
        SEEN.append({
            "method": method,
            "path": path,
            "query": self.path.split("?", 1)[1] if "?" in self.path else "",
            "key": self.headers.get("Hiddify-API-Key") or "",
            "body": body.decode("utf-8", "replace"),
        })
        if not self._auth_ok():
            self._send(401, {"message": "unauthorized"})
            return
        if SLOW in path:
            time.sleep(2)
            self._send(200, [])
            return
        if path == _prefix(EMPTY) + "user/":
            self._send(404, {"message": "You have no user"})
            return
        if path == _prefix(ADMIN) + "user/":
            self._send(200, USERS)
            return
        if path == _prefix(ADMIN) + "all-configs/":
            self._send(200, {
                "domains": [
                    {"domain": "cdn.kirvpn.us", "mode": "cdn"},
                    {"domain": "only-sub.kirvpn.us", "mode": "sub_link_only"},
                    {"domain": "12.kirvpn.us", "mode": "direct"},
                ],
                "chconfigs": {"0": {"proxy_path_client": CLIENT, "proxy_path_admin": ADMIN}},
                "api_key": "do-not-keep",
            })
            return
        if path == _prefix(LINKS) + "user/":
            self._send(200, [USERS[0]])
            return
        if path == _prefix(LINKS) + "all-configs/":
            self._send(404, {"message": "missing"})
            return
        if path == _prefix(LINKS) + "users/":
            self._send(200, {
                "users": [],
                "link_domains": [{
                    "domain": "12.kirvpn.us",
                    "kind": "direct",
                    "base": "https://12.kirvpn.us/%s/" % CLIENT,
                }],
            })
            return
        if path == _prefix(ADMIN) + "settings/" and method == "PUT":
            BRANDING["body"] = json.loads(body.decode("utf-8") or "{}")
            self._send(200, {"changed": ["branding_freetext"]})
            return
        self._send(404, {"message": "missing"})

    def do_GET(self):
        self._dispatch("GET", b"")

    def do_PUT(self):
        self._dispatch("PUT", self._read())


def _node(port: int, path: str = ADMIN, **extra) -> dict:
    row = {
        "label": "12",
        "panel_url": "http://127.0.0.1:%s" % port,
        "admin_proxy_path": path,
        "api_key": KEY,
        "ip": "203.0.113.30",
        "announce": "api",
    }
    row.update(extra)
    return row


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def setUp(self):
        SEEN.clear()
        BRANDING.clear()
        hiddify_api.clear_cache()
        hiddify_api.LINK_CACHE_SEC = 0

    def test_search_links_traffic_and_days(self):
        hit = app.search_node(_node(self.port), "Ann")
        self.assertIsNone(hit["error"])
        self.assertEqual(len(hit["users"]), 1)
        user = hit["users"][0]
        self.assertEqual(user["name"], "Anna")
        self.assertTrue(user["enable"])
        self.assertEqual(user["days"], "30д")
        self.assertEqual(user["traffic"], "8.5ГБ")
        self.assertEqual(
            user["url"],
            "https://12.kirvpn.us/%s/%s/" % (CLIENT, ANNA),
        )
        self.assertIn("/admin/user/?search=Ann", hit["admin_url"])
        self.assertTrue(hit["admin_url"].startswith(
            "https://12.kirvpn.us/%s/%s/" % (ADMIN, KEY)
        ))
        paths = [row["path"] for row in SEEN]
        self.assertTrue(any(p.endswith("/user/") for p in paths))
        self.assertFalse(any("Ann" in p or "mysql" in p or "SELECT" in p for p in paths))
        self.assertTrue(all(row["query"] == "" for row in SEEN))
        self.assertTrue(all(row["key"] == KEY for row in SEEN))

    def test_quote_is_not_sent_to_the_panel(self):
        hit = app.search_node(_node(self.port), "Anna' OR 1=1; SELECT")
        self.assertIsNone(hit["error"])
        blob = " ".join(row["path"] + row["query"] + row["body"] for row in SEEN)
        self.assertNotIn("SELECT", blob)
        self.assertNotIn("'", blob)

    def test_pro_phone_uuid_and_note(self):
        phone = app.search_pro_node(_node(self.port), {
            "uuid": "",
            "needle": "",
            "phones": ["9991234567", "79991234567"],
            "name_hint": "",
        })
        self.assertEqual([u["name"] for u in phone["users"]], ["Boris"])
        self.assertIn("телефон", phone["users"][0]["match"])
        self.assertIn("telegram", phone["users"][0]["match"])
        self.assertTrue(phone["users"][0]["url"].endswith("/admin/user/edit/?id=8"))

        by_uuid = app.search_pro_node(_node(self.port), {
            "uuid": ANNA,
            "needle": "",
            "phones": [],
            "name_hint": "",
        })
        self.assertEqual([u["name"] for u in by_uuid["users"]], ["Anna"])
        self.assertEqual(by_uuid["users"][0]["match"], ["uuid"])

        by_note = app.search_pro_node(_node(self.port), {
            "uuid": "",
            "needle": "dana-note",
            "phones": [],
            "name_hint": "",
        })
        self.assertEqual([u["name"] for u in by_note["users"]], ["Dana"])
        self.assertIn("заметка", by_note["users"][0]["match"])

    def test_user_counts_match_old_sql_buckets(self):
        row = app.users_node(_node(self.port))
        self.assertIsNone(row["error"])
        self.assertEqual(row["total"], 4)
        self.assertEqual(row["active"], 2)
        self.assertEqual(row["expired"], 1)
        self.assertEqual(row["disabled"], 1)
        self.assertTrue(row["admin_url"].endswith("/admin/user/"))

    def test_empty_panel_is_not_an_error(self):
        row = app.users_node(_node(self.port, EMPTY, label="99"))
        self.assertIsNone(row["error"])
        self.assertEqual(row["total"], 0)

    def test_dead_server_does_not_hide_the_live_one(self):
        live = _node(self.port)
        dead = _node(1, label="13", ip="203.0.113.99", timeout=1)
        hits = [app.search_node(live, "Dana"), app.search_node(dead, "Dana")]
        good = [h for h in hits if h["users"]]
        bad = [h for h in hits if h["error"]]
        self.assertEqual(len(good), 1)
        self.assertEqual(good[0]["users"][0]["name"], "Dana")
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0]["label"], "13")

    def test_timeout_is_reported(self):
        hit = app.search_node(_node(self.port, SLOW, timeout=1), "Anna")
        self.assertEqual(hit["error"], "timeout")
        self.assertEqual(hit["users"], [])

    def test_wrong_key_and_bad_config(self):
        hit = app.search_node(_node(self.port, api_key=OTHER_KEY), "Anna")
        self.assertEqual(hit["error"], "ключ API не принят")
        with self.assertRaises(hiddify_api.HiddifyError):
            hiddify_api.describe({"panel_url": "http://example.com", "admin_proxy_path": ADMIN, "api_key": KEY})
        with self.assertRaises(hiddify_api.HiddifyError):
            hiddify_api.list_users({"label": "12"})

    def test_link_fallback_when_all_configs_missing(self):
        hit = app.search_node(_node(self.port, LINKS), "Anna")
        self.assertIsNone(hit["error"])
        self.assertEqual(hit["users"][0]["url"], "https://12.kirvpn.us/%s/%s/" % (CLIENT, ANNA))

    def test_subscription_path_uses_latest_active_user(self):
        path = hiddify_api.subscription_path(_node(self.port))
        self.assertEqual(path, "/%s/%s/all.txt" % (CLIENT, DANA))

    def test_branding_put_is_the_api_announcement(self):
        result = app.push_one(_node(self.port), "сегодня ночью пауза")
        self.assertTrue(result["ok"])
        self.assertEqual(result["via"], "api")
        self.assertEqual(
            BRANDING["body"],
            {"values": {"branding_freetext": "сегодня ночью пауза"}},
        )
        ssh = app.push_one(_node(self.port, announce="ssh", ip=""), "текст")
        self.assertFalse(ssh["ok"])
        self.assertEqual(ssh["via"], "ssh")
        self.assertIn("ip", ssh["error"])

    def test_domain_preference_and_buckets(self):
        domain = hiddify_api.pick_domain([
            {"domain": "cdn.kirvpn.us", "mode": "cdn"},
            {"domain": "only-sub.kirvpn.us", "mode": "sub_link_only"},
            {"domain": "not-ours.example", "mode": "direct"},
            {"domain": "12.kirvpn.us", "mode": "direct"},
        ])
        self.assertEqual(domain, "12.kirvpn.us")
        self.assertEqual(hiddify_api.account_bucket({"enable": False, "package_days": 1, "start_date": OLD}), "disabled")
        self.assertEqual(hiddify_api.account_bucket({"enable": True, "package_days": 10, "start_date": OLD}), "expired")
        self.assertEqual(hiddify_api.account_bucket({"enable": True, "package_days": 0, "start_date": OLD}), "active")

    def test_reboot_and_relays_are_optional_ssh(self):
        previous = testing.SSH_KEY
        testing.SSH_KEY = "/no/such/kirvpn-id_ed25519"
        try:
            stopped = testing.start_reboot("relays", "REBOOT")
        finally:
            testing.SSH_KEY = previous
        self.assertFalse(stopped["ok"])
        self.assertIn("SSH-ключ", stopped["error"])
        relays = testing.unique_relays({"servers": [
            {"label": "1", "rf_ssh": "203.0.113.40", "ssh": False, "origin": "203.0.113.30"},
            {"label": "2", "rf_ssh": "203.0.113.41", "origin": "203.0.113.31"},
        ]})
        self.assertEqual([row["ip"] for row in relays], ["203.0.113.41"])


if __name__ == "__main__":
    unittest.main()
