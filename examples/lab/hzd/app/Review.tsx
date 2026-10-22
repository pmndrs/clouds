// The review section: one switch per default an agent chose (work/STATUS.md A1-A9, B1; SH1a, SH1b; FX1), old against new, so the owner can flip them
// on the live sky. Every switch sets the same setting the tune panel (T) has; the panel's group is named in each tip.
import * as React from 'react';
import { Button } from '../ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/components/toggle-group';
import { Tip } from '../ui/components/tooltip';
import { useBench, settingsChanged } from '../bench/store';
import type { SourceId } from '../tune';
import { Note, Row, Section, SliderRow } from './controls';

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
  { id: 'SH1b', title: 'sky history filter', src: 'sky', key: 'historyFilter', options: [['old: bilinear', 'bilinear'], ['new: Catmull-Rom', 'catmull']],
    tip: 'How the frame-to-frame blend resamples the previous frame. Old: bilinear, which softens the clouds a little more every frame they move. New: Catmull-Rom (clamped so it does not ring), which keeps the cloud detail. Best seen in time-lapse (button below). Tune panel: "Ray march" (sky.historyFilter).' },
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
