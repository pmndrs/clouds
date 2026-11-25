# NGHJ18 — Monte Carlo Methods for Volumetric Light Transport Simulation

- **Authors / year / venue:** Jan Novak, Iliyan Georgiev, Johannes Hanika, Wojciech Jarosz; Computer Graphics Forum 37(2) (Eurographics 2018 STAR), pp. 551-576, doi 10.1111/cgf.13383
- **Paper:** https://cs.dartmouth.edu/wjarosz/publications/novak18monte.pdf (Dartmouth was down; saved from a Wayback Machine capture of that URL) (local: `artifacts/research/papers/neural/NGHJ18-novak-2018.pdf`)
- **Project page:** https://cs.dartmouth.edu/wjarosz/publications/novak18monte.html ; SIGGRAPH 2018 course notes/slides: https://cgg.mff.cuni.cz/~jaroslav/papers/2018-mcvolrendering/index.htm
- **Official code:** none found (survey)
- **Third-party code:** no dedicated GLSL/WGSL/Shadertoy delta/ratio-tracking repo found. Algorithms for residual ratio tracking: supplementary https://cs.dartmouth.edu/wjarosz/publications/novak14residual-supplemental1.pdf and https://www.jannovak.info/publications/RRTracking/RRTracking.pdf. Note: Disney patent US9767601 on residual ratio tracking.
- **Data / weights:** n/a
- **Cited by HaloRT as:** delta/ratio tracking background; ground-truth volumetric path tracing.

## Summary
Survey of MC methods for light transport in participating media. Concretely for implementation (sections 4.2, 5.3, 8):
- Delta (Woodcock) tracking: homogenise with fictitious matter. Choose a majorant mu_bar >= mu_t everywhere. Step t += -ln(xi)/mu_bar; at each tentative collision pick real with probability mu_t(x)/mu_bar, else it is a null collision (mu_n = mu_bar - mu_t) and continue. Gives exact free-flight distance samples; the PDF value mu_t(y)T(x,y) is not known pointwise, which blocks MIS with other distance samplers. Weighted delta tracking relaxes the majorant requirement (mu_n may go negative) at the cost of weights.
- Transmittance estimators: track-length = delta tracking, estimate is 1 if the ray reaches t with no real collision else 0 (binary, noisy). Ratio tracking (Novak 2014; Cramer 1978): no termination; each null-collision tentative step multiplies weight by mu_n(t_j)/mu_bar (i.e. 1 - mu_t/mu_bar), gives lower-variance continuous estimate, unbiased.
- Residual ratio tracking: pick a control extinction mu_c (e.g. a coarse, per-voxel average or minorant), compute control transmittance T_c analytically, and ratio-track only the residual mu_r = mu_t - mu_c with majorant for the residual: T = T_c * prod_j (mu_r(t_j)/mu_bar_r) style factors (eq. 50 uses mu_n^r over mu_bar^r). Residual majorant is much smaller than mu_bar, so far fewer steps; needs a space-partitioning structure for both control and majorant.
- Next-flight estimators (Cramer) add uncollided contributions at each tentative collision.
- Majorant grids: coarse voxel grid (or kd-tree/octree) storing per-cell max extinction (and min for control); the tracker steps cell-to-cell (3D DDA), sampling a tentative collision per cell, or with one majorant optical depth sample carried across cells. Tight majorants along long rays are the dominant cost lever; hierarchical (octree) accelerator with fine data in leaves and majorants in interior nodes is suggested.
Also covers unidirectional/bidirectional path tracing, MIS, many-light, density estimation, and open problems (null-collision + MIS, ML guiding, surface+volume joint handling).

## Use for us
Implementation spec for the ground-truth/reference path tracer and any training-data generator: majorant grid + delta tracking for scattering distance, residual ratio tracking for shadow rays. Keep the majorant grid resolution a tunable.
