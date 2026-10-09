# Cloud motion and living detail: owner observations and ideas (2026-10-09)

**Status: parked for a dedicated session with the owner.** This captures the owner's observations, which come from many personal recordings of real clouds, and their brainstorm, so another agent can pick it up with them. Nothing here is planned work yet, except the "directional detail" item, which feeds plan task 9-D.

## What the owner sees in real clouds that engines get wrong

1. **Engines animate clouds wrongly.** Most of the time nobody watches the clouds, so they could effectively freeze until observed. When someone does stop and watch, the motion is always wrong.
2. **The skin "boils".** Engines take a cloud outline, then layer erosion, fluff and random offshoots uniformly over it. Animating that noise makes the surface boil in place.
3. **Real detail is carried, not regenerated.** When you watch a real cloud move, you can follow every wisp, pattern and shape as it travels. The small detail almost never visibly changes in place; it moves with the cloud.
4. **Detail depends on direction:**
   - The **leading face**, pushing into open air, is compacted, so its detail is sharper.
   - The **trailing edge** blurs out, and loose bits drift off downwind.
   - The **top** has many ridges and shapes with crisp-ish edges.
   - The **bottom** is heavier and smoother, blurring detail out.
   - From a single photo the owner can tell which way a cloud is moving, from the sharp face, the soft trailing edge and the trailing wisps.
5. **How a cloud moves.**
   - A cloud billows forward from inside itself. Its skin rolls back away from the direction of travel, and where the skin rolls into itself it is reabsorbed.
   - **Life cycle:** in the right weather it keeps moving and re-forming. Sometimes it ejects a piece of itself. Then it may not have enough mass to re-form as it billows. Neighbouring clouds absorb its wisps along their motion tracks. Eventually the form is too loose and the cloud becomes wisps: it stops billowing but keeps moving and expanding. Then it vanishes, gets absorbed, or suddenly starts absorbing wisps and re-forming.

## The owner's brainstorm

- A **grid or tube** over the cloud's surface, like a conveyor. It emits at the leading face, spreads over the shape and runs down the back. Wisps and detail attach to this grid, and the grid slides very slowly as the cloud moves, so detail travels instead of boiling.
- **Billow spheres:** a hierarchy of spheres sized and placed from the cloud's shape, one big one at the front, then medium and small ones, with smaller spheres attached to parts. As the cloud moves forward the spheres **rotate toward the body**. Wisps attached to a sphere keep their shape and only change position as it rotates. This is the roll-back of the skin.

## How it maps to our system

- **Today:**
  - The regional field moves with the wind (P6-A).
  - The up-rez noise is world-anchored or wind-advected; check `density.wgsl.ts` and the sky layer's billow offsets.
  - Evolution regenerates the volume and swaps it every 1.5 s (P6-A), so shapes morph rather than travel.
  - Detail noise is uniform over the surface except for height-based wispy and billowy type. That is exactly the uniform "fluff layer" the owner describes.
- **Directional detail is cheap and static, so it does not need the motion system.** We already know each cloud's wind or shear vector (P9-B) and its height fraction. Detail sharpness, erosion strength and wisp probability could depend on `dot(surfaceNormal, windDir)` (leading or trailing) and on height (top crisp, base smooth). → **folded into plan task 9-D.**
- **Freeze until observed** is also a cost idea: animate or regenerate only when the camera is still and the clouds are on screen. This fits our amortization: evolution cadence driven by observation.

## Candidate techniques to research later

None of the decks we have (`docs/research/README.md`) cover cloud motion of this kind.
- **Advected textures:** Neyret 2003, "Advected Textures" (SCA). Regenerate texture coordinates at several phases and blend them, so detail travels with a flow without stretching forever. It is the closest classic match to the "grid that slides" idea.
- **Flow noise:** Perlin and Neyret 2001, "Flow Noise". Noise whose features rotate and swirl in place rather than boil. A match for "spheres rotating toward the body".
- **Lagrangian texture advection:** Yu, Neyret, Bruneton and Holzschuch 2011, "Lagrangian Texture Advection: Preserving both Spectrum and Velocity Field" (TVCG). Particles carry texture patches, which is the "wisps attached to a structure" idea.
- **Curl noise:** Bridson 2007, "Curl-Noise for Procedural Fluid Flow". A divergence-free velocity field for advecting detail and wisps.
- **Vortex rings and roll-up:** the billowing roll-back is roughly a toroidal circulation around a rising thermal. A per-cloud analytic vortex field could drive the "rotating skin".
- **Simulation:** our Houdini Pyro library (P9-F) already produces real billowing. Exporting sim *sequences*, or the velocity field, could provide ground truth or a baked flow per hero.

## Data the owner has

- **Many recordings of cloud motion.** Optical flow on time-lapses would turn the observations into numbers:
  - surface velocity on the leading face versus the trailing face;
  - how long a wisp lives;
  - roll-back speed relative to translation;
  - detail scale on the front versus the back.

  That gives an objective target, like the photo specs did for shapes.

## Suggested first step when picked up

1. Ask the owner for 3–5 short clips: a single cumulus crossing, a wisp being ejected, a cloud dissipating.
2. Run optical flow on them, and write the measurements up like `photo-species-specs.md`.
3. Prototype the cheapest visible win: directional detail plus noise advected with the cloud's own velocity, with no boiling. Do it on one hero cloud on a lab page, A/B against today's uniform detail.
