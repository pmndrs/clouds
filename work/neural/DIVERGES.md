# Neural clouds — where we differ from HaloRT

The source is the paper (arXiv 2611.12103) and the released code
(`github.com/rendervous/HaloRT`). A row here is a difference we know about.
It is not a bug list. Add a row when you choose to differ or find that you do.

Status: **intended** (we chose it), **open** (seen, not understood or not
decided), **closed** (no longer differs).

IDs: `N-S` source code vs paper, `N-F` features, `N-M` model and inference,
`N-L` lighting and scene, `N-T` training.

| ID | Concept | The source does | We do | Why | Effect seen | Status |
| --- | --- | --- | --- | --- | --- | --- |
| N-S1 | Density scales for crossings | paper: ×4, ×1, ×0.25, ×0.1; code: 4, 1, 0.25, 0.125 | follow the code | the weights were trained on the code | — | intended |
| N-S2 | Reduced optical depth | paper: `1 - 1/(1 + 0.5 tau)`; code: `1 - exp(-0.2 tau)` | follow the code | same | — | intended |
| N-S3 | Depth and crossing encoding | paper: plain distances; code: `log(1 + 0.2 t)` and fourth root of gaps | follow the code | same | — | intended |
| N-S4 | Albedo feature | paper: albedo at the point; code: `sa ^ (2 tau (1 - sa g))` | follow the code | same | — | intended |
| N-S5 | Attention block | paper: HaloNet; code: block attention, no position embedding, 8 memory tokens | follow the code | same | — | intended |
| N-F1 | Empty-space skipping | DDA over a majorant grid | our jump-flood SDF (planned, N2) | already built for this texture | not measured | open |
| N-F2 | Density storage | float tensor in a `[-1, 1]` cube | r16float 3D texture, density / p99 (planned, N2) | our VDB route | not measured | open |
| N-F3 | March step | fixed 0.001 units (up to ~2000 steps) | to be chosen in N2 | cost on a Mac GPU | not measured | open |
| N-F4 | Sun and environment shadow rays | sun: fixed-step march over the first 0.2 units, then ratio tracking with a majorant field; environment: ratio tracking | deterministic fixed-step march to the box exit (step = primary step, start offset 0.5 step for the sun, a random offset for each environment ray) | no majorant field yet; simpler, and the sun term is noise-free | sun panel matches the authors' direct-light look by eye (N2b) | intended |
| N-F5 | Environment sampling | importance-samples an HDR equirect by luminance (XREnvironmentSampler), env / pdf | uniform sphere directions (pdf 1/4pi) over a procedural sky (zenith-horizon gradient plus flat ground), normalised to unit pixel mean per channel like `normalize_environment` | importance-sampled HDR maps are a later task | noisier than the authors' at 8 samples where the sky is concentrated; ground bounce shows warm at the base | open |
| N-F6 | Pixel jitter | the web demo jitters the primary ray inside the pixel each frame (`jittered`) | pixel centre | no accumulation on the lab page yet | — | open |
| N-L1 | Environment | synthetic HDR maps, unit mean | Hillaire sky baked to equirect, sun disc removed (planned, N4) | time of day | not measured | open |
| N-L2 | Phase function | single Henyey–Greenstein | same for now; our clouds elsewhere use dual-lobe | the weights know only HG | — | intended |
| N-M1 | Runtime | PyTorch + Vulkan/CUDA | ONNX Runtime Web, then hand-written WGSL (pending D1) | browser | — | open |
