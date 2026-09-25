#!/usr/bin/env python3
"""Derive all Graupel icons from graupel/icons/graupel.svg.

Run with a development Python containing Pillow: python generate_icons.py.
The SVG uses only M/C/L/Z commands, sampled here without a runtime dependency.
Generated assets are committed, never generated during package installation.
"""
from __future__ import annotations

import base64
import io
import re
import shutil
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "graupel" / "icons"
SIZES = (16, 24, 32, 48, 64, 128, 256)
CANVAS = 1024


def load_master_image() -> Image.Image:
    svg = ET.parse(OUTPUT_DIR / "graupel.svg").getroot()
    image_el = svg.find("{http://www.w3.org/2000/svg}image")
    if image_el is not None:
        href = image_el.attrib.get("href") or image_el.attrib.get(
            "{http://www.w3.org/1999/xlink}href", ""
        )
        if href.startswith("data:image/png;base64,"):
            data = base64.b64decode(href.split(",", 1)[1])
            return Image.open(io.BytesIO(data)).convert("RGBA")

    path = svg.find("{http://www.w3.org/2000/svg}path")
    if path is not None:
        tokens = iter(re.findall(r"[MCLZ]|-?\d+(?:\.\d+)?", path.attrib["d"]))
        points = []
        current = (0, 0)
        for command in tokens:
            if command in ("M", "L"):
                current = (float(next(tokens)), float(next(tokens)))
                points.append(current)
            elif command == "C":
                controls = [current] + [
                    (float(next(tokens)), float(next(tokens))) for _ in range(3)
                ]
                for i in range(1, 65):
                    t = i / 64
                    weights = ((1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3)
                    points.append(tuple(
                        sum(w * p[axis] for w, p in zip(weights, controls))
                        for axis in (0, 1)
                    ))
                current = controls[-1]
            elif command != "Z":
                raise ValueError(f"Unsupported SVG command: {command}")
        image = Image.new("RGBA", (CANVAS, CANVAS))
        ImageDraw.Draw(image).polygon(
            [(x * CANVAS / 64, y * CANVAS / 64) for x, y in points],
            fill=svg.attrib.get("fill", "#f59e0b"),
        )
        return image

    raise ValueError("Neither <image> nor <path> found in graupel.svg")


def render_icon(size: int) -> Image.Image:
    master = load_master_image()
    return master.resize((size, size), Image.Resampling.LANCZOS)


def make_ico(png_frames: dict[int, bytes], path: Path) -> None:
    directory = bytearray()
    data = bytearray()
    offset = 6 + 16 * len(png_frames)
    for size, frame in sorted(png_frames.items()):
        directory.extend(struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0,
            1, 32, len(frame), offset + len(data),
        ))
        data.extend(frame)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(png_frames)) + directory + data)


def main() -> None:
    master = load_master_image()
    png_frames = {}
    for size in SIZES:
        image = master.resize((size, size), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        frame = buffer.getvalue()
        png_frames[size] = frame
        (OUTPUT_DIR / f"graupel_{size}.png").write_bytes(frame)
    make_ico(png_frames, OUTPUT_DIR / "graupel.ico")
    shutil.copyfile(
        OUTPUT_DIR / "graupel.svg",
        PROJECT_ROOT / "react" / "public" / "favicon.svg",
    )


if __name__ == "__main__":
    main()
