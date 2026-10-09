#!/usr/bin/env python3
"""Raw dump of a .pptx for research notes (RS-0).

Streams only the members it needs out of the zip, so multi-GB decks with
embedded video are fine. Writes, under OUT:
  slides.md        one section per slide: title/text, speaker notes, images
  media/<name>     every non-video image referenced by a slide
  index.json       per-slide {text, notes, images, videos}

Usage: python3 -I extract-pptx.py DECK.pptx OUT_DIR [--no-media]
Run with -I and keep OUT_DIR outside this scripts folder (third-party data).
"""
import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
VIDEO = {"mp4", "mov", "m4v", "avi", "wmv"}


def num(name):
    m = re.search(r"(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


def paragraphs(xml_bytes):
    root = ET.fromstring(xml_bytes)
    out = []
    for p in root.iter(A + "p"):
        text = "".join(t.text or "" for t in p.iter(A + "t")).rstrip()
        if text:
            out.append(text)
    return out


def rels(z, part):
    d, f = posixpath.split(part)
    rp = posixpath.join(d, "_rels", f + ".rels")
    if rp not in z.namelist():
        return {}
    root = ET.fromstring(z.read(rp))
    res = {}
    for r in root.iter(R_NS + "Relationship"):
        tgt = r.get("Target", "")
        if r.get("TargetMode") == "External":
            continue
        res[r.get("Id")] = posixpath.normpath(posixpath.join(d, tgt))
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    deck, out = Path(args[0]), Path(args[1])
    want_media = "--no-media" not in sys.argv
    out.mkdir(parents=True, exist_ok=True)
    (out / "media").mkdir(exist_ok=True)
    z = zipfile.ZipFile(deck)
    names = set(z.namelist())
    slides = sorted((n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=num)
    # Presentation order comes from presentation.xml's sldIdLst.
    order = []
    try:
        pres_rels = rels(z, "ppt/presentation.xml")
        root = ET.fromstring(z.read("ppt/presentation.xml"))
        P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
        RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        for s in root.iter(P + "sldId"):
            tgt = pres_rels.get(s.get(RID))
            if tgt in names:
                order.append(tgt)
    except Exception:
        pass
    if len(order) != len(slides):
        order = slides
    index, md = [], [f"# {deck.name}\n", f"{len(order)} slides. Slide numbers below are presentation order.\n"]
    extracted = set()
    for i, part in enumerate(order, 1):
        text = paragraphs(z.read(part))
        r = rels(z, part)
        notes, images, videos = [], [], []
        for tgt in r.values():
            if "notesSlide" in tgt and tgt in names:
                notes = [t for t in paragraphs(z.read(tgt)) if not re.fullmatch(r"\d+", t)]
            elif tgt.startswith("ppt/media/"):
                ext = tgt.rsplit(".", 1)[-1].lower()
                base = posixpath.basename(tgt)
                (videos if ext in VIDEO else images).append(base)
                if ext not in VIDEO and want_media and tgt in names and tgt not in extracted:
                    (out / "media" / base).write_bytes(z.read(tgt))
                    extracted.add(tgt)
        images, videos = sorted(set(images)), sorted(set(videos))
        index.append({"slide": i, "part": part, "text": text, "notes": notes, "images": images, "videos": videos})
        md.append(f"\n## Slide {i}  ({posixpath.basename(part)})\n")
        md.append("**Text:**\n" + ("\n".join(f"> {t}" for t in text) if text else "_(none)_") + "\n")
        md.append("\n**Notes:**\n" + ("\n\n".join(notes) if notes else "_(none)_") + "\n")
        if images:
            md.append("\n**Images:** " + ", ".join(f"media/{m}" for m in images) + "\n")
        if videos:
            md.append("\n**Videos (not extracted):** " + ", ".join(videos) + "\n")
    (out / "slides.md").write_text("".join(md))
    (out / "index.json").write_text(json.dumps(index, indent=1))
    print(f"{deck.name}: {len(order)} slides, {len(extracted)} images -> {out}")


if __name__ == "__main__":
    main()
