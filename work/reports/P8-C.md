# P8-C Examples gallery
Status: ready for review
Changed: `examples/lab/{index.html,main.ts}`, new `examples/lab/gallery/{cards.json,gallery.css,thumbs/*.webp}`, new `scripts/gallery-thumbs.mjs`, `work/BOARD.md`.
Verified:
- `pnpm check` -> exit 0 (checked directly).
- Every card and every "tests/legacy" link answered 200 under `vite` (compare/ has no index.html yet, so it is served by the SPA fallback; the card links it).
- captures: work/captures/P8-C/gallery-desktop.jpg (1440 wide), gallery-phone.jpg (headless Chrome's minimum window is 500 px). On a real 375 px emulated viewport `scrollWidth` was 375: no horizontal scroll.
Measures:
- Cards: open-water, plains-flight, onsen, storm, evolve, cloudscape-gen, vdb-drop, r3f, three-adapter, flagship, compare; each has thumbnail, description, packages, bookmark chips (`?bookmark=`). Collapsed section for tests, tools and legacy pages. WebGPU-missing banner. Responsive grid.
- Thumbnails: `node scripts/gallery-thumbs.mjs [id ...]` regenerates all in about 35 s; 640 px webp, 3 to 40 KB each (about 110 KB total). Needs `cwebp` (brew install webp). It skips cards whose page folder or thumb shot is missing.
Open issues:
- `style.css` is shared by other pages, so I left it alone; the gallery styles are in `gallery/gallery.css`.
- evolve, cloudscape-gen, r3f, flagship and vdb-drop ignore `hud=0&clean=1`; their thumbnails are cropped from the top (`cropTop` in cards.json). Honouring the flags in those pages would let the crop go.
- The compare card has no thumbnail ("preview pending"). Once the page exists, set `thumb.shot` in cards.json (a bookmark name) and run `node scripts/gallery-thumbs.mjs compare`. Its description is generic; adjust it.
- Card data lives in `gallery/cards.json` (shared by the page and the script).

## Orchestrator review
Accepted. Desktop and phone captures read well: 11 cards, with the legacy pages collapsed. Minor follow-ups: the flagship thumbnail keeps a small sliver of HUD at the top corners, and five pages ignore `hud=0&clean=1` (thumbnails are cropped instead). Refresh the compare thumbnail once P8-A lands.
