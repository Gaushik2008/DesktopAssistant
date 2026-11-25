#!/usr/bin/env python3
"""Generate assets/icon.png (512x512 pixel-art crown) with Pillow. Run: npm run icons"""
import os
from PIL import Image, ImageDraw

S = 32  # logical pixels, scaled x16
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
GOLD, DARK, RED, BLUE, BG = (246, 201, 69), (201, 154, 28), (226, 59, 59), (59, 130, 246), (30, 30, 40, 255)

d.rounded_rectangle([1, 1, 30, 30], radius=5, fill=BG)
# crown base + points
d.rectangle([6, 17, 25, 24], fill=GOLD)
d.rectangle([6, 22, 25, 24], fill=DARK)
for x in (6, 14, 22):
    d.rectangle([x, 10 if x == 14 else 12, x + 3, 17], fill=GOLD)
d.rectangle([15, 19, 16, 20], fill=RED)
d.rectangle([8, 19, 9, 20], fill=BLUE)
d.rectangle([22, 19, 23, 20], fill=BLUE)

out = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(out, exist_ok=True)
img.resize((512, 512), Image.NEAREST).save(os.path.join(out, "icon.png"))
print("wrote assets/icon.png")
