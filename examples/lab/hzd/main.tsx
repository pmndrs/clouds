// HZD bench: the procedural Horizon Zero Dawn-style sky (the 'hzd' shaper: GPU Pro 7's density chain on our HZD noise set and the five-field
// NDF; packages/runtime/src/procedural/) in one full-window view, with every option in the sidebar, a tuning panel for its settings (tune.ts)
// and reference shots from Guerrilla's papers and the owner's photos beside it (refs.ts). React + R3F v10 (work/specs/hzd-react.md):
//   Render: an R3F <Canvas> hosts the compare page's "ours" pane forced to { model: 'procedural', shaper: 'hzd' } (../compare/panes/ours.ts),
//   which sets up and drives the Canvas's renderer, scene and camera (sky/SkyHost.tsx). Controls in React with shadcn components (ui/).
//   Views: the compare bookmarks (ground, horizon, sunset, dusk, afterglow, above) plus gp7 (ground, pitch 25: GPU Pro 7 Fig 4.13-4.16's framing)
//   and high (4300 m, pitch -6), the H-reports' views. Drag to look (fly: WASD QE, wheel = speed; orbit: wheel = distance).
//   Reference: a picker of the papers' frames and the photos, side by side or picture in picture (not an overlay: they are not pixel-matched),
//   hold F for the reference alone, R cycles the mode, , and . step through the list. The images come from the local research folder through
//   the dev server (refs-plugin.ts), never from the repo. A reference can carry an approximate starting view (sun, camera, coverage).
//   T: the tuning panel. M: the weather-map painter (paint/). H: hide the UI. ?: help. [ ] { }: sun elevation by 0.1 / 1 degree.
// The URL follows the sidebar and the panel, so a copied link reopens the same view and sky (bench/url.ts):
//   ?view=<name> ?sunel= ?sunaz= ?lookaz= ?pitch= ?pos=x,y,z ?fov= ?coverage= ?exposure= ?motion= ?ref=<id> ?refmode=side|pip ?pip=s|m|l ?corner=bl|br
//   ?refpage=1 (whole page instead of the figure) ?refview=0 (picking a reference keeps the view) ?quality=ultra|high|... ?clean=1 (no UI, captures)
//   settings: hz_<key> (the shaper), hzn_<key> (the NDF), proc_<key> (march and light), c_<key> (renderer), sky_<key> (sky layer), cirrus_<key>;
//   arrays as comma lists, switches as 1 / 0. The same flags as the compare page.
// Captures: bookmarks are view names or ref:<id>, with @ variants: @sun:el:az @cov:c @exp:e @ref:<id> @mode:off|side|pip, e.g. "gp7@ref:gp7-f4.16@mode:side".
// Console: window.__tune (the tuning panel: snapshot, changes, set, apply), window.__paint (the painter's store and engine).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installCloudsHarness } from '../harness/clouds-contract';
import { App } from './app/App';
import './ui/globals.css';

const harness = installCloudsHarness();
createRoot(document.getElementById('root')!).render(<StrictMode><App harness={harness} /></StrictMode>);
