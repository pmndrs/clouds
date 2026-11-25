# PJH23 — Physically Based Rendering: From Theory to Implementation (4th ed.)

- **Authors / year / venue:** Matt Pharr, Wenzel Jakob, Greg Humphreys, 4th ed., MIT Press, 2023. Book, not downloaded.
- **Paper:** book; read online at https://pbr-book.org/4ed
- **Project page:** https://pbr-book.org/4ed
- **Official code:** pbrt-v4, https://github.com/mmp/pbrt-v4 (URL verified, HTTP 200). Licence: check repo LICENSE file (I did not verify the licence text).
- **Third-party code:** none checked beyond pbrt-v4
- **Data / weights:** none
- **Cited by HaloRT as:** volume scattering and transmittance estimation background

## Volume-scattering material to read
- The volume-scattering chapter (titled "Light Transport II: Volume Scattering" in the 4th ed.). Chapter number NOT verified; check the ToC at https://pbr-book.org/4ed.
- Henyey–Greenstein phase function: in the phase-function section of that chapter.
- Delta tracking and ratio tracking: in the volume sampling / majorant discussion of the same chapter (verify section titles on the site).

## Summary
Textbook reference for radiative transfer in participating media: absorption, out-scattering, emission, phase functions, transmittance estimators, and unbiased free-flight sampling with majorants. pbrt-v4 implements these in its media code, so it is usable as a ground-truth renderer for clouds. No cost or result numbers; it is a reference, not a method paper.

## Use for us
Ground-truth definitions for delta/ratio tracking and Henyey–Greenstein, and pbrt-v4 as an offline reference renderer for validating our cloud output.
