"""Checks for the 12.3.3 → 12.0.0 Hiddify backup rewrite."""

import json
import unittest

from downgrade_backup_to_12_0_0 import (
    CONFIG_KEYS,
    DOMAIN_MODES,
    PANEL_DB_VERSION,
    PROXY_CDNS,
    PROXY_L3,
    PROXY_PROTOS,
    PROXY_TRANSPORTS,
    convert_backup,
)


def sample_backup() -> dict:
    return {
        "childs": [{"id": 0, "name": "Root", "mode": "virtual", "unique_id": "child-1"}],
        "admin_users": [{"uuid": "admin", "name": "owner", "parent_admin_uuid": None}],
        "users": [{"uuid": "user-1", "name": "alice", "added_by_uuid": "admin"}],
        "domains": [
            {
                "domain": "vpn.example.com",
                "mode": "direct",
                "alias": "",
                "child_unique_id": "child-1",
                "cdn_ip": "",
                "servernames": "",
                "grpc": False,
                "download_domain": "dns.example.com",
                "show_domains": ["dns.example.com", "vpn.example.com"],
                "resolve_ip": False,
                "extra_params": {"sni": "example.com", "keep": True},
            },
            {
                "domain": "dns.example.com",
                "mode": "dnstt",
                "child_unique_id": "child-1",
                "extra_params": {},
                "show_domains": [],
            },
        ],
        "proxies": [
            {
                "name": "VLESS TCP REALITY",
                "enable": True,
                "proto": "vless",
                "l3": "reality",
                "transport": "tcp",
                "cdn": "direct",
                "child_unique_id": "child-1",
                "params": {},
            },
            {
                "name": "NaiveTLS",
                "enable": True,
                "proto": "naive",
                "l3": "tls_h2_h1",
                "transport": "custom",
                "cdn": "direct",
                "child_unique_id": "child-1",
                "params": {},
            },
            {
                "name": "NaiveTLS",
                "enable": True,
                "proto": "naive",
                "l3": "tls_h2_h1",
                "transport": "custom",
                "cdn": "relay",
                "child_unique_id": "child-1",
                "params": {},
            },
            {
                "name": "DNSTT",
                "enable": True,
                "proto": "ProxyProto.dnstt",
                "l3": "custom",
                "transport": "custom",
                "cdn": "direct",
                "child_unique_id": "child-1",
                "params": "{\"public_key\": \"abc\"}",
            },
        ],
        "hconfigs": [
            {"key": "db_version", "value": "119", "child_unique_id": "child-1"},
            {"key": "lang", "value": "ru", "child_unique_id": "child-1"},
            {"key": "dnstt_enable", "value": True, "child_unique_id": "child-1"},
            {"key": "dnstt_resolvers", "value": "8.8.8.8:53", "child_unique_id": "child-1"},
            {"key": "dnstt_private_key", "value": "secret", "child_unique_id": "child-1"},
            {"key": "dnstt_public_key", "value": "pub", "child_unique_id": "child-1"},
            {"key": "additional_configs_urls", "value": "", "child_unique_id": "child-1"},
            {"key": "additional_configs_singbox", "value": "{}", "child_unique_id": "child-1"},
            {"key": "additional_configs_xrayjson", "value": "{}", "child_unique_id": "child-1"},
            {"key": "proxy_path_admin", "value": "secret-path", "child_unique_id": "child-1"},
        ],
    }


class ConvertBackupTest(unittest.TestCase):
    def test_strips_12_3_fields_and_keeps_panel_data(self):
        converted, notes = convert_backup(sample_backup())

        self.assertEqual([user["name"] for user in converted["users"]], ["alice"])
        self.assertEqual([admin["uuid"] for admin in converted["admin_users"]], ["admin"])

        domains = {row["domain"]: row for row in converted["domains"]}
        self.assertNotIn("dns.example.com", domains)
        direct = domains["vpn.example.com"]
        self.assertEqual(direct["mode"], "direct")
        self.assertEqual(direct["extra_params"], '{"sni":"example.com","keep":true}')
        self.assertEqual(direct["show_domains"], ["vpn.example.com"])
        self.assertEqual(direct["download_domain"], "")

        names = [row["name"] for row in converted["proxies"]]
        self.assertEqual(names, ["VLESS TCP REALITY", "NaiveTLS", "NaiveTLS 2"])
        self.assertEqual(converted["proxies"][1]["cdn"], "direct")
        self.assertEqual(converted["proxies"][2]["cdn"], "relay")
        self.assertNotIn("dnstt", {row["proto"] for row in converted["proxies"]})

        keys = [row["key"] for row in converted["hconfigs"]]
        self.assertNotIn("dnstt_enable", keys)
        self.assertNotIn("additional_configs_singbox", keys)
        version = next(row for row in converted["hconfigs"] if row["key"] == "db_version")
        self.assertEqual(version["value"], "113")
        self.assertIn("lang", keys)
        self.assertIn("proxy_path_admin", keys)
        self.assertTrue(any("DNSTT" in note for note in notes))

    def test_every_remaining_value_is_valid_on_12_0_0(self):
        converted, _notes = convert_backup(sample_backup())
        for row in converted["domains"]:
            self.assertIn(row["mode"], DOMAIN_MODES)
            self.assertIsInstance(row["extra_params"], str)
            self.assertLessEqual(len(row["extra_params"]), 200)
        for row in converted["proxies"]:
            self.assertIn(row["proto"], PROXY_PROTOS)
            self.assertIn(row["l3"], PROXY_L3)
            self.assertIn(row["transport"], PROXY_TRANSPORTS)
            self.assertIn(row["cdn"], PROXY_CDNS)
            self.assertIsInstance(row["params"], dict)
        for row in converted["hconfigs"]:
            self.assertIn(row["key"], CONFIG_KEYS)
            if row["key"] == "db_version":
                self.assertLessEqual(int(row["value"]), PANEL_DB_VERSION)

    def test_long_extra_params_do_not_overflow_the_column(self):
        data = sample_backup()
        data["domains"] = [
            {
                "domain": "vpn.example.com",
                "mode": "direct",
                "child_unique_id": "child-1",
                "extra_params": {"blob": "x" * 500},
                "show_domains": [],
            }
        ]
        converted, _notes = convert_backup(data)
        self.assertEqual(converted["domains"][0]["extra_params"], "")

    def test_missing_db_version_is_added(self):
        data = sample_backup()
        data["hconfigs"] = [row for row in data["hconfigs"] if row["key"] != "db_version"]
        converted, notes = convert_backup(data)
        versions = [row for row in converted["hconfigs"] if row["key"] == "db_version"]
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0]["value"], "113")
        self.assertEqual(versions[0]["child_unique_id"], "child-1")
        self.assertTrue(any("added db_version" in note for note in notes))

    def test_blank_names_with_different_transports_are_kept(self):
        data = sample_backup()
        data["proxies"] = [
            {"name": "", "enable": True, "proto": "vless", "l3": "reality", "transport": "xhttp", "cdn": "direct", "params": {}},
            {"name": "", "enable": True, "proto": "vless", "l3": "reality", "transport": "tcp", "cdn": "direct", "params": {}},
            {"name": "", "enable": False, "proto": "vless", "l3": "reality", "transport": "grpc", "cdn": "direct", "params": {}},
            {"name": "", "enable": True, "proto": "vless", "l3": "reality", "transport": "grpc", "cdn": "direct", "params": ""},
            {"name": "NaiveTLS", "enable": True, "proto": "naive", "l3": "tls_h2_h1", "transport": "custom", "cdn": "relay", "params": {}},
            {"name": "NaiveTLS", "enable": True, "proto": "naive", "l3": "tls_h2_h1", "transport": "custom", "cdn": "relay", "params": {}},
        ]
        converted, notes = convert_backup(data)
        proxies = converted["proxies"]
        self.assertEqual(
            [(row["name"], row["transport"], row["enable"]) for row in proxies],
            [
                ("reality xhttp direct vless", "xhttp", True),
                ("reality tcp direct vless", "tcp", True),
                ("reality grpc direct vless", "grpc", True),
                ("NaiveTLS", "custom", True),
            ],
        )
        self.assertEqual(proxies[2]["params"], {})
        self.assertTrue(any("merged duplicate proxy NaiveTLS" in note for note in notes))

    def test_output_is_json_serializable(self):
        converted, _notes = convert_backup(sample_backup())
        json.dumps(converted)


if __name__ == "__main__":
    unittest.main()
