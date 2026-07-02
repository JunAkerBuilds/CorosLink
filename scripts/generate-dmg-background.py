#!/usr/bin/env python3
"""Generate the macOS DMG drag-to-Applications background image."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"

WIDTH = 540
HEIGHT = 380
SCALE = 2

BG = (17, 19, 18)  # --surface
BG_TOP = (9, 10, 9)
ACCENT = (45, 154, 116)  # --accent
MUTED = (170, 169, 164)
TEXT = (244, 242, 238)


def _lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def _vertical_gradient(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size, BG)
    pixels = image.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        color = (
            _lerp(BG_TOP[0], BG[0], t),
            _lerp(BG_TOP[1], BG[1], t),
            _lerp(BG_TOP[2], BG[2], t),
        )
        for x in range(width):
            pixels[x, y] = color
    return image


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def _draw_arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], width: int) -> None:
    draw.line([start, end], fill=ACCENT, width=width)

    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    head_len = max(14, width * 2)
    left = (
        end[0] - head_len * math.cos(angle - math.pi / 7),
        end[1] - head_len * math.sin(angle - math.pi / 7),
    )
    right = (
        end[0] - head_len * math.cos(angle + math.pi / 7),
        end[1] - head_len * math.sin(angle + math.pi / 7),
    )
    draw.polygon([end, left, right], fill=ACCENT)


def render_background(width: int, height: int) -> Image.Image:
    # DMG coordinates use a bottom-left origin; PIL uses top-left.
    image = _vertical_gradient((width, height))
    draw = ImageDraw.Draw(image)

    icon_y = height - 220
    app_x = 130
    apps_x = 410
    arrow_y = icon_y + 28

    _draw_arrow(draw, (app_x + 72, arrow_y), (apps_x - 72, arrow_y), max(4, width // 135))

    title_font = _load_font(max(18, width // 24))
    hint_font = _load_font(max(13, width // 34))

    title = "Drag CorosLink to Applications"
    hint = "Then eject this disk image and open from Applications"

    # Pillow 10+ uses textbbox; fall back for older releases.
    if hasattr(draw, "textbbox"):
        title_box = draw.textbbox((0, 0), title, font=title_font)
        title_w = title_box[2] - title_box[0]
        hint_box = draw.textbbox((0, 0), hint, font=hint_font)
        hint_w = hint_box[2] - hint_box[0]
    else:
        title_w, _ = draw.textsize(title, font=title_font)
        hint_w, _ = draw.textsize(hint, font=hint_font)

    draw.text(((width - title_w) / 2, 28), title, fill=TEXT, font=title_font)
    draw.text(((width - hint_w) / 2, height - 42), hint, fill=MUTED, font=hint_font)

    for x, label in ((app_x, "CorosLink"), (apps_x, "Applications")):
        if hasattr(draw, "textbbox"):
            box = draw.textbbox((0, 0), label, font=hint_font)
            label_w = box[2] - box[0]
        else:
            label_w, _ = draw.textsize(label, font=hint_font)
        draw.text((x - label_w / 2, icon_y + 74), label, fill=MUTED, font=hint_font)

    return image


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    standard = render_background(WIDTH, HEIGHT)
    retina = render_background(WIDTH * SCALE, HEIGHT * SCALE)

    standard_path = BUILD_DIR / "dmg-background.png"
    retina_path = BUILD_DIR / "dmg-background@2x.png"
    standard.save(standard_path, format="PNG")
    retina.save(retina_path, format="PNG")

    print(f"Generated {standard_path}")
    print(f"Generated {retina_path}")


if __name__ == "__main__":
    main()
