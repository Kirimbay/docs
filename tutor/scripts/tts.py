#!/usr/bin/env python3
"""Record Misha's lines with a calm male neural voice.

Voice: ru-RU-DmitryNeural
Speed: +0% (medium)
Pitch: +0Hz (medium)
"""

import asyncio
import hashlib
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
PHRASES = Path(__file__).with_name("speeches.json")
AUDIO = ROOT / "public" / "audio"
MAP = ROOT / "src" / "audio-map.json"
VOICE = "ru-RU-DmitryNeural"
RATE = "+0%"
PITCH = "+0Hz"


def key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


async def synth(text: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 800:
        return True
    for attempt in range(6):
        try:
            comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
            await comm.save(str(dest))
            if dest.exists() and dest.stat().st_size > 800:
                return True
        except Exception:
            if dest.exists():
                dest.unlink()
            await asyncio.sleep(0.8 * (attempt + 1))
    return False


async def main() -> None:
    texts = json.loads(PHRASES.read_text(encoding="utf-8"))
    AUDIO.mkdir(parents=True, exist_ok=True)
    mapping = {text: key(text) for text in texts}
    failed: list[str] = []
    for index, text in enumerate(texts, start=1):
        ok = await synth(text, AUDIO / f"{mapping[text]}.mp3")
        if not ok:
            failed.append(text)
        if index % 20 == 0 or index == len(texts):
            print(f"{index}/{len(texts)} failed {len(failed)}", flush=True)
        await asyncio.sleep(0.15)
    if failed:
        print("second pass", len(failed), flush=True)
        still = []
        for text in failed:
            await asyncio.sleep(1.2)
            if not await synth(text, AUDIO / f"{mapping[text]}.mp3"):
                still.append(text)
        failed = still
    MAP.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"voices {len(mapping)} missing {len(failed)}")
    for text in failed:
        print("MISSING", text[:160])
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
