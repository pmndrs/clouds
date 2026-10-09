# Multi-view generation for target clouds (2026-10-09)

**Goal:** give Houdini sim agents "something to get a vibe from" for the sides of a cloud photographed from one direction. Pixel-exact 3D consistency is not required; better consistency is welcome.

**Follow-up to** [image-gen-pilot.md](image-gen-pilot.md) (Qwen multi-angle, nano-banana-2, FLUX 3 edit). Pilot outputs and the comparison sheet are local only: `work/captures/scratch/multiview/` (`multiview-sheet.jpg`, `h3-flyover-sheet.jpg`, videos and frames).

## Landscape

The dedicated multi-view diffusion models (Zero123++, SV3D, Era3D, MV-Adapter, SyncDreamer) are object-centric: trained on Objaverse renders of isolated objects on a plain background, at 256 to 768 px, with fixed camera rings. They are the "stage 1" of most image-to-3D pipelines. Findings:

- **Hosted on fal: none of them.** `search_models` for multiview, novel view, zero123, sv3d, era3d and mv-adapter returns only multiview-to-3D *consumers* (Hunyuan3D v2 multi-view, Tripo H3.1 and v2.5, Hi3D, Meshy v7 multi-image). Those take views as input; they don't make them.
- **Newer 3D models take views and don't generate them.** Pixal3D (TencentARC, MIT; ComfyUI support 2026-09-08) accepts up to four views with camera poses and says to bring views from photos, renders, or an external multi-view diffusion model ([ComfyUI Wiki](https://comfyui-wiki.com/en/news/2026-09-09-pixal3d-multiview), [repo](https://github.com/TencentARC/Pixal3D)). Hunyuan3D multi-view works the same way.
- **What fal does offer is general image models steered by camera:**
  - Camera-LoRA image editors: FLUX.2 multi-angle gallery and Qwen Image Edit multi-angle (2509, plus, 2511). Azimuth, elevation and zoom sliders.
  - Prompt-driven editors: nano-banana-2.
  - A camera-trajectory video model: MiniMax H3 Max camera controls (published 2026-09-11).
  - Wan 3.0 Prime image-to-video, which has camera motion by prompt only (untested).

## Ranked recommendation

| # | Model | Where / price | Use it for |
| --- | --- | --- | --- |
| 1 | **Qwen Image Edit 2511 multiple angles** [`fal-ai/qwen-image-edit-2511-multiple-angles`](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles) | fal, $0.035/MP (about $0.04 per image here) | Controlled side and elevation views (sliders). Best control and lighting sense in the first pilot |
| 2 | **nano-banana-2 edit** [`fal-ai/nano-banana-2/edit`](https://fal.ai/models/fal-ai/nano-banana-2/edit) | fal, $0.08/image | Richest cauliflower detail; prompt-driven, so unpredictable angle |
| 3 | **FLUX.2 multi-angle LoRA** [`fal-ai/flux-2-lora-gallery/multiple-angles`](https://fal.ai/models/fal-ai/flux-2-lora-gallery/multiple-angles) | fal, $0.021/MP (about $0.02 per image) | Cheap extra seeds and a real 270° "other side". Elevation limited to 0 to 60° (no looking up from below). Re-composes and shrinks the cloud |
| 4 | **MiniMax H3 Max camera controls** [`minimax/h3-max/camera-controls`](https://fal.ai/models/minimax/h3-max/camera-controls) | fal, $0.03/s of video (about $0.20 for 6 s at 768P) | Exploring the *space* of plausible lighting and shape from other angles; not for exact angles (see pilot) |
| 5 | Zero123++, Era3D, MV-Adapter, SV3D | Replicate has [`jd7h/zero123plusplus`](https://replicate.com/jd7h/zero123plusplus) (about $0.07/run, L40S, 6 fixed views); none of the others found hosted | Skip for clouds: object-centric, small, expect blobs |

**Practical recommendation:** keep the earlier plan (Qwen 2511 for controlled views, nano-banana-2 for detail), add FLUX.2 multi-angle as a cheap extra seed source, and use the H3 video as a "what does the backlit side look like" explorer. Do not build a pipeline around Zero123++-style models. No model tested gives usable, consistent geometry; treat everything as mood and silhouette reference.

## Pilot (hero tower crop, 1024x762)

Cost, by listed prices: FLUX.2 3 images about $0.065; H3 two clips (6.6 s each at 768P) about $0.40. **Total about $0.47 of the $3 cap** (estimates from unit price; fal billing not itemised in the tool output). The earlier pilot (about $0.26) is not included.

| Run | Result |
| --- | --- |
| FLUX.2 multi-angle, 90° | The "right side" view is a plausible new cloud: a smaller, blobbier tower with a neighbour cumulus. Shape lost most of the original's cauliflower detail; it reads as a different cloud of the same species |
| FLUX.2 multi-angle, 180° | The best of the three: a tower with a plausible new lobe layout, the lit side still on the left, no mirror artefact. Cleaner than Qwen's mirrored 180° |
| FLUX.2 multi-angle, 270° | Drifts furthest: a low, wide cumulus with a flat base and a different sky. A usable "what it looks like from the other flank" vibe, but not recognisably the same cloud |
| H3 Max orbit, azimuth 0 to 360 over 6.6 s | Not an orbit around a fixed cloud. The camera dollies into the cloud, so frames at 90° and 180° are close-ups from inside or under it, with a different sky. Interesting: the 90°/180° frames show the cloud backlit with soft translucent dark undersides, which is physically the right kind of change for a back view. The last frame (360°) returns to almost exactly the input, so loop closure works |
| H3 Max flyover, azimuth 0 to -180, elevation 0 / -15 / +20 / +35 | Same behaviour: strong push-in, framing fills with cloud, almost no sky. Elevation did not read as "from above". Needs a larger `distance` (try 2 to 3) and a re-test |

Read `multiview-sheet.jpg` against the Qwen and nano-banana rows already in the sheet. Both new families agree with the earlier pilot: views are reinterpretations, and lighting direction is the weakest point.

**Speed:** H3 inference reported about 2.8 s for a 6 s clip. FLUX.2 median about 21 s per image (fal stats).

## Consistency for soft, translucent subjects (honest note)

- **No real 3D consistency exists in any of these.** The models were trained on opaque objects, where silhouette and texture imply a surface. A cloud has no surface: its "side" is a different density integral, edges are soft, and the lit side depends on the sun. A generator can only invent a cloud that looks right, not one that is right.
- **Image editors** keep global style, sky colour and species. The lobes, their number and their attachments change per view and per seed.
- **Video models** are the most temporally smooth, so frame to frame consistency is good, but they treat the cloud as a flat texture at a distance and tend to dolly into it. They can show the cloud backlit with dark translucent regions, which no single-image editor did here. Sparse trajectories (few keyframes) produce shape drift in between.
- **Multi-view diffusion + reconstruction** (Hunyuan3D, Pixal3D, TRELLIS) would fail on clouds: they fit an opaque mesh to the views, and soft density produces blobby shells. Nothing here replaces the sim agent's own volume.
- **How to use the output safely:** as vocabulary (lobe layout, how a back flank is shaded, silhouette on the hidden side). The photographed view stays the only hard constraint for the target-driven loop. Generate several seeds and look for what repeats; a feature that appears in most seeds is more likely to be real than a one-off.

## Replicate and Modal (not run: no credentials)

- **Replicate:** [`jd7h/zero123plusplus`](https://replicate.com/jd7h/zero123plusplus), community, about $0.074/run, L40S, about 76 s, six fixed views, square input. [`tencent/hunyuan3d-2mv`](https://replicate.com/tencent/hunyuan3d-2mv), about $0.10/run, but it makes a 3D shape from views, not views. No MV-Adapter, Era3D or SV3D listing found. Replicate lists Wan 3.0 and FLUX 3 as of today, but nothing that rotates cameras beyond video prompts.
- **Modal:** no hosted models; pay per GPU second ([pricing](https://modal.com/pricing)): L40S $0.000542/s, A100 40 GB $0.000583/s, H100 $0.001097/s, $30 a month free on the Starter plan. A self-hosted MV-Adapter or Zero123++ run on an L40S for about 30 s costs about $0.02. No Modal example for these models was found; the owner would need a Modal account and token, and a small script that wraps the model repo. Not recommended: we expect poor results on clouds, and the engineering is not worth it.

## Next steps (if the owner wants to push further)

1. Re-run H3 with `distance` 2 to 3 and 12 keyframes (smaller turns per keyframe) to test whether it can become a true orbit.
2. Ask the Qwen multi-angle for elevation -15° (looking up) next to FLUX.2 at 30 to 60° (looking down), for the "from the ground" and "from a plane" views.
3. Run 4 seeds per angle and compose a "views sheet" per target for the sim agents.
