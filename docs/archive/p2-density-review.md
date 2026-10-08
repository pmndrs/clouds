# P2.7 — density candidate review

2026-09-20. Open [Density study](http://127.0.0.1:5173/density-study/).
This is a source/shape checkpoint within P2. It does not approve lighting,
world streaming, realistic atmosphere or performance presets.

## What this delivers

The left pane shows an actual 48³ tile extracted from the provisional world
atlas. The right shows a new 96³ cumulus candidate. Both use the same physical
bounds, extinction scale, camera and reference integrator. Pane outlines and a
permanent gap distinguish the two views. The alternative comparison shows the
new source at fine and half-horizontal resolution.

The candidate uses connected unequal lobes, a condensation-base profile,
smooth domain warping, multiscale noise and controllable edge erosion. It is
original prototype code, not a Decima implementation or a physical weather
simulation. Seed alters irregularity; it does not select a fundamentally new
cloud family. Density is baked once on the CPU. Both diagnostic renderers and
all comparison fields remain allocated; this is not a performance demo.

The source stays isolated until shape review. The fixed-region world continues
to use the provisional atlas. P2.6 motion/transition acceptance remains open.

## Five-minute review

1. Start with **Overview**, seed **17**, erosion **0.55**, density **1**.
   Compare **Reference-lit** and **Unshadowed density**. Unshadowed is for
   silhouette/opacity; it intentionally removes shading cues.
2. Try **Play orbit**, then **Close** and **Inside**. Pause before changing
   the source. **Play approach** runs inward and back outward on a fixed path.
3. Try seed **29** or **53**, and erosion **0.25 / 0.55 / 0.85**. There is
   no requirement to approve a candidate. Record a promising setting or say
   that the broad shape still needs work.
4. Switch to **New cumulus fine → coarse** at Overview and **12 km**. Expect
   slightly softer detail on the right, not a different formation. The optical
   report measures this separately from lighting.
5. Save a comparison/evidence file for a problem. Include pose, lighting, seed
   and erosion. The **512 sun samples** option is a slow diagnostic; it is not
   a claim that lighting has converged.

## Pass/fail and known limits

| Area | Pass for this checkpoint | Fail / report |
| --- | --- | --- |
| Broad form | Reads as a connected cumulus with a plausible base and varied billows | Solid rock/pedestal appearance, arbitrary stacked blobs, clipped flat top |
| Density detail | Irregular structure supports the large shape | Periodic stripes, detached fuzz, obvious voxel stairs or sharp cut faces |
| Erosion | Softens/breaks edges without moving the entire body | Speckling or collapse of the main form |
| Camera motion | Formation remains fixed and readable as you approach/orbit | Source swimming, geometric popping, major silhouette loss |
| Coarsening | Same broad silhouette and opacity with reduced fine structure | Missing branches, new gaps, substantial opacity shift; inspect reported error |
| Lighting | Used to inspect structure; not accepted here | Bands/strobing remain P3 defects and should still be reported separately |

A uniform unshadowed interior is expected. Dense interiors can obscure the sky.
No atmospheric depth cues, multiple scattering or realistic world lighting are
being certified. Source voxel resolution is limited to 64³/96³. A few isolated
stills and numerical passes cannot establish realism or smooth full-size motion.

## Decision needed before replacing the world source

**Does this candidate move in the right direction for the broad cloud shape?**
If so, identify the preferred seed/erosion and the most obvious remaining shape
problem. If it still reads as a stylized solid mass, say so; that is a reason to
revise density before making many world variants. Final lighting judgment comes
in P3 with self-shadowing enabled and its own convergence/motion evidence.

## Optical audit scope

**Measure source LOD** compares all eight placeholder tiles and the current
candidate at 320², 12/4 km, and 20°/90° azimuth. It uses the same bounds and
0.003/m extinction scale for every source. Actual world bounds/extinction vary,
so this is a normalized source audit, not proof of world transition quality.
Each pose checks reference integration at 256 versus 512 samples before judging
coarse and half-blended fields. Existing provisional gates are retained:
max absolute transmittance error 0.02, cloud-pixel mean 0.005, silhouette mismatch
5%, integrated opacity difference 3%, and at least 16 reference cloud pixels.
Failed or inconclusive results must remain in the report. The half blend is
resampled into a full-size r8 field for this diagnostic; production world LOD
blends two textures directly. No cache, history or lighting-quality claim follows
from this unshadowed audit.

## Recorded technical evidence

[Raw Chrome/Metal report](research-results/density-study-results.json), default candidate
seed 17, erosion 0.55, 96³. **109 unit tests**, typecheck and lab build pass.
Five browser/GPU checks pass: same-source pane equality (max T difference 0),
visible finite density, exact clear output at density zero, and invariant
transmittance when self-lighting is enabled. No WebGPU validation errors were
recorded. Overview, Close, and a changed orbit angle were inspected; these are
spot checks, not a full-size motion acceptance pass.

All **36/36 reference poses converged** (worst max T difference 0.0009765625).
No coarse or half-blend pose met all provisional gates:

| Source group | Coarse passes | Half-blend passes | Worst coarse absolute T error | Worst half-blend error |
| --- | --- | --- | --- | --- |
| Eight placeholder atlas forms | 0/32 | 0/32 | 0.36328 | 0.20361 |
| New 96³ candidate | 0/4 | 0/4 | 0.18066 | 0.10303 |

Consequently **the world viewer now defaults to full fine density**. Coarse
mode remains explicitly experimental, and automatic world LOD is not accepted.
Do not infer that the previous 32×64×32 result on the narrower isolated profile
applies universally. The new source itself needs shape review, and then an
appropriate density representation/filtering policy, before automatic world
replacement. The report's pass/fail concerns representation error, not whether
the cloud looks real.

Two workers were used: Luna high for source generation and Luna medium for the
source extraction/coarsening audit, each with one focused correction. Root built
the viewer, reviewed the source, adjusted density contrast, ran integration
checks and recorded acceptance limits. No account billing savings were measured.
