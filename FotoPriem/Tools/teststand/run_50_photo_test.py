#!/usr/bin/env python3
"""Generate 50 camera-like files and push them through FotoPriem FTP."""
from __future__ import annotations

import argparse
import os
import socket
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path


def write_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def mini_jpeg() -> bytes:
    # 1x1 JPEG
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda00080001000100003f00fbd5c0ffd9"
    )


def fake_raw(kind: str, index: int) -> bytes:
    header = {
        "CR3": b"ftypcrx ",
        "NEF": b"MM\x00*",
        "ARW": b"II*\x00",
        "DNG": b"II*\x00DNG",
    }[kind]
    return header + (f"{kind}-{index}-".encode() * 200)


def fake_mp4(index: int) -> bytes:
    # Minimal-looking ISO BMFF box; cameras send much larger files, protocol is the same.
    payload = f"video-clip-{index}".encode() * 50
    size = 8 + len(payload)
    return struct.pack(">I", size) + b"mdat" + payload


def build_fixture_set(folder: Path) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    jpeg = mini_jpeg()
    for i in range(1, 36):
        path = folder / f"DSC_{i:04d}.JPG"
        path.write_bytes(jpeg + f"#{i}".encode())
        files.append(path)
    raw_plan = ["CR3", "CR3", "NEF", "NEF", "ARW", "ARW", "DNG", "DNG"]
    for i, kind in enumerate(raw_plan, start=1):
        path = folder / f"RAW_{i:04d}.{kind}"
        path.write_bytes(fake_raw(kind, i))
        files.append(path)
    for i in range(1, 5):
        path = folder / f"CLIP_{i:04d}.MP4"
        path.write_bytes(fake_mp4(i))
        files.append(path)
    for i in range(1, 4):
        path = folder / f"CLIP_{i:04d}.MOV"
        path.write_bytes(fake_mp4(100 + i))
        files.append(path)
    assert len(files) == 50, len(files)
    return files


class CameraFTP:
    def __init__(self, host: str, port: int, user: str, password: str):
        self.sock = socket.create_connection((host, port), timeout=10)
        self._read_reply()
        self._cmd(f"USER {user}")
        self._cmd(f"PASS {password}", expect=230)
        self._cmd("TYPE I")

    def _read_reply(self) -> str:
        data = b""
        while not data.endswith(b"\n"):
            chunk = self.sock.recv(1)
            if not chunk:
                break
            data += chunk
        return data.decode("latin1", errors="replace")

    def _cmd(self, line: str, expect: int | None = None) -> str:
        self.sock.sendall((line + "\r\n").encode())
        reply = self._read_reply()
        if expect is not None and not reply.startswith(str(expect)):
            raise RuntimeError(f"{line} -> {reply.strip()}")
        return reply

    def stor(self, host: str, name: str, payload: bytes) -> None:
        reply = self._cmd("PASV")
        inner = reply[reply.find("(") + 1 : reply.find(")")]
        parts = [int(x) for x in inner.split(",")]
        data_port = parts[4] * 256 + parts[5]
        data = socket.create_connection((host, data_port), timeout=10)
        self._cmd(f"STOR {name}", expect=150)
        data.sendall(payload)
        data.close()
        done = self._read_reply()
        if not done.startswith("226"):
            raise RuntimeError(f"STOR {name} -> {done.strip()}")

    def close(self) -> None:
        try:
            self._cmd("QUIT")
        finally:
            self.sock.close()


def wait_port(host: str, port: int, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.4):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"server did not bind {host}:{port}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=2121)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent / "received"))
    parser.add_argument("--fixtures", default=str(Path(__file__).resolve().parent / "fixtures"))
    parser.add_argument("--server", default="")
    args = parser.parse_args()

    fixtures = Path(args.fixtures)
    files = build_fixture_set(fixtures)
    received = Path(args.root)
    if received.exists():
        for leftover in received.rglob("*"):
            if leftover.is_file():
                leftover.unlink()

    proc = None
    if args.server:
        proc = subprocess.Popen(
            [args.server, "--port", str(args.port), "--root", str(received), "--user", "foto", "--pass", "priem"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        wait_port("127.0.0.1", args.port)
        time.sleep(0.2)

    try:
        camera = CameraFTP("127.0.0.1", args.port, "foto", "priem")
        for path in files:
            camera.stor("127.0.0.1", f"/DCIM/{path.name}", path.read_bytes())
            print(f"SENT {path.name} {path.stat().st_size}")
        camera.close()
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()

    saved = [p for p in received.rglob("*") if p.is_file()]
    kinds = {"jpeg": 0, "raw": 0, "video": 0, "other": 0}
    for path in saved:
        ext = path.suffix.lower().lstrip(".")
        if ext in {"jpg", "jpeg"}:
            kinds["jpeg"] += 1
        elif ext in {"cr3", "nef", "arw", "dng"}:
            kinds["raw"] += 1
        elif ext in {"mp4", "mov"}:
            kinds["video"] += 1
        else:
            kinds["other"] += 1

    print(f"RECEIVED_COUNT {len(saved)}")
    print(f"RECEIVED_JPEG {kinds['jpeg']}")
    print(f"RECEIVED_RAW {kinds['raw']}")
    print(f"RECEIVED_VIDEO {kinds['video']}")
    if len(saved) != 50:
        print("FAIL expected 50 files", file=sys.stderr)
        return 1
    if kinds["jpeg"] != 35 or kinds["raw"] != 8 or kinds["video"] != 7:
        print(f"FAIL mix {kinds}", file=sys.stderr)
        return 1
    print("PASS 50 camera files received (35 JPEG, 8 RAW, 7 video)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
