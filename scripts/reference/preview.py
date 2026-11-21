#!/usr/bin/env python3
"""Tone-mapped JPEG preview of a linear PFM (for looking, never for measuring).

  python3 scripts/reference/preview.py frame.pfm out.jpg [--exposure 1.0]

Exposure multiply, Reinhard x / (1 + x) per channel, sRGB encode. Not the flagship's ACES; it only shows the frame.
"""
import argparse

from PIL import Image

import refio

ap = argparse.ArgumentParser()
ap.add_argument("pfm")
ap.add_argument("jpg")
ap.add_argument("--exposure", type=float, default=1.0)
a = ap.parse_args()
img = refio.read_pfm(a.pfm)
Image.fromarray(refio.tonemap_preview(img, a.exposure)).save(a.jpg, quality=88)
print(a.jpg, img.shape, "mean", img.reshape(-1, img.shape[-1]).mean(0))
