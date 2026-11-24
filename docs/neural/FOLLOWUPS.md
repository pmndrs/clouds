# Neural clouds — follow-ups (documented, not scheduled)

Written 2026-11-24. The owner's bar is in `PLAN.md` § The bar: a neural method
earns a place only if it makes the core VDB or cloud raymarcher faster or
better looking. Nothing here is started until the owner says so.

Nothing in this file is measured. The numbers come from the papers or from
our own earlier notes, and each row says which.

## What the raymarcher spends and where it is wrong

- **Cost:** steps along the view ray × light taps per step. The light march
  (or light grid) is the expensive part.
- **Known error:** our fit for multiple scattering is 25–35 % too dark on lit
  faces against our own path trace (P2.4b). The path-traced reference also
  showed that the foam look and blue shade are artefacts of our lighting.
- **Known strength:** every step shades, so lit ridges are as crisp as the
  density. An image-space network cannot promise that.

So a network can help in two places only: make the lighting **more correct**
for the same cost, or make the light taps **cheaper** for the same look.

## HaloRT as ported (the base)

- Cost on the M5 Pro at 512², network only: 23 ms fp16 on our engine. That is
  more than a frame before features and display.
- It replaces the whole lighting of one cloud in a box. It cannot be faster
  than a raymarcher that takes a few ms.
- Its possible value is quality: lighting close to a path trace. The picture
  that settles this is neural beside path trace beside raymarch for the same
  cloud, with the cost of each. That sheet is still owed (N3).

## A. Smaller image network (a student of HaloRT)

- **What:** the same feature pass, a network several times smaller, trained
  to copy HaloRT's output. No path tracing needed to train.
- **Against the raymarcher, speed:** no gain. It still adds a feature pass and
  a network on top of a march. It could only become affordable, not faster:
  low resolution, and lighting refreshed every few frames.
- **Against the raymarcher, quality:** at best HaloRT's. Soft detail; ridges
  depend on the features.
- **Use:** mainly a cheap way to learn the training loop. Not a candidate for
  main by itself.

## B. Network for multiple scattering only

- **What:** keep our marched single scattering. A small image-space network
  adds scattering orders 2 and up, replacing the octave or fit formula.
- **Against the raymarcher, quality:** this targets the known 25–35 % error
  directly, and keeps crisp ridges because the sharp part is still marched.
- **Against the raymarcher, speed:** a small added cost, since orders 2+ are
  smooth and could run at low resolution and a slow cadence. A real gain is
  possible only if a correct network lets us drop the multi-octave terms or
  shorten the light march. Not known.
- **Needs:** path-traced targets split by scattering order (the path tracer
  already separates 0–1 from 2+, but its volume work has open problems), and
  training.

## C. Network inside the march (MRPNN family)

- **What:** at each shading sample, a tiny network reads a few taps of a
  transmittance pyramid and returns the scattered light, in place of the
  light march and the multiple-scattering formula.
- **Against the raymarcher, speed:** the only direction that attacks the
  expensive part. Light taps per step become a handful of texture reads plus
  about 50 k parameters of arithmetic. MRPNN reports 25–33 ms at 1024² on an
  RTX 2080 for path-trace-like lighting; whether it beats our light grid at
  our step counts is not known.
- **Against the raymarcher, quality:** lighting close to a path trace with
  detail kept, since every step still shades.
- **Reach:** needs no box, so it fits procedural cloudscapes as well as VDB
  heroes. WebVDB already carries a small `'neural'` mode of this kind.
- **Needs:** new inputs, training data from the path tracer, and a network in
  the march shader. The largest build of the three.

## Reading across

| | Could be faster than today | Could look better than today | Fits cloudscapes |
| --- | --- | --- | --- |
| HaloRT as ported | no | maybe (sheet owed) | no |
| A. student | no | maybe, softer | no |
| B. multiple scattering only | only if it replaces existing terms | yes, targets the known error | not at first |
| C. inside the march | possibly, replaces the light march | yes | yes |

If one of these is ever taken up, B and C are the two that bear on the core
renderer. A is a training exercise.
