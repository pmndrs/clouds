# HZD bench on React + R3F v10: plan

Owner request (2026-10-12): move the HZD bench, and the weather-map painter first of all, to React and `@react-three/fiber` v10 (canary), with
shadcn components, so the painter can grow into smart components. Tweakpane stays for the tuning panel for now; Leva or our own shadcn controls
replace it later. Work happens on branch `hzd-r3f` (worktree `.claude/worktrees/hzd-r3f`); `main` keeps the working vanilla bench.

## Status (2026-10-12)

Phases 0-4 are done on branch `hzd-r3f`: the React bench is `examples/lab/hzd/` (the paths below that say `hzd-r3f/` are where it was built
before the cut-over). Checks: canonical captures match the vanilla bench within run noise (mean 0.13-0.38 vs run noise 0.29-0.49), sky-layer
GPU time within noise (alternating-order runs), the scripted shell and painter drives pass, typecheck and tests pass, the packed-consumer
check passes. To merge into `main` (decision 5). On alpha.6: bump `@react-three/fiber` and `@react-three/tsl` in `package.json` and the
`overrides` in `pnpm-workspace.yaml`. Still on the deprecated `@react-three/fiber/webgpu` entry (it goes at the first beta): the legacy React
examples and `packages/legacy/react`, and the import snippets in `docs/guide/*.mdx`, `docs/react.md` and `packages/react/README.md` (which
should also name `@react-three/tsl` as a peer of `@clouds/react` now).

## What must not change

These are what scripts, docs and the owner rely on. Every phase is checked against them.

- **`window.__clouds`:** `ready`, `error`, `report()` (at least `gpuMs`, `frameMs`, `renderSize`, plus the bench's view, ref and camera fields),
  `bookmark(spec)` with the `<view>` / `ref:<id>` + `@sun:` `@cov:` `@exp:` `@ref:` `@mode:` grammar, `settle(n)`, `frame()` counting.
  `scripts/gpu/capture.mjs` and `work/captures/F2/tools/runs.mjs` use only these. They read no DOM ids.
- **`?clean=1`:** a viewport with no UI at all (captures are full-viewport screenshots).
- **The URL:** every key and prefix in the HZD-BENCH.md URL table (`view`, `pos`, `lookaz`, `pitch`, `fov`, `sunel`, `sunaz`, `coverage`,
  `exposure`, `motion`, `quality`, `ref`, `refmode`, `pip`, `corner`, `refpage`, `refview`, `clean`, and the `proc_` `hz_` `hzn_` `c_` `sky_`
  `cirrus_` setting prefixes). Old links must open the same sky.
- **`window.__tune`:** `snapshot()`, `changes()`, `set()`, `apply()`.
- **Dev routes:** `/__hzd/ref/<id>` (references stay local only) and `/__hzd/ndf/*` (painter list and save).
- **The image:** captures of the canonical shots match the vanilla bench within run noise (diff with F2's `diff.py`), and sky-layer GPU time
  stays within run noise. React must not re-render per frame.
- **Rules from work/README.md:** the loop always runs (noise animates), no per-change bake that stalls a frame, light colours from `@pmndrs/sky`.
- **Shared modules stay as they are:** `compare/rig.ts`, `compare/panes/ours.ts`, `compare/sun-control.ts` and `tune/panel.ts` are also used by
  the compare page and the Decima bench. The new bench imports them or ports them. The one planned edit is an optional `host` argument on
  `createOursPane` (see "Reusing `ours.ts`"), which leaves the compare page's behaviour unchanged.

## Approach: a parallel page, then a cut-over

Build the new bench at `examples/lab/hzd-r3f/` beside the vanilla `examples/lab/hzd/`. Both run from the same dev server, so every phase can be
compared side by side, and captures can be diffed against the old page. When the new page reaches parity, it takes over the `hzd/` route and
the vanilla bench is deleted (phase 4). Nothing on `main` breaks in between, because `main` only receives the branch at the cut-over, or
earlier by choice with the new page beside the old one.

**R3F hosts the sky; it does not re-describe it** (owner, 2026-10-12). R3F is the escape hatch: the `<Canvas>` makes the renderer,
scene and camera, and the bench drives them with the code it has today. There are no JSX versions of the sky, the clouds or the
procedural model. The sky's setup (`@pmndrs/sky`, `@clouds/three` `Clouds`, `createProceduralClouds`, the overrides) runs imperatively against
the Canvas's objects, and its per-frame work is a set of scheduler jobs with explicit order. React is there for the controls.

Pure modules move or are shared, not rewritten: `paint/fields.ts` (+ tests), `paint/plugin.ts`, `refs.ts`, `refs-plugin.ts`, and the tuning
metadata in `tune.ts` (groups, ranges, modes, docs parsed from the settings source).

## Dependencies

| Package | Version | Why |
| --- | --- | --- |
| `@react-three/fiber` | `10.0.0-canary.fbc659b` (exact), then `10.0.0-alpha.6` when published | `<Canvas>` on WebGPU from the root entry, `primary`/`share`, scheduler config, async renderer factory |
| `@react-three/tsl` | same canary hash | `useRenderPipeline` moved here from fiber in the canary; `useUniforms`, `useNodes` for later GPU work |
| `@pmndrs/scheduler` | `^0.3` (the canary's own dependency) | The root pins 0.2.0; check that only one copy ends up in the bundle |
| `@vitejs/plugin-react` | 4.x (Vite 6) | Fast Refresh. Today TSX goes through Vite's esbuild with no refresh |
| `zustand` | 5.x (already under fiber) | Bench and painter stores, readable outside React (the frame loop, the harness) |
| `tailwindcss` + `@tailwindcss/vite` | 4.x | shadcn's styling. Imported only by pages that use it |
| shadcn components | vendored source | Button, Slider, Select, Checkbox, RadioGroup, Tabs, Tooltip, Toggle, ToggleGroup, ScrollArea, Separator, Input, Label, Popover, Dialog, Kbd, Resizable |
| `@radix-ui/*`, `react-resizable-panels`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` | current | What the shadcn sources import |

**Effects on the rest of the repo.** The fiber bump touches `examples/lab/r3f/`, the two legacy React examples and `@clouds/react`, which all
import `@react-three/fiber/webgpu`. That entry still exists in the canary (deprecated, removed at the first beta), so they keep working, but:

- `@clouds/react` imports `useRenderPipeline` from `@react-three/fiber/webgpu`. The canary no longer exports it there. **`@clouds/react` must
  switch to `@react-three/tsl`** (and add it as a peer) in phase 0, or the r3f example breaks.
- Phase 0 checks the r3f page, `scripts/check-consumer.mjs` and `scripts/check-packed-consumer.mjs`.

**Where shadcn lives:** inside the bench, `examples/lab/hzd-r3f/ui/` (`components/*.tsx`, `lib/utils.ts`, `globals.css` with the theme tokens), laid out so it can move to `examples/lab/ui/` when the other labs convert. Tailwind's preflight applies only to pages that import `globals.css`.

## Architecture

```
examples/lab/hzd-r3f/
  index.html  main.tsx                    createRoot, <StrictMode>, <App/>
  app/
    App.tsx                               CSS grid: painter dock | viewport (+ ref box) | sidebar; HUD, help, flip overlay
    keys.ts                               one keyboard layer with scopes (global, viewport, painter); replaces the capture-phase trick
  state/
    bench.ts                              zustand: view (ViewState), viewName, ref*, ui (hidden, help, flip), quality
    url.ts                                parse and write the URL (port of main.ts syncUrl / parseLike); pure, unit-tested
    settings.ts                           the live settings objects + a change bus (version counter); useSetting(source, key)
  sky/
    BenchCanvas.tsx                       <Canvas primary id="sky" frameloop="always" dpr={1} renderer={factory}>
    useBenchSky.ts                        runs ours.ts's setup imperatively on the Canvas's renderer, scene and camera (no JSX sky)
    SkyJobs.tsx                           scheduler jobs with explicit order: rig, view -> camera/sun/exposure, sky.update, render, timestamps
    useHarness.ts                         the __clouds contract
  camera/RigControls.tsx                  wraps compare/rig.ts (unchanged) on the canvas element
  sidebar/                                ViewsSection, SunTimeSection, CloudsSection, ReferenceSection, PanelSection (shadcn)
  hud/Hud.tsx                             reads the store at 4 Hz, never per frame
  refs/RefBox.tsx                         side-by-side, picture-in-picture, flip (2D canvas, contain-fit)
  tune/TunePanel.tsx                      mounts the existing Tweakpane tuner in an effect; window.__tune
  paint/
    fields.ts  fields.test.ts  plugin.ts  moved as they are
    store.ts                              zustand: map, base, source, tool, brush, channels, targets, view options, undo/redo, dirty flags
    history.ts                            undo/redo as bounding-box patches (pure, tested)
    sources.ts                            sky readback, through-the-runtime load, PNG decode, autosave, save, download
    sync.ts                               map -> sky upload (live at <= 80 ms, or on release)
    ui/PainterDock.tsx                    Resizable panel: SourcePanel, MapView, StatusLine | ToolBar, BrushPanel, ChannelList, RecipeBar,
                                          WholeMapOps, MapViewOptions, SkyPanel, HistoryFiles (each its own component, shadcn controls)
    map/MapView.tsx                       phase 3: the Canvas2D map (pointer, wheel, overlays) inside a component
    map/GpuMapView.tsx                    phase 5: <Canvas share="sky" orthographic>, the NDF texture on the GPU
```

**Renderer.** `BenchCanvas` passes a factory that builds the `WebGPURenderer` exactly as `ours.ts` does today (`antialias: false`,
`trackTimestamp: true`, ACES, exposure 0.35, pixel ratio 1) and awaits `init()`. The clouds runtime then takes the device with
`sharedBackend(renderer)`. `primary` lets later canvases (the GPU map view, a top-down preview) borrow the same renderer and device.

**Post.** Today `ours.ts` builds a `RenderPipeline` by hand with `clouds.node(...)` as its output and calls `post.render()`. The bench keeps
that pipeline and hands its `render()` to R3F's default render job with `setRenderOverride(store, () => post.render())`, so the job keeps its
place in the scheduler. `@react-three/tsl`'s `useRenderPipeline` is the later option once more of the scene is in R3F.

**Reusing `ours.ts`.** The cleanest path is one optional argument: `createOursPane(canvas, query, opts, host?)`, where `host` supplies an
existing `{ renderer, scene, camera }`. Without it the pane behaves exactly as now, so the compare page is unaffected. The bench then calls
the pane's own `render(view, dt)` and `stats()` from its jobs. If that argument turns out awkward, `useBenchSky` copies the setup instead.

**Jobs.** The vanilla loop is one rAF: rig update, `pane.render`, HUD every 15 frames, `harness.frame()`. In R3F these become jobs with ids and
`before`/`after` constraints (`rig` -> `view` -> `sky` -> render -> `timestamps` -> `harness`), so later work (GPU brushes, the map canvas,
a top-down render target) slots in by name rather than by mount order.

**Why not `@clouds/react`'s `<Clouds>` straight away.** It has no procedural model (`setProceduralModel`, the `hz_`/`hzn_` overrides,
`proc.load({ hzd: true })`). Phase 1 builds this inside the bench's own `useBenchSky` hook. Phase 5 can move it into `@clouds/react` as a
`procedural` prop or a `useProceduralClouds` hook once the bench has proven the shape.

**State.**
- Per-frame data (camera position, GPU times) lives in mutable refs and the zustand store's non-reactive getters, never in React state.
- The runtime's settings objects stay the single source of truth (Tweakpane and the painter write into them). React reads them through
  `useSetting`, which re-renders on the change bus, not per frame.
- The URL is written from store subscriptions, debounced 250 ms, as today.

**Layout.** CSS grid replaces `layout()`. `<Canvas>` measures itself, so `pane.resize` goes away. The painter dock is a shadcn `Resizable`
panel. The ref box modes are grid variants; flip is an overlay.

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test`, and a check against the list under "What must not change".

### 0. Set-up (small)
- Add the dependencies above. Pin the canary by hash.
- Switch `@clouds/react` to `@react-three/tsl`'s `useRenderPipeline`; add the peer.
- Add `@vitejs/plugin-react` and `@tailwindcss/vite` to `vite.config.ts`; scaffold `examples/lab/ui/` with the shadcn components listed.
- **Done when:** typecheck passes; `/r3f/` renders (capture it); both consumer checks pass; `/hzd/` is unchanged.

### 1. The sky mounted in a Canvas (small)
- `hzd-r3f/` page: `BenchCanvas`, `useBenchSky` (the existing setup on the Canvas's objects), `SkyJobs`, `RigControls`, URL read for view
  and settings, `useHarness`, `clean=1`.
- **Done when:** `capture.mjs --page hzd-r3f/` with `clean=1&motion=0` and the six canonical shots matches `--page hzd/` within run noise
  (F2 `diff.py`), sky-layer GPU time within noise (`runs.mjs`), and `bookmark('ref:<id>@mode:side')` works.

### 2. The bench shell (medium)
- Sidebar sections, HUD, help card, keyboard layer, reference box (side, pip, flip), URL writing, Tweakpane panel mounted, `__tune`,
  quality reload, hide UI.
- **Done when:** every URL table entry round-trips (a unit test over `url.ts` plus a scripted check on the page), every key in the help card
  works, and presets saved on the old bench apply on the new one.

### 3. The painter as components (medium-large)
- Port `editor.ts` to the store and the components listed under `paint/`. The map view stays Canvas2D in this phase, so behaviour can be
  compared one to one.
- Undo moves to bounding-box patches (fixes the ~640 MB worst case at 1024²).
- Autosave checks its size and says when browser storage is full instead of failing silently.
- **Done when:** the headless drive script used for the vanilla painter (paint, undo/redo, load an example, gradient, save, view from above)
  passes on the new page, and the saved PNGs are pixel-identical to the vanilla painter's for the same scripted strokes.
- **Result (2026-10-12):** the drive passes. The React painter gives byte-identical maps on repeated scripted runs; the vanilla painter does not
  (two vanilla runs differ by up to 46/255 along the strokes), and React vs vanilla (48/255) is within that. Undo for those four steps holds
  5.8 MB (whole channels: ~70 MB). The autosave moved to IndexedDB (no 5 MB quota; failures show in the dock).

### 4. Cut-over (small)
- `hzd-r3f/` becomes `hzd/`; the vanilla bench and its now-unused code are deleted; `work/HZD-BENCH.md`, the lab index and the painter guide
  are updated.
- **Done when:** the F2 capture runs and the canonical capture command in HZD-BENCH.md work unchanged against `hzd/`.

### 5. What React and R3F make possible (feature work, after parity)
- **GPU map view:** `<Canvas share="sky" orthographic>` drawing the NDF with a TSL material: no CPU composite, any zoom, true channel ramps.
- **GPU brushes:** dabs as compute passes on the NDF texture. Removes the CPU cost and the 8 MB upload per update. `fields.ts` stays as the
  reference implementation the tests compare against.
- **Top-down cloud preview:** the real clouds from above through `useRenderTarget` in a second shared canvas, so painting far from the camera
  shows its result without moving the camera. Needs a spike: the march may assume a perspective camera.
- **Tool work the owner has queued:** one raise/lower tool with a signed amount and a modifier key; slider-relative raise; layers and masks;
  stamps; pen pressure.
- **Controls:** replace Tweakpane with a shadcn settings panel driven by the same parsed metadata (docs, ranges, groups), or Leva.
- **`@clouds/react`:** procedural model support, taken from `useBenchSky`.

## Risks

- **Canary API churn.** The `/webgpu` entry and `useRenderPipeline` have already moved. Pin by hash; bump deliberately; alpha.6 is due soon.
- **Frame order.** Settled by naming the jobs and their `before`/`after` constraints (see "Jobs"); phase 1's capture diff confirms it.
- **Re-renders.** A store subscription in the wrong component re-renders per frame and costs CPU time. Watch React DevTools' profiler and
  the frame time in `report()`.
- **StrictMode double effects** create the sky and the procedural model twice in development. The hook must dispose cleanly, or the GPU
  device collects leaked buffers.
- **Tailwind preflight** restyles Tweakpane's DOM. Scope it or reset `#tune`.
- **Shared device.** `sharedBackend` must see the renderer after `init()`; the factory guarantees that.

## Decisions (owner, 2026-10-12)

1. **A parallel page** (`hzd-r3f/`) and a cut-over.
2. **Pin the canary** by hash now; move to `10.0.0-alpha.6` when it is published (one place: the root `package.json`, plus `@react-three/tsl`).
3. **shadcn stays inside this bench** for now (`examples/lab/hzd-r3f/ui/`). If it goes well, every lab converts, and `ui/` moves to `examples/lab/ui/`.
4. **`@clouds/react` procedural support waits.** This work only gets the bench into React.
5. **`hzd-r3f` merges into `main` after the cut-over**, not before.
