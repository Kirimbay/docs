#!/usr/bin/env python3
"""Serve the .happ file the Windows button opens.

The file text is the https address with the leading letter removed from the
host. Happ reads that text, adds the subscription, and stores that address.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parent
MAP = {
    name.lower(): original
    for name, original in json.loads((ROOT / "map.json").read_text(encoding="utf-8")).items()
}
HOST = "127.0.0.1"
PORT = 18771


def subscription_url(host: str, raw_path: str) -> str:
    name = (host or "").split(":", 1)[0].strip().lower().rstrip(".")
    original = MAP.get(name)
    if not original or not name.startswith("a") or original != name[1:]:
        raise ValueError("host")
    path = raw_path or ""
    if not path.startswith("/") or len(path) > 4096:
        raise ValueError("path")
    if any(char in path for char in "\r\n\x00\\"):
        raise ValueError("path")
    if "://" in path:
        raise ValueError("path")
    return "https://" + original + path


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        part = urlsplit(self.path)
        if part.path != "/key.happ":
            self._empty(404)
            return
        raw = ""
        for key, value in parse_qsl(part.query, keep_blank_values=True):
            if key == "p":
                raw = value
                break
        try:
            url = subscription_url(self.headers.get("Host", ""), raw)
        except ValueError:
            self._empty(400)
            return
        body = (url + "\n").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-happ")
        self.send_header("Content-Disposition", 'inline; filename="key.happ"')
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code: int) -> None:
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        host = (self.headers.get("Host") or "").split(":", 1)[0]
        status = args[1] if len(args) > 1 else ""
        print(host, status, flush=True)


def main() -> None:
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
