from __future__ import annotations

import logging
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

import httpx

from .client import user_sub_url
from .config import AppConfig, panel_by_host
from .merge import looks_like_html, merge_subscription_bodies, parse_userinfo_expired, parse_uuid_from_path

logger = logging.getLogger(__name__)

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _filter_headers(headers: list[tuple[str, str]] | Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers:
        if key.lower() in HOP_BY_HOP:
            continue
        out[key] = value
    return out


class MergeHandler(BaseHTTPRequestHandler):
    cfg: AppConfig
    origin_http: httpx.Client
    nl_http: httpx.Client

    def log_message(self, fmt: str, *args: object) -> None:
        logger.info("%s - %s", self.address_string(), fmt % args)

    def do_HEAD(self) -> None:  # noqa: N802
        self._proxy(with_body=False)

    def do_GET(self) -> None:  # noqa: N802
        self._proxy(with_body=True)

    def _proxy(self, *, with_body: bool) -> None:
        panel = panel_by_host(self.cfg, self.headers.get("Host") or "")
        if panel is None:
            self.send_error(421, "Unknown subscription host")
            return

        origin = panel.origin_url.rstrip("/") + self.path
        headers = _filter_headers(self.headers.items())
        try:
            se = self.origin_http.request(
                self.command,
                origin,
                headers=headers,
                timeout=self.cfg.fetch_timeout_sec,
            )
        except httpx.HTTPError as exc:
            logger.error("Origin fetch failed %s: %s", origin, exc)
            self.send_error(502, "Sweden panel unreachable")
            return

        body = se.content if with_body else b""
        text = ""
        if with_body:
            text = body.decode(se.encoding or "utf-8", errors="replace")

        should_merge = (
            with_body
            and se.status_code == 200
            and not looks_like_html(text)
            and not parse_userinfo_expired(
                se.headers.get("Subscription-Userinfo") or se.headers.get("subscription-userinfo"),
                int(time.time()),
            )
        )
        uuid = parse_uuid_from_path(urlsplit(self.path).path, panel.user_proxy_path)
        if should_merge and uuid:
            nl_url = self._nl_url(uuid)
            try:
                nl = self.nl_http.request(
                    "GET",
                    nl_url,
                    headers={
                        "User-Agent": headers.get("User-Agent") or "HiddifyNext/2.0",
                        "Accept": headers.get("Accept", "*/*"),
                    },
                    timeout=self.cfg.fetch_timeout_sec,
                )
                if nl.status_code == 200:
                    nl_text = nl.text
                    if nl_text.strip() and not looks_like_html(nl_text):
                        text = merge_subscription_bodies(text, nl_text)
                        body = text.encode("utf-8")
                else:
                    logger.info("NL skip uuid=%s status=%s", uuid, nl.status_code)
            except httpx.HTTPError as exc:
                logger.warning("NL fetch failed for %s: %s", uuid, exc)

        self.send_response(se.status_code)
        skip = {"content-length", "transfer-encoding", "content-encoding"}
        for key, value in se.headers.items():
            if key.lower() in skip or key.lower() in HOP_BY_HOP:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if with_body:
            self.wfile.write(body)

    def _nl_url(self, uuid: str) -> str:
        split = urlsplit(self.path)
        parts = [p for p in split.path.split("/") if p]
        suffix = "/".join(parts[2:]) if len(parts) > 2 else ""
        url = user_sub_url(
            self.cfg.netherlands.base_url,
            self.cfg.netherlands.user_proxy_path,
            uuid,
            suffix,
        )
        if split.query:
            return f"{url}?{split.query}"
        return url


def serve_merge_proxy(cfg: AppConfig) -> None:
    MergeHandler.cfg = cfg
    MergeHandler.origin_http = httpx.Client(
        follow_redirects=True,
        verify=False,
        timeout=cfg.fetch_timeout_sec,
    )
    MergeHandler.nl_http = httpx.Client(
        follow_redirects=True,
        verify=cfg.netherlands.verify_tls,
        timeout=cfg.fetch_timeout_sec,
    )
    httpd = ThreadingHTTPServer((cfg.listen_host, cfg.listen_port), MergeHandler)
    logger.info("Merge proxy listening on %s:%s", cfg.listen_host, cfg.listen_port)
    try:
        httpd.serve_forever()
    finally:
        MergeHandler.origin_http.close()
        MergeHandler.nl_http.close()
        httpd.server_close()
