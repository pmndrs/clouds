# LEE83 — Digital image smoothing and the sigma filter

- **Authors / year / venue:** Jong-Sen Lee, Computer Vision, Graphics, and Image Processing 24(2), 1983 (page range given as pp. 255–269 in most citations; one patent cites pp. 189–198, so verify before citing)
- **Paper:** not found (no open PDF in search; publisher is Elsevier)
- **Project page:** none
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none
- **Cited by HaloRT as:** edge-preserving smoothing background

## Summary
The sigma filter averages only neighbours whose values lie within about two standard deviations of the centre pixel, so strong edges stay sharp while noise in roughly uniform areas is averaged out. It is cheap and local. Lee's earlier 1980 IEEE paper on local statistics is cited as the origin of the idea. Described in patents and a 1983 abstract on SAR speckle; I did not read the full paper.

## Use for us
A very cheap edge-preserving baseline for denoising noisy cloud shading in a WebGPU pass, to compare against the a-trous filter.
