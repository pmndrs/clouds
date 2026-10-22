// The review section: one switch per default an agent chose (work/STATUS.md A1-A9, B1), old against new, so the owner can flip them
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
  { id: 'B1', title: 'cumulus height', src: 'hzd', key: 'tableTypeCumulus', options: [['0.4 standard', 0.4], ['0.6', 0.6], ['0.75 towering', 0.75]],
    tip: 'Where cumulus sits on the profile table: 0.4 is Nubis Evolved\'s value, higher gives taller towers. Tune panel: "Cloud types: profile tables".' },
  { id: 'LH1', title: 'shade hue (Nubis)', src: 'c', key: 'ambientSaturation', options: [['old: sky blue (1)', 1], ['new: neutral (0.15)', 0.15]], slider: { min: 0, max: 1, step: 0.05 },
    tip: 'The colour of the sky light a cloud body is lit by where the sun does not reach (the shaded bodies and undersides). Old: the sky\'s own saturated blue. New: mostly grey, a slightly cool grey like the photos\' shade. Only matters under Nubis lighting (A5). Tune panel: "Light: renderer settings" (ambientSaturation; diffuseSun adds warm diffused sunlight to the shade).' },
];

export function ReviewSection() {
  const rt = useBench(s => s.rt);
  useBench(s => s.settingsTick);
  const [open, setOpen] = React.useState(true);
  if (!rt) return null;
  const S = rt.sources;
  const put = (src: SourceId, key: string, v: unknown) => { S[src][key] = v; settingsChanged({ refreshTuner: true }); };
  return (
    <Section title="Review: old vs new (STATUS A1-A9, B1, LH1)">
      <Row>
        <Button onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'show'} the switches</Button>
        <Tip text="time-lapse motion, to see A6"><Button onClick={() => { S.c.animSpeed = 20; settingsChanged({ refreshTuner: true }); }}>motion: time-lapse</Button></Tip>
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
