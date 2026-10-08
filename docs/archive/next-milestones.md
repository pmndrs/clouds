# Next milestones: realistic clouds and authored assets

**Current execution directive — 2026-10-08:** the user withdraws the small
shape-review stops and authorizes completing the platform through P6, then
advancing realism autonomously toward three-geospatial's visual quality. Earlier
sequential/checkpoint text below is historical and no longer blocks compatible
platform/asset work. Do not request another appearance review of orb/placeholder
clouds. Use bounded lower-cost workers for platform, assets and source work; root
owns GPU integration and visual acceptance. Technical preview readiness does
not imply realistic appearance, final presets, hardware coverage or publication.


Updated 2026-09-20. This is the execution order for the remaining work within
P2–P6, not a new sequence that resets completed work. Planned benches below do
not exist yet unless explicitly marked as available.

## Where we are

The active phase is **P2 coverage/LOD and density quality**. P3 lighting
diagnostics remain available, but P3 is the next integration phase.
P2.6 now has a fixed-region cloudscape with coherent per-formation coverage and
shared coarse/fine density. Full detail is now the default after the atlas
coarsening audit failed provisional error gates. It is ready for coverage review; optical appearance
and lighting gates remain open. The separate P2.4 weather study remains available.
P4 reconstruction, P5 library/React and P6 asset/release packaging have local
previews. Their presence does not mean the renderer has passed its visual gates.

The existing eight-form voxel atlas is a provisional source. Removing banding
will not by itself turn those forms into realistic clouds. Realism requires
better density structure, stable light integration and coherent atmosphere.
This work belongs in P2/P3, before accepting P4 performance presets.

## Visible milestones and acceptance

| Packet | Visible result | Pass/fail focus | Status |
| --- | --- | --- | --- |
| P2.5 → P2.6 | The same cloud remains visible on a long approach, changing detail without appearing from nowhere | Coarse fallback while fine data loads; one density contribution; matched view/shadow ownership; approach/retreat/cut captures | Fixed-region prototype integrated; transition/finite-boundary review and production-atlas error measurements remain |
| P2.7 — realistic density source | One cumulus formation with broad lobes, irregular smaller structure, soft eroded edges and a plausible base; side-by-side with the placeholder | Coherent structure across scales, no obvious voxel stairs or repeated stripes at target views; silhouette survives coarsening; inside/close/distant views. Judge shape in unshadowed and reference-lit views separately | Isolated candidate and comparison viewer ready for shape-direction review; world replacement blocked on that review |
| P3.4 — lighting convergence | The formation holds stable shading during orbit/zoom and sun motion | Self-shadowing enabled; reference convergence and full-size motion review; no prominent bands, crosshatching or strobing; investigate cache representation separately from sample count | Lighting bench exists; fix and acceptance remain open |
| P3.5 — first realistic integrated scene | The P2.7 formation in a coherent sun/sky/atmosphere scene, from ground to inside | Shape plus stable lighting; convincing thin/thick density, backlighting, shadow softness and distance appearance; no duplicated haze/tone mapping; user visual review against selected references | Depends on accepted density and lighting candidates plus P2 continuity for cloudscape acceptance |
| P4 completion | Quality/performance versions of the accepted scene | Measured whole-frame benefit, motion/history quality and supported-device evidence | Resume final preset selection after P3.5 |

**First realistic isolated cloud:** P2.7 + P3.4. **First realistic cloudscape:**
P2.5/P2.6 + P3.5. These are deliverable/review gates, not calendar promises or a
claim of matching Decima quality. Start with one convincing cumulus case before
expanding cloud types. Retain the simple fixtures as regression references.

## Asset benches: queued after the current P2 checkpoint

### Available now — A1/A2 dense and mesh baseline

[`/authored/`](http://127.0.0.1:5173/authored/) loads a Blender-authored dense
field and a Blender cube converted to cloud density. It proves the transport,
transforms and basic mesh conversion. It is not VDB ingestion or a finished
mesh-to-cloud authoring experience.

### A2.1 — actual VDB import bench (next asset packet)

Use one static, licensed or author-owned **real `.vdb` fog-density grid**. First
prove a supported native/offline converter into our dense runtime field; inspect
available readers before selecting a dependency. Preserve grid name, transform,
voxel spacing, background and density scale. Provide source slices/statistics
and the rendered volume with orbit/zoom and unshadowed/reference-lit modes.
Record conversion and quantization error separately from renderer error.

Pass: repeatable conversion, matched bounds/world scale and sampled values
within declared conversion tolerance; finite visible volume; useful rejection of
unsupported grids and bounded allocations. A level set is not silently treated
as fog density. No renamed dense file counts as a VDB test. If the converter is
unavailable, return the exact dependency blocker rather than replacing the test
with a synthetic dense fixture.

This promotes basic VDB import to scheduled work. **A3 direct sparse/PicoVDB
rendering and A4 VDB export/DCC round trip remain separate follow-ups.** Import
need not wait for either; browser WASM is evaluated after the offline baseline.

### A2.2 — mesh-to-cloud authoring bench (following asset packet)

Extend the existing converter/bench with an author-owned curved mesh and a
concave closed mesh. Show the input mesh, occupancy/soft density and final cloud.
Expose resolution, padding, falloff, density and optional seeded edge erosion.
Retain the original fixture for parity. Keep the existing declared closed-mesh
policy and show useful errors for unsupported inputs.

Pass: recognizable source shape at zero erosion, continuous falloff controls,
correct transforms/scale, deterministic erosion and bounded conversion cost;
record source triangles, resolution, duration and memory estimate. Review whether
the result feels like a cloud shaped by the mesh. First delivery uses fixtures;
general file-drop formats and interactive large-mesh performance are separate.

## Sequential dispatch order — revised 2026-09-19

One active phase, with one bounded implementation worker by default. Parallel
work is useful within a phase when files and dependencies are independent; it
is not a reason to advance several visible milestones at once. Existing P4–P6
previews stay available and receive necessary fixes, but no new feature work is
scheduled there while P2/P3 visual foundations remain incomplete.

| Order | Work | Worker / orchestrator split | Checkpoint before advancing |
| --- | --- | --- | --- |
| 1 — delivered checkpoint | P2.5 bounded coarse/fine LOD proof | One Luna high worker plus root review; [evidence](p2-lod-evidence.md) | Mechanism checks pass; optical differences remain unaccepted; this proof alone does not close world LOD |
| 2 — active, prototype integrated | P2.5 world integration + P2.6 continuity evidence | Narrow worker packets, one shared renderer owner | Long approach/retreat and cuts, persistent broad coverage, no double density; carry shadow-lighting defects explicitly to P3 |
| 3 | P2.7 realistic density source | Luna high source/fixtures; root integration and appearance review | Review one convincing formation at coarse/fine detail, close/inside/distant; retain simple regression fixtures |
| 4 | P3.4 lighting convergence, then P3.5 atmosphere and integrated realism | One focused sampling/cache worker; root transport decisions and GPU acceptance | Full-size moving-camera review with self-shadowing enabled, final view/shadow continuity, integrated scene review |
| 5 | P4 reconstruction/presets on accepted visuals | Luna capture/performance work; root preset decisions | Quality/cost evidence; required hardware explicitly tracked |
| 6 | P5 API acceptance, then P6/A2.1 VDB and A2.2 mesh benches and release validation | Luna asset and lifecycle packets; root boundary/release review | Actual VDB conversion and mesh controls, source semantics, consumer/device evidence; publication separate |

The asset benches remain explicit deliverables. At the P2 checkpoint, an asset
packet may be brought forward if it supplies a needed comparison fixture or the
user prioritizes it; do not silently start a second phase just to occupy a slot.
An existing lighting diagnostic may be used or corrected during P2 when it is
necessary to separate density/LOD errors from shading errors. This is supporting
work, not acceptance of a later phase. P2's shared-density ownership can be
validated before final P3 lighting appearance; full shadow agreement remains a
required integrated gate.

Follow [agent orchestration](agent-orchestration.md): fresh narrow contexts,
exclusive paths, one attempt plus one focused correction, concise handoffs and
targeted tests. The orchestrator should not duplicate worker exploration or
spend a full turn polling unchanged progress. Escalate a specific difficult
problem to Sol only after narrowing it. Do not launch extra reviewers by default.

Human checkpoints are appearance choices, full-size motion quality, mesh shape
retention and final API/device review. Routine conversion and unit checks do not
need user approval. No credit ceiling or exact savings is inferred from this
plan; model routing and bounded scope are cost controls, not billing caps.
