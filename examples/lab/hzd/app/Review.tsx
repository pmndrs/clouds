// The review section: one switch per default an agent chose (work/STATUS.md A1-A9, B1; SH1a, SH1b; FX1), old against new, so the owner can flip them
// on the live sky. Every switch sets the same setting the tune panel (T) has; the panel's group is named in each tip.
import * as React from 'react';
import { Button } from '../ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/components/toggle-group';
import { Tip } from '../ui/components/tooltip';
import { useBench, settingsChanged } from '../bench/store';
import type { SourceId } from '../tune';
import { Note, Row, Section, SliderRow } from './controls';
import { LAYOUT_PRESETS } from '../bench/views';

interface Item {
  id: string;
  title: string;
  tip: string;
  src: SourceId;
  key: string;
  options: [string, unknown][];
  /** What has to be on to see it (a setting and the value that shows it). */
  show?: { label: string; src: SourceId; key: string; on: unknown; off: unknown };
  slider?: { min: number; max: number; step: number };
  /** P2.3a: a preset over several settings (`<source>.<key>` -> value). Options are then 'old' (every key back to its starting value) and
   *  'new' (the bundle); `src`/`key` are unused. */
  bundle?: Record<string, unknown>;
}

const ITEMS: Item[] = [
  { id: 'A1', title: 'detail noise', src: 'hzd', key: 'noiseSet', options: [['old: HZD', 'hzd'], ['new: Nubis Cubed', 'nubis3']],
    tip: 'The noise that erodes the cloud edges. Old: HZD Worley (the "sprinkles"). New: Nubis Cubed Alligator. Tune panel: "Erosion noise: Nubis Cubed".' },
  { id: 'A2', title: 'weather map', src: 'ndf', key: 'recipe', options: [['old: even (H6)', 'h6'], ['new: clusters (N17)', 'n17']],
    tip: 'How the map spreads clouds. Old: an even field. New: Nubis 2017 clusters with clear lanes. Best seen from the "high" view. Tune panel: "Weather map".' },
  { id: 'A3', title: 'density (extinction)', src: 'hzd', key: 'extinction', options: [['old: 0.5', 0.5], ['new: 0.8', 0.8]], slider: { min: 0.05, max: 2, step: 0.01 },
    tip: 'How quickly light is absorbed inside the cloud. Higher = denser, darker cores and more visible surface texture; lower = softer, more see-through. Tune panel: "Shape and detail".' },
  { id: 'A4', title: 'per-area cloud bases', src: 'ndf', key: 'bottomTypeRange', options: [['old: off', 0], ['new: on', 1.5]],
    tip: 'Whether the base shape varies over the map: crisp flat bases under cumulus, soft ragged bases under stratus. Look at the cloud undersides from the ground. Tune panel: "Weather map" (bottomTypeRange).' },
  { id: 'A5', title: 'lighting', src: 'proc', key: 'lightingModel', options: [['old: octave (Takram)', 'octave'], ['new: Nubis', 'nubis']],
    tip: 'The lighting model. Old: Takram/Frostbite octaves. New: Nubis Evolved, from the exact profile. Tune panel: "Light: the procedural model" (lightingModel, lightProfile).' },
  { id: 'A6', title: 'time-lapse blend', src: 'sky', key: 'temporalCloudMotion', options: [['old: camera only', false], ['new: follows wind', true]],
    tip: 'Whether the frame-to-frame blend follows the clouds. Only visible while clouds move fast: set motion to time-lapse (button below). Old smears, new stays crisp but slightly soft. Tune panel: "Wind and motion".' },
  { id: 'A7', title: 'mid-level clouds', src: 'hzd', key: 'midLayerMode', options: [['old: volume', 'volume'], ['new: hybrid', 'hybrid'], ['layer only', 'layer']],
    show: { label: 'altocumulus on', src: 'hzd', key: 'midForm', on: 'altocumulus', off: 'off' },
    tip: 'Altocumulus/altostratus at distance. Old: a volume that shows a clip line far away. New: the volume up close fading into a 2.5D layer. Needs the mid clouds on (switch below); best from the "horizon" view. Tune panel: "Mid-level layer and low deck".' },
  { id: 'A8', title: 'painting', src: 'ndf', key: 'paintBlend', options: [['old: replace', 'replace'], ['new: influence', 'influence']],
    tip: 'How a painted map combines with the generated one. Old: replaces it. New: blends by the painted influence mask, so you can paint just one area. Only matters once you paint (M). Tune panel: "Weather map".' },
  { id: 'A9', title: 'storm source', src: 'hzd', key: 'stormSource', options: [['old: placed cell', 'cell'], ['new: painted area', 'map']],
    show: { label: 'storm on', src: 'hzd', key: 'stormStrength', on: 1, off: 0 },
    tip: 'Where a storm comes from. Old (still the default): F1\'s placed cell with the mushroom anvil. New: the map\'s storm area with the downwind anvil plate. Needs the storm on (switch below); best from the "storm" view. Tune panel: "Storms and anvils".' },
  { id: 'CI1', title: 'cirrus from the map', src: 'cirrus', key: 'source', options: [['old: global', 'global'], ['new: weather map (default)', 'map']],
    show: { label: 'cirrus on', src: 'cirrus', key: 'enabled', on: true, off: false },
    tip: 'Where the high cirrus gets its coverage and type. Old: one global setting plus a 50 km noise. New: the weather map\'s own thin-cloud fields (NE22) set coverage and type per area, around the same global mean (so weather states still work). Needs the cirrus on (switch below; it is off in the bench by default); look up from the "ground", "gp7" or "horizon" view. Tune panel: "High cirrus layer" (cirrus.source) and "Weather map" (ndf.cirrusCells).' },
  { id: 'SH1a', title: 'ground shadow steadiness', src: 'shadow', key: 'advect', options: [['old: rows as refreshed', false], ['new: slides with the wind', true]],
    tip: 'How the cloud shadow on the ground behaves while clouds move fast. Old: the map refreshes a slice per frame, each at its own moment, so the shadow steps and tears. New: a sweep is built from one moment, eased in when it lands, and the shadow slides with the wind in between. Set motion to time-lapse (button below) and look at the ground (the "ground" view). Tune panel: "Light: renderer settings" (shadow.advect*).' },
  { id: 'FX1a', title: 'ground shadow crossfade', src: 'shadow', key: 'advectContinuous', options: [['old: ease, then wait', false], ['new: continuous', true]],
    tip: 'How a new shadow snapshot replaces the old one (with SH1a on). Old (SH1a): a sweep lands, the map eases to it over 6 frames, then sits still until the next sweep, so shape changes still come in quick steps. New: the next sweep is built while the previous one is still being crossfaded, and the crossfade lasts the whole refresh period (blend frames = refresh frames, longer while the wind is slow), so the shadow always morphs slowly and never lands visibly. +8 MB. Set motion to time-lapse and look at the ground ("ground" view). Tune panel: "Light: renderer settings" (shadow.advectContinuous, advectRefreshFrames, advectBlendFrames).' },
  { id: 'FX1b', title: 'shadow refresh frames', src: 'shadow', key: 'advectRefreshFrames', options: [['12 (default)', 12], ['24', 24], ['48', 48]], slider: { min: 1, max: 96, step: 1 },
    tip: 'Frames one shadow sweep takes (one fresh snapshot of the clouds per this many frames). More = cheaper and a slower morph, but the snapshot is older when it lands. Keep the blend frames (FX1c) equal to it for a continuous crossfade. Tune panel: "Light: renderer settings" (shadow.advectRefreshFrames).' },
  { id: 'FX1c', title: 'shadow blend frames', src: 'shadow', key: 'advectBlendFrames', options: [['old: 6', 6], ['new: 12 (= refresh)', 12], ['24', 24]], slider: { min: 0, max: 96, step: 1 },
    tip: 'Frames over which the shadow crossfades from the old snapshot to a new one (0 = switch at once). With the continuous crossfade (FX1a) the crossfade is never shorter than the time between sweeps; set it equal to the refresh frames (FX1b), or longer for an even softer morph that lags a little. Tune panel: "Light: renderer settings" (shadow.advectBlendFrames).' },
  { id: 'SH1b', title: 'sky history filter', src: 'sky', key: 'historyFilter', options: [['old: bilinear', 'bilinear'], ['SH1b: Catmull-Rom', 'catmull'], ['FX1: adaptive (default)', 'adaptive']],
    tip: 'How the frame-to-frame blend resamples the previous frame. Bilinear softens the clouds a little more every frame they move, but that also averaged away the march\'s per-pixel noise. Catmull-Rom (SH1b, clamped so it does not ring) keeps the detail, and at normal motion also the noise: the lit and shaded surfaces sparkle (FX1 measured twice the specks). Adaptive (FX1, default): bilinear while the clouds move slowly (cloud drift below sky.historySharpWindFrom 0.15 m per frame), Catmull-Rom in a time-lapse (from historySharpWindFull 0.4 m) or a fast camera turn (historySharpFrom/Full, layer px). Compare at motion x1 for the sparkle and in time-lapse (button below) for the detail. Tune panel: "Ray march" (sky.historyFilter, historySharpWind*, historySharp*).' },
  { id: 'ST2a', title: 'anvil plate', src: 'hzd', key: 'stormAnvilShape', options: [['old: lumpy taps', 'taps'], ['new: smooth', 'smooth']],
    show: { label: 'storm on', src: 'hzd', key: 'stormStrength', on: 1, off: 0 },
    tip: 'The map storm\'s anvil shape and cirrus. Old: STORM1\'s plate (a union of 8 shifted copies of the storm: lumpy and angular, torn cirrus streaks). New (default): a smooth blurred dilation with a thinning rim, and the cirrus as a smooth fibrous sheet downwind. Costs about 2-5 ms more at ultra with a storm in view. Needs the storm on (switch below) and the map source (A9); best from the "storm" view. Tune panel: "Storms and anvils".' },
  { id: 'ST2', title: 'storm rotation', src: 'hzd', key: 'stormRotation', options: [['off (default)', 0], ['1 deg/s', 1], ['10 deg/s', 10]],
    show: { label: 'storm on', src: 'hzd', key: 'stormStrength', on: 1, off: 0 },
    tip: 'NE22\'s nested rotating rings: the storm\'s detail noise turns about the storm centre in six rings, faster in the middle. Off by default: it costs about 3 ms and the sky\'s temporal blend smears the moving detail (the "pixel soup" NE fixes with motion vectors), so even 1 deg/s looks soft. Needs the storm on (switch below); best from the "storm" view. Tune panel: "Storms and anvils".' },
  { id: 'B1', title: 'cumulus height', src: 'hzd', key: 'tableTypeCumulus', options: [['0.4 standard', 0.4], ['0.6', 0.6], ['0.75 towering', 0.75]],
    tip: 'Where cumulus sits on the profile table: 0.4 is Nubis Evolved\'s value, higher gives taller towers. Tune panel: "Cloud types: profile tables".' },
  { id: 'LH1', title: 'shade hue (Nubis)', src: 'c', key: 'ambientSaturation', options: [['old: sky blue (1)', 1], ['new: neutral (0.15)', 0.15]], slider: { min: 0, max: 1, step: 0.05 },
    tip: 'The colour of the sky light a cloud body is lit by where the sun does not reach (the shaded bodies and undersides). Old: the sky\'s own saturated blue. New: mostly grey, a slightly cool grey like the photos\' shade. Only matters under Nubis lighting (A5). Tune panel: "Light: renderer settings" (ambientSaturation; diffuseSun adds warm diffused sunlight to the shade).' },
  { id: 'U2', title: 'render level (upscaler)', src: 'c', key: 'renderLevel', options: [['cinematic (native, old)', 'cinematic'], ['desktop: 1/2 + upscaler', 'desktop'], ['laptop: 1/4 + upscaler', 'laptop']],
    tip: 'U2: the size the clouds render at. Cinematic: the sky layer at its own resolution (ultra 0.75) as before, no upscaler (the default; pixel for pixel the old path). Desktop: the clouds at half the output resolution, brought to full size by the upscaler (@pmndrs/upscaler, temporal path); laptop: a quarter. The ground and scene stay full size and still hide the clouds behind them. The HUD shows the GPU time (sky layer + upscale). Look at lit ridges (should stay crisp) and in time-lapse for smear. Known (U2, S2 reports): S2 made desktop as crisp as cinematic on lit ridges (S2b) and took most of the hatch out (S2a); a fainter hatch is left on the foamy tops seen from above; laptop 1/4 is still soft (try levelScaleLaptop 0.33); on a loaded machine the switch to desktop/laptop sometimes lost the GPU device in its first frames (reload). Tune panel: "Render level (upscaler)" (levelScaleDesktop / levelScaleLaptop, upscalePath, upscaleSharpness).' },
  { id: 'S2a', title: 'surface hatch (cloud entry)', src: 'proc', key: 'surfaceRefine', options: [['old: off', 0], ['new: 3 halvings (default)', 3], ['5', 5]], slider: { min: 0, max: 8, step: 1 },
    tip: 'S2: the fine diagonal hatch on hard lit faces (S1). The march takes one sample per step, and where it enters a cloud the per-pixel jitter decided how deep under the surface that first sample landed (anywhere in a 25 m+ step), so a hard lit face took the colour of a point up to a step deep, in the jitter\'s diagonal pattern. New: the last empty step is halved 3 times and the march starts at the surface found, then grows its step from there. Lit ridges get crisper and the hatch goes; costs a few full samples per cloud entry. Best seen with less foam (style early / real, or hz_n3Strength 0.4) at 1:1 on gp7. Tune panel: "Ray march" (proc.surfaceRefine).' },
  { id: 'S2b', title: 'desktop/laptop sharpness (sub-pixel box)', src: 'c', key: 'levelSubPixelSpan', options: [['old: 2-pixel box', -1], ['new: 1-pixel box (default)', 1]], slider: { min: -1, max: 2, step: 0.25 },
    tip: 'S2: at the desktop and laptop levels (U2) each cloud pixel is traced at an offset that changes every 16 frames, and the history averages those offsets. Old: offsets over 2 x 2 layer pixels (4 x 4 output pixels at desktop, 8 x 8 at laptop), so lit ridges went soft and the finest grain was gone before the upscaler saw them (the upscaler gets no jitter, it cannot bring detail back). New: a one-pixel box, as fine as the layer can resolve. Cinematic is not affected (sky.subPixelSpan). Switch U2 to desktop and compare lit ridges at 1:1 on gp7. Tune panel: "Render level (upscaler)" (c.levelSubPixelSpan).' },
  { id: 'P12', title: 'lighting: fitted (new)', src: 'proc', key: 'lightingModel', options: [['old: octave (default)', 'octave'], ['new: fitted', 'fit']],
    tip: 'P1.2d: the small lighting model fitted to the path-traced references (P1.2a-c, until now only on the single test clouds), on this sky. Each sample gets the sun through its own optical depth (forward phase), a multiple-scattering term that fades with depth, and the sky above through the cloud plus the ground light; nothing else (no profile, micro-shadow, powder or edge darkening). The fit constants are the voxel tuning, not retuned for this sky. Old: the octave model (as A5 old). URL: proc_lightingModel=fit. Tune panel: "Light: the procedural model" (lightingModel); constants in the cloud settings (fit*).' },
  { id: 'P27', title: 'fitted lighting: droplet forward peak (silver lining)', src: 'c', key: 'fitMiePhase', options: [['old: one HG lobe, g 0.8 (default)', 0], ['new: droplet (Mie) phase', 1]],
    show: { label: 'fitted lighting on', src: 'proc', key: 'lightingModel', on: 'fit', off: 'octave' },
    tip: 'P1.7a: the direct sunlight term of the fitted lighting (P12) scatters with the phase of real cloud droplets (Jendersie & d\'Eon 2023 HG + Draine fit, droplet diameter 10 um, constants from the paper, not tuned) instead of one Henyey-Greenstein lobe at g 0.8. Real droplets send a sharp spike of light within a few degrees of the sun, which is what makes thin edges glow when you look toward the sun (silver lining); they also send much less light sideways. Old: the fitted single lobe (no rim). Look toward a low sun past a cloud edge. Needs P12 on (switch below). The ms and sky terms are unchanged and not refitted. URL: c_fitMiePhase=1 (card page: s.fitMiePhase=1). Tune panel: cloud settings (fitMiePhase, dropletDiameter).' },
  { id: 'P25', title: 'edge character: by height and direction', src: 'hzd', key: 'edgeCharacter', options: [['old: off (default)', 0], ['new: on', 1]],
    tip: 'P2.5a (first prototype, the owner\'s theory): the edge sharpness depends on where on the cloud and which way it faces, from the shape (density), not the lighting. Tops crisp with small defined lobes (billowy noise, less erosion, a hard edge); bases and lower flanks soft (wispy noise, more erosion, a translucent edge); the side the cloud moves into crisp, the wisps trailing off the other side (P25b). Old: every edge eroded alike. Best with the fitted lighting (P12) at 1:1 on gp7. URL: hz_edgeCharacter=1. Tune panel: "Edge character (P2.5a)".' },
  { id: 'P25b', title: 'edge character: which side is crisp', src: 'hzd', key: 'edgeLead', options: [['+1: leading side crisp (default)', 1], ['-1: flipped', -1], ['0: height only', 0]],
    show: { label: 'edge character on', src: 'hzd', key: 'edgeCharacter', on: 1, off: 0 },
    tip: 'P2.5a: which side of a body is crisp along the wind. +1: the side moving into new air is crisp, wisps trail off the back. -1: the other way round. 0: no direction, crispness by height only. Needs P25 on (switch below). URL: hz_edgeLead=-1. Tune panel: "Edge character (P2.5a)" (edgeLead, edgeProbe, edgeLeadRange).' },
  { id: 'P25c', title: 'edge lobes', src: 'hzd', key: 'edgeLobes', options: [['off: 0', 0], ['on: 0.6 (default)', 0.6]],
    show: { label: 'edge character on', src: 'hzd', key: 'edgeCharacter', on: 1, off: 0 },
    tip: 'P2.5b: with edge character on, rounded lobes of the middle size (the lobe rung, between the body and the fine grain) where the edge is crisp (tops, leading side), none where it is soft. Needs P25 on (switch below). URL: hz_edgeLobes=0. Tune panel: "Edge character (P2.5a)" (edgeLobes; lobeTile in the erosion group sets their size).' },
  { id: 'P25d', title: 'edge character: what counts as the top', src: 'hzd', key: 'edgeTopMode', options: [['new: the surface faces up (default)', 1], ['old: height in the column', 0]],
    show: { label: 'edge character on', src: 'hzd', key: 'edgeCharacter', on: 1, off: 0 },
    tip: 'P2.5d: the crisp "top" is the upward-facing side of every bulge and turret at any height (the coarse density falls upward: read again edgeUpStep 80 m higher), not the height in the column (old: from the ground nearly every visible surface sat below the height threshold, so c was 0 and only the soft branch acted, P2.5c). Needs P25 on (switch below). See it with the Debug view "edge crispness c at the first hit". URL: hz_edgeTopMode=0. Tune panel: "Edge character (P2.5a)" (edgeTopMode, edgeUpStep, edgeUpRange).' },
  { id: 'P25e', title: 'edge character: one factor at a time (debug)', src: 'hzd', key: 'edgeFactors', options: [['all (default)', 31], ['B/C: hardness only', 4], ['D: noise kind only', 1], ['E: lobes only', 8]],
    show: { label: 'edge character on', src: 'hzd', key: 'edgeCharacter', on: 1, off: 0 },
    tip: 'P2.5e (debug): which part of the crisp branch acts; every other part, and the soft branch, stays exactly as with the feature off. Hardness = the cut-and-steepen by c (edgeCrispCut, edgeCrispGain; C used cut 0.25, gain 6), noise kind = billowy by c, lobes = the lobe rung at edgeLobes x c. Bits: 1 noise, 2 crisp erosion strength, 4 hardness, 8 lobes, 16 soft branch. Needs P25 on (switch below). URL: hz_edgeFactors=4. Tune panel: "Edge character (P2.5a)" (edgeFactors).' },
  { id: 'P25f', title: 'edge character: hardness as pure gain (debug)', src: 'hzd', key: 'edgeHardMode', options: [['cut and gain (default)', 0], ['pure gain, no cut', 1]],
    show: { label: 'edge character on', src: 'hzd', key: 'edgeCharacter', on: 1, off: 0 },
    tip: 'P2.5f (debug): the crisp hardness without the cut, only a multiply: sat(d x lerp(1, edgeSteepGain, c)), so thin density reaches opaque sooner (the outer haze turns opaque too, the outline moves out). Test with P25e "hardness only" (edgeFactors 4). URL: hz_edgeHardMode=1&hz_edgeSteepGain=12. Tune panel: "Edge character (P2.5a)" (edgeHardMode, edgeSteepGain).' },
  { id: 'P25f2', title: 'edge character: pure-gain steepness', src: 'hzd', key: 'edgeSteepGain', options: [['4 (default)', 4], ['12', 12]], slider: { min: 1, max: 20, step: 0.5 },
    tip: 'P2.5f (debug): the gain at c = 1 for the pure-gain hardness (P25f on). URL: hz_edgeSteepGain=12.' },
  { id: 'P05', title: 'converged march (ground truth)', src: 'c', key: 'converged', options: [['off: normal frame (default)', 0], ['on: converged', 1]],
    tip: 'P0.5 (docs/AUDIT-2026-11.md): a slow reference of our own lighting and density with the sampling shortcuts removed, to judge the image problems (step size, jitter, the temporal blend, the 1/16 amortisation, the upscaler) against. Every pixel is traced every frame at full resolution with no history and no upscaler, the steps are divided by the step scale (P05b), light taps are recomputed at every step, and the samples (P05c) are averaged with a different jitter and sub-pixel offset each. The clouds stand still while it is on; it starts again when the view, the sun or a setting changes. Seconds per frame; the HUD shows the count. Not a path tracer: the light is the same model. URL: c_converged=1. Tune panel: "Converged march (P0.5)".' },
  { id: 'P05b', title: 'converged: step divisor', src: 'c', key: 'convergedStepScale', options: [['4 (default)', 4], ['8', 8]], slider: { min: 1, max: 16, step: 1 },
    tip: 'P0.5: the converged march divides every march step by this (the step budget follows). Doubling it should change the converged image very little; if it does, a step-size-dependent term is left (see work/reports/P0-5-converged-march.md). Needs P05 on.' },
  { id: 'P05c', title: 'converged: samples', src: 'c', key: 'convergedSamples', options: [['16 (default)', 16], ['32', 32]], slider: { min: 1, max: 128, step: 1 },
    tip: 'P0.5: frames the converged march averages (each with its own march jitter and sub-pixel offset). Needs P05 on.' },
  { id: 'P23', title: 'P23 sky layout: scattered (new)', src: 'ndf', key: 'footprint', options: [['old (default)', 'old'], ['new: scattered', 'new']], bundle: LAYOUT_PRESETS.scattered,
    tip: 'P2.3a: a layout preset from existing settings only (no shader or generator change), aimed at the owner\'s texas-afternoon photo: separate cumulus with clear sky between, sizes from puffs to large bodies, a few much taller. Weather map: Perlin-Worley islands (footprint 1, islandGain 1.6), less footprint (footLo/footHi -0.3/0.7), a more closed gate (gateLo/gateHi -0.15/0.05), cumulus types only (typeMin 0.75), full layer (maxHeight 1) with flat bases (heightVariation 0.04). Shaper: the top rises with the coverage (heightFromCoverage 0.85, heightCoverageRef 0.85), so big bodies tower and small puffs stay low. Known: the tall bodies come out as cones or mesas, not rounded turrets. Best from the "ground" and "gp7" views. URL: layout=scattered. Log: work/logs/P2-3a.md.' },
  { id: 'P24', title: 'P24 tall clouds: domed turrets (new)', src: 'hzd', key: 'topShape', options: [['old (default)', 0], ['new: domed turrets', 1]],
    tip: 'P2.3b: how a body\'s top follows its coverage (heightFromCoverage, which the P23 "scattered" layout turns up). Old: the top falls in a straight line to the body\'s edge, so tall bodies are cones. New: a dome (a quarter circle: steep near-vertical sides, flat on top) broken into rounded turrets: a cellular field of heads about 700 m across, each its own height (down to 55 %), meeting in notches; it moves with the weather map. Only lowers tops, never raises them. Flip it on top of P23 (layout=scattered); with the default layout heightFromCoverage is low and the change is small. URL: hz_topShape=1. Tune panel: "Cloud types and height profiles" (topShape, topDome, turretSize, turretDepth, turretAmount). Log: work/logs/P2-3b.md.' },
  { id: 'P26', title: 'P26 tall clouds: flank bulges (new)', src: 'hzd', key: 'flankBulge', options: [['old: off (default)', 0], ['new: flank bulges', 1]],
    tip: 'P2.6b: the sides of tall bodies get stacked rounded bulges. A low-frequency 3D billow noise (cells about 800 m) pushes the coverage (where the column ends and the body\'s threshold) up and down inside each body\'s footprint, more the higher above the base (none at the base, full at 2000 m), so the height where a column ends, and with it the body\'s side, moves in and out with height. Small low puffs and bases are left alone. Flip it on top of P23 (layout=scattered) and P24 (domed turrets). URL: hz_flankBulge=1. Tune panel: "Cloud types and height profiles" (flankBulge, flankAmount, flankSize, flankRise, flankThreshold). Log: work/logs/P2-6b.md.' },
  { id: 'PF1', title: 'empty-space skipping', src: 'hzd', key: 'emptySkip', options: [['old: off', 'off'], ['new: exact', 'exact'], ['free (faster, reaches further)', 'free']],
    tip: 'The ray march skips stretches of clear sky using a coarse grid of the weather map (largest coverage, lowest base and highest top per 500 m cell). Exact: the same image as off (checked pixel for pixel), fewer samples; it pays off on maps with clear lanes (about 10-20 % of the sky pass) and does nothing on a map that has some cloud coverage everywhere. Free: also does not charge the skipped strides to the step limit, so far rays reach further: distant cloud bands that the old march ran out of steps before now show (best seen from the "above" view on a sparse map). Tune panel: "Ray march" (emptySkip, emptySkipCoverage).' },
];

export function ReviewSection() {
  const rt = useBench(s => s.rt);
  useBench(s => s.settingsTick);
  const [open, setOpen] = React.useState(true);
  if (!rt) return null;
  const S = rt.sources;
  const put = (src: SourceId, key: string, v: unknown) => { S[src][key] = v; settingsChanged({ refreshTuner: true }); };
  return (
    <Section title="Review: old vs new (see work/STATUS.md)">
      <Row>
        <Button onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'show'} the switches</Button>
        <Tip text="time-lapse motion, to see A6, SH1a and SH1b"><Button onClick={() => { S.c.animSpeed = 20; settingsChanged({ refreshTuner: true }); }}>motion: time-lapse</Button></Tip>
      </Row>
      {open && ITEMS.map(it => {
        if (it.bundle) {
          // P2.3a: a several-setting preset. 'new' when every key holds the bundle's value, 'old' when every key is at its starting value.
          const entries = Object.entries(it.bundle).map(([sk, v]) => { const i = sk.indexOf('.'); return [sk.slice(0, i) as SourceId, sk.slice(i + 1), v, sk] as const; });
          const isNew = entries.every(([s, k, v]) => S[s]?.[k] === v);
          const isOld = entries.every(([s, k, , sk]) => S[s]?.[k] === rt.tuner.baseOf(sk));
          const setAll = (which: string) => { for (const [s, k, v, sk] of entries) if (k in S[s]) S[s][k] = which === 'new' ? v : rt.tuner.baseOf(sk); settingsChanged({ refreshTuner: true }); };
          const val = isNew ? '1' : isOld ? '0' : '';
          return (
            <div key={it.id} className="grid gap-1 border-t border-white/10 pt-1">
              <Tip text={it.tip} side="left"><div className="text-[11px] text-foreground"><b>{it.id}</b> {it.title} <span className="text-muted-foreground">ⓘ</span></div></Tip>
              <ToggleGroup type="single" value={val} onValueChange={v => v !== '' && setAll(it.options[Number(v)][1] as string)}>
                {it.options.map(([label], i) => <ToggleGroupItem key={i} value={String(i)}>{label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
          );
        }
        const cur = S[it.src]?.[it.key];
        if (cur === undefined) return null;
        const idx = it.options.findIndex(([, v]) => v === cur);
        return (
          <div key={it.id} className="grid gap-1 border-t border-white/10 pt-1">
            <Tip text={it.tip} side="left"><div className="text-[11px] text-foreground"><b>{it.id}</b> {it.title} <span className="text-muted-foreground">ⓘ</span></div></Tip>
            <ToggleGroup type="single" value={idx >= 0 ? String(idx) : ''} onValueChange={v => v !== '' && put(it.src, it.key, it.options[Number(v)][1])}>
              {it.options.map(([label], i) => <ToggleGroupItem key={i} value={String(i)}>{label}</ToggleGroupItem>)}
            </ToggleGroup>
            {it.slider && typeof cur === 'number' && (
              <SliderRow name="value" min={it.slider.min} max={it.slider.max} step={it.slider.step} value={cur} onChange={v => put(it.src, it.key, v)} />
            )}
            {it.show && S[it.show.src]?.[it.show.key] !== undefined && (
              <Row>
                <Button onClick={() => put(it.show!.src, it.show!.key, S[it.show!.src][it.show!.key] === it.show!.on ? it.show!.off : it.show!.on)}>
                  {S[it.show.src][it.show.key] === it.show.on ? `turn ${it.show.label.replace(/ on$/, '')} off` : `turn ${it.show.label}`}
                </Button>
              </Row>
            )}
          </div>
        );
      })}
      {open && <Note>Hover a name for what it does and which tune-panel group (T) has it with its related settings. Every switch also updates the URL.</Note>}
    </Section>
  );
}
