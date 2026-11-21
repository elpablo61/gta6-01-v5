#!/usr/bin/env python3
"""Crescent Bay v5 — contact sheet builder (written fresh in-session).

Reads screenshots/1-cover.jpg, 2-mission.jpg, 3-night.jpg, 4-start.jpg and
writes:
  screenshots/contact-sheet.jpg      (768x480, cover 768x320 on top,
                                      three 256x160 below, JPEG quality 80)
  screenshots/contact-sheet-gray.jpg (grayscale twin, same layout)

Usage: python3 tools/contact-sheet.py
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"

W, H = 768, 480
COVER_H = 320
SMALL_W, SMALL_H = 256, 160


def load(name):
    p = SHOTS / name
    if not p.exists():
        sys.exit(f"missing screenshot: {p}")
    return Image.open(p).convert("RGB")


def build(gray=False):
    cover = load("1-cover.jpg").resize((W, COVER_H), Image.LANCZOS)
    smalls = [
        load(n).resize((SMALL_W, SMALL_H), Image.LANCZOS)
        for n in ("2-mission.jpg", "3-night.jpg", "4-start.jpg")
    ]
    sheet = Image.new("RGB", (W, H), (12, 15, 22))
    sheet.paste(cover, (0, 0))
    for i, img in enumerate(smalls):
        sheet.paste(img, (i * SMALL_W, COVER_H))
    if gray:
        sheet = sheet.convert("L").convert("RGB")
    out = SHOTS / ("contact-sheet-gray.jpg" if gray else "contact-sheet.jpg")
    sheet.save(out, "JPEG", quality=80)
    print(f"{out.name}: {out.stat().st_size} bytes, {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    build(gray=False)
    build(gray=True)
