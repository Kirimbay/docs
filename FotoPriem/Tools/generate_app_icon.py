#!/usr/bin/env python3
import struct
import zlib
from pathlib import Path


def write_png(path: Path, width: int, height: int) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rows = []
    cx, cy = width / 2, height / 2
    for y in range(height):
        row = [0]
        for x in range(width):
            dx = (x - cx) / cx
            dy = (y - cy) / cy
            r2 = dx * dx + dy * dy
            if r2 < 0.18:
                row.extend([250, 176, 48])
            elif r2 < 0.55:
                row.extend([28, 28, 32])
            else:
                row.extend([12, 12, 14])
        rows.append(bytes(row))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "Apps/FotoPriem/FotoPriem/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
    write_png(out, 1024, 1024)
    print(out, out.stat().st_size)
