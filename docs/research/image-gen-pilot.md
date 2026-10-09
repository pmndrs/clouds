# Image-generation pilot for cloud targets (fal.ai, 2026-10-09)

**Goal:** can image-editing models give extra views of a target cloud to guide Houdini sims (the target-driven loop in `docs/PLAN-2026-10-next.md`)?

**Input:** a crop of the hero congestus tower from the owner's photo `_targets/texas-afternoon.jpg`. Each model was asked for a side view (90°) and a back view (180°).

**Results:** local only, in the session scratchpad `fal/pilot-sheet.jpg`; never committed.

**Cost:** about $0.26 for 6 images. Pricing per image or megapixel: Qwen multi-angle $0.035/MP, FLUX 3 edit $0.024/MP, nano-banana-2 $0.08/image.

| Model (endpoint) | 90° | 180° | Verdict |
| --- | --- | --- | --- |
| `fal-ai/qwen-image-edit-2511-multiple-angles` | A real, plausible new view: tower on a pedestal, consistent lighting | Mostly a mirror of the original; lit side not swapped | **Useful.** It has angle and elevation sliders, so it is the most controllable |
| `fal-ai/nano-banana-2/edit` | A distinct, plausible view with the richest cauliflower detail; narrower tower | Mostly a mirror, with new detail | **Useful.** Best detail; prompt-driven |
| `blackforestlabs/flux-3/edit-image` | Barely changed: re-renders the same view | A horizontal mirror | **Not useful for views.** It edits locally rather than re-posing |

**What we learned:**
- **The views are plausible reinterpretations, not consistent geometry.** Lobes and attachments move between views. Use them as a shape vocabulary and silhouette hints for the hidden sides; the photo's own view stays the hard constraint for matching.
- **Back views come out as mirrors.** That roughly matches a real back silhouette, but the lighting is not swapped. Don't use them for lighting reference.
- **Better use: new targets and gaps.**
  - "Same species, a different cloud" variants to widen the authored library.
  - Target images for types the photo set lacks: pileus, mammatus, valley fog, rain shafts, castellanus.
  - Clean isolation of a cloud onto plain sky for target cards.
- **Recommended in the loop:**
  - Qwen multi-angle for controlled side and elevation views (0/90/270°, elevation −15° for looking up from the ground).
  - nano-banana-2 for detail-rich variants.
  - Skip FLUX 3 for re-posing; it may still suit isolation or clean-up edits (untested).

**Access:** the fal connector is in this session (`mcp__…__run_model` etc.). A `FAL_KEY` is in the main checkout's `.env`; that checkout's `.gitignore` does not yet ignore `.env` (the worktree branch does, from 88913c0). Uploads send only the chosen crop.
