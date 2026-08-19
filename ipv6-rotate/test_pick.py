#!/usr/bin/env python3
import ipaddress
import tempfile
import unittest
from pathlib import Path

import pick


class PickTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(pick.normalize("2A03:6F01:0001:0002::0010"), "2a03:6f01:1:2::10")

    def test_network_of(self):
        self.assertEqual(pick.network_of("2a03:6f01:1:2::10/64"), "2a03:6f01:1:2::/64")

    def test_subnet_skips_protected(self):
        net = ipaddress.IPv6Network("2001:db8:1:2::/120")
        protected = "\n".join(str(ipaddress.IPv6Address(int(net.network_address) + i)) for i in range(2, 250))
        chosen = pick.pick_subnet("2001:db8:1:2::/120", protected)
        self.assertNotIn(chosen, protected.splitlines())
        self.assertIn(ipaddress.IPv6Address(chosen), net)

    def test_pool_rotates_and_skips_protected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool.txt"
            path.write_text(
                "2001:db8::10\n"
                "2001:db8::11  # comment\n"
                "2001:db8::12\n"
            )
            protected = "2001:db8::11"
            first = pick.pick_pool(str(path), protected, "")
            self.assertEqual(first, "2001:db8::10")
            second = pick.pick_pool(str(path), protected, first)
            self.assertEqual(second, "2001:db8::12")
            third = pick.pick_pool(str(path), protected, second)
            self.assertEqual(third, "2001:db8::10")

    def test_belongs_subnet_and_pool(self):
        self.assertEqual(
            pick.belongs("2001:db8:1:2::aa", "subnet", "2001:db8:1:2::/64", ""),
            "2001:db8:1:2::aa",
        )
        with self.assertRaises(SystemExit):
            pick.belongs("2001:db8:9::1", "subnet", "2001:db8:1:2::/64", "")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool.txt"
            path.write_text("2001:db8::10\n2001:db8::12\n")
            self.assertEqual(pick.belongs("2001:db8::12", "pool", "", str(path)), "2001:db8::12")
            with self.assertRaises(SystemExit):
                pick.belongs("2001:db8::99", "pool", "", str(path))

    def test_pool_empty_after_protect(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool.txt"
            path.write_text("2001:db8::10\n")
            with self.assertRaises(SystemExit):
                pick.pick_pool(str(path), "2001:db8::10", "")


if __name__ == "__main__":
    unittest.main()
