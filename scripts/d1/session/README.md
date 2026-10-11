# D1 session scripts (preserved 2026-10-11)

These are the working scripts from the D1 parity rounds 6–12, copied out of the session scratchpad so they survive the week's pause. The paths inside them point at the old scratchpad (`/private/tmp/claude-502/.../scratchpad/`) and at `scratch/d1/`, so re-point them before reuse.

- `ab.py`: per-change A/B crop sheets (frame | anchor | change, with band measures).
- `blind*.py`: builds the blind sets (`blind12.py` adds the JPEG q90 treatment).
- `eval*.py`, `*-eval.sh`, `final*.sh`, `table12.py`: round evaluations and deliverables.
- `floreteval.py`: the floret metric on the judged crops (blobs, `dfrac`, lit-half bands).
- `skyfit2.py`: fits the painted sky ramps to the frames.
- `../florets/`: the Opus floret study (`florets.py` metric; `termcorr.py` term correlations).

The blind sets and their keys (they contain Decima frames, so they stay local and are never committed) are in `artifacts/research/d1-parity/blind/` in the main checkout. Round 12's set `blind-d1l` is built but not yet judged.
