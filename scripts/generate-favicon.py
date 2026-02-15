#!/usr/bin/env python3
"""Generate favicon.ico for the Tasky app.

Draws a kanban board icon: emerald green rounded square background
with white card rectangles arranged in 3 columns (3, 2, 1 cards)
to suggest tasks flowing through stages.

Uses the app's accent color: #10b981 (emerald green).
"""

from PIL import Image, ImageDraw
import os

EMERALD = (16, 185, 129, 255)  # #10b981
CARD_COLOR = (255, 255, 255, 235)  # white, slightly transparent


def create_favicon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = size / 32  # scale factor relative to 32x32 base design

    # Rounded emerald background
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=int(6 * s),
        fill=EMERALD,
    )

    card_r = max(1, int(1.2 * s))

    # Column 1 — 3 cards
    for y in (5, 12, 19):
        draw.rounded_rectangle(
            [(int(3 * s), int(y * s)), (int(10.5 * s), int((y + 5) * s))],
            radius=card_r,
            fill=CARD_COLOR,
        )

    # Column 2 — 2 cards
    for y in (5, 12):
        draw.rounded_rectangle(
            [(int(12.25 * s), int(y * s)), (int(19.75 * s), int((y + 5) * s))],
            radius=card_r,
            fill=CARD_COLOR,
        )

    # Column 3 — 1 card
    draw.rounded_rectangle(
        [(int(21.5 * s), int(5 * s)), (int(29 * s), int(10 * s))],
        radius=card_r,
        fill=CARD_COLOR,
    )

    return img


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    out_path = os.path.join(project_root, "src", "app", "favicon.ico")

    sizes = [16, 32, 48]

    # Create the largest size and let Pillow downsample for smaller sizes
    largest = max(sizes)
    img = create_favicon(largest)

    img.save(
        out_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
    )
    print(f"✓ Favicon saved to {out_path}  ({', '.join(f'{s}x{s}' for s in sizes)})")


if __name__ == "__main__":
    main()
