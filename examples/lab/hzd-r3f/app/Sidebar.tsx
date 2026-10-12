// The sidebar: every option of the bench as a control (views, sun and time, clouds, reference, panel). The URL follows it.
import * as React from 'react';
import { HZD_REFS, HZD_REF_BY_ID } from '../../hzd/refs';
import { Button } from '../ui/components/button';
import { Checkbox } from '../ui/components/checkbox';
import { Label } from '../ui/components/misc';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/components/select';
import { ToggleGroup, ToggleGroupItem } from '../ui/components/toggle-group';
import { Tip } from '../ui/components/tooltip';
import { MOTIONS, QUALITIES, REF_MODES, VIEWS, VIEW_NAMES, solar, type RefMode } from '../bench/views';
import { applyRefViewNow, backToView, bench, goToView, setRef, setRefState, setUiHidden, settingsChanged, stepRef, useBench, viewChanged } from '../bench/store';
import { Note, Row, Section, SunControl, ViewSlider, SliderRow } from './controls';

const REF_IDS = HZD_REFS.map(r => r.id);
const REF_GROUPS = [...new Set(HZD_REFS.map(r => r.group))];
const NONE = '__none';

export function Sidebar() {
  return (
    <aside className="pointer-events-auto fixed top-2 right-2 z-[6] grid max-h-[calc(100vh-16px)] w-[min(250px,calc(100vw-16px))] grid-cols-[minmax(0,1fr)] content-start gap-1.5 overflow-x-hidden overflow-y-auto rounded-sm bg-black/70 p-2">
      <ViewsSection />
      <SunSection />
      <CloudsSection />
      <ReferenceSection />
      <PanelSection />
    </aside>
  );
}

function ViewsSection() {
  const viewName = useBench(s => s.viewName);
  const rig = useBench(s => s.rig);
  useBench(s => s.viewTick);
  return (
    <Section title="Views">
      <ToggleGroup type="single" value={viewName} onValueChange={v => v && goToView(v)}>
        {VIEW_NAMES.map(n => <Tip key={n} text={VIEWS[n].about}><ToggleGroupItem value={n}>{n}</ToggleGroupItem></Tip>)}
      </ToggleGroup>
      <Row>
        <Tip text="drag to look; fly: WASD QE to move, wheel = speed; orbit: around a point ahead, wheel = distance">
          <Button onClick={() => { if (rig) { rig.mode = rig.mode === 'fly' ? 'orbit' : 'fly'; viewChanged(); } }}>camera: {rig?.mode ?? 'fly'}</Button>
        </Tip>
        <Tip text="the view's own camera (after flying or orbiting)"><Button onClick={backToView}>back to the view</Button></Tip>
      </Row>
      <ViewSlider name="fov" tip="vertical field of view, degrees" min={20} max={100} step={1} get={v => v.fov} set={(v, x) => { v.fov = x; }} />
      <ViewSlider name="pitch" tip="camera pitch, degrees (up positive)" min={-89} max={89} step={0.5} get={v => v.pitch} set={(v, x) => { v.pitch = x; }} />
      <ViewSlider name="altitude" tip="camera altitude, metres (the layer is 1.5-5 km by default)" min={0.5} max={12000} step={0.5} get={v => v.position[1]} set={(v, x) => { v.position[1] = x; }} fmt={v => `${Math.round(v)}`} />
    </Section>
  );
}

function SunSection() {
  const rt = useBench(s => s.rt);
  useBench(s => s.settingsTick);
  const [hours, setHours] = React.useState(15);
  const speed = String(rt?.sources.c.animSpeed ?? 1);
  const motions: [string, string][] = MOTIONS.map(([n, v]) => [String(v), `motion: ${n}`]);
  if (!motions.some(([v]) => v === speed)) motions.push([speed, `motion: ×${speed}`]);
  return (
    <Section title="Sun and time">
      <SunControl />
      <ViewSlider name="sun az" tip="sun azimuth, degrees from north (90 = east)" min={0} max={360} step={1} get={v => v.sunAz} set={(v, x) => { v.sunAz = x; }} fmt={v => `${Math.round(v)}°`} />
      <SliderRow name="time" tip="time of day: sets the sun elevation and azimuth from a simple solar model (30° N, late spring); the two sliders above stay free"
        min={4.5} max={19.5} step={0.05} value={hours} fmt={v => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`}
        onChange={h => { setHours(h); const s = solar(h), view = bench.getState().view; view.sunEl = Math.round(s.el * 10) / 10; view.sunAz = Math.round(s.az); viewChanged(); }} />
      <Tip text="cloud motion: the renderer's animSpeed (frozen = the H-report captures' c_animSpeed=0)" side="left">
        <div>
          <Select value={speed} onValueChange={v => { if (rt) { rt.sources.c.animSpeed = Number(v); settingsChanged({ refreshTuner: true }); } }} disabled={!rt}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{motions.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Tip>
    </Section>
  );
}

function CloudsSection() {
  const painter = useBench(s => s.painter);
  return (
    <Section title="Clouds and exposure">
      <ViewSlider name="coverage" tip="the common coverage control: drives the HZD coverage bias (0.5 = the NDF as generated, ±0.5)" min={0} max={1} step={0.01} get={v => v.coverage} set={(v, x) => { v.coverage = x; }} />
      <ViewSlider name="exposure" tip="exposure multiplier on our calibrated ACES exposure" min={0.25} max={4} step={0.05} get={v => v.exposure} set={(v, x) => { v.exposure = x; }} />
      {painter && (
        <Row>
          <Tip text="the weather-map painter: paint coverage, cloud type and heights in a dock beside the sky, load the example maps, save PNGs">
            <Button onClick={() => painter.toggle()}>paint the weather map (M)</Button>
          </Tip>
        </Row>
      )}
    </Section>
  );
}

const MODE_LABEL: Record<RefMode, [string, string]> = {
  off: ['off', 'the render only'], side: ['side by side', 'the reference on the right half'], pip: ['picture in picture', 'the reference in a corner over the render'],
};

function ReferenceSection() {
  const ref = useBench(s => s.ref);
  const r = HZD_REF_BY_ID.get(ref.id);
  const info = !r ? 'Papers\' frames and the owner\'s photos (local files, served by the dev server only).'
    : `${r.source}${r.view ? ` · approximate starting view: ${r.view.from}${r.view.sunEl !== undefined ? `, sun ${r.view.sunEl}°` : ''}${r.view.pitch !== undefined ? `, pitch ${r.view.pitch}°` : ''}${r.view.coverage !== undefined ? `, coverage ${r.view.coverage}` : ''}` : ' · no starting view (a diagram or a map)'}`;
  return (
    <Section title="Reference">
      <Tip text="a reference shot shown beside the render (, and . step through the list)" side="left">
        <div>
          <Select value={ref.id || NONE} onValueChange={v => setRef(v === NONE ? '' : v, true)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-[60vh]">
              <SelectItem value={NONE}>reference: none</SelectItem>
              {REF_GROUPS.map(g => (
                <SelectGroup key={g}>
                  <SelectLabel>{g}</SelectLabel>
                  {HZD_REFS.filter(x => x.group === g).map(x => <SelectItem key={x.id} value={x.id}>{`${x.source.replace(/^owner photo: .*\//, '')} · ${x.title}`}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Tip>
      <Row>
        <Tip text="previous reference (,)"><Button onClick={() => stepRef(-1, REF_IDS)}>‹</Button></Tip>
        <Tip text="next reference (.)"><Button onClick={() => stepRef(1, REF_IDS)}>›</Button></Tip>
        <ToggleGroup type="single" value={ref.mode} onValueChange={v => v && setRefState({ mode: v as RefMode })}>
          {REF_MODES.map(m => <Tip key={m} text={MODE_LABEL[m][1]}><ToggleGroupItem value={m}>{MODE_LABEL[m][0]}</ToggleGroupItem></Tip>)}
        </ToggleGroup>
      </Row>
      {ref.mode === 'pip' && (
        <Row className="flex-nowrap">
          <Select value={ref.pip} onValueChange={v => setRefState({ pip: v as 's' | 'm' | 'l' })}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{(['s', 'm', 'l'] as const).map(p => <SelectItem key={p} value={p}>{`pip: ${{ s: 'small', m: 'medium', l: 'large' }[p]}`}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={ref.corner} onValueChange={v => setRefState({ corner: v as 'bl' | 'br' })}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="bl">corner: bottom left</SelectItem><SelectItem value="br">corner: bottom right</SelectItem></SelectContent>
          </Select>
        </Row>
      )}
      {r?.crop && (
        <Select value={ref.page ? '1' : '0'} onValueChange={v => setRefState({ page: v === '1' })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="0">show: the figure</SelectItem><SelectItem value="1">show: the whole page</SelectItem></SelectContent>
        </Select>
      )}
      <Tip text="picking a reference also sets its approximate starting view (sun, camera, coverage)" side="left">
        <Label><Checkbox checked={ref.follows} onCheckedChange={c => setRefState({ follows: c === true })} />picking a reference sets its view</Label>
      </Tip>
      <Row><Tip text="the reference's approximate starting view (sun, camera, coverage)"><Button disabled={!r?.view} onClick={applyRefViewNow}>apply its view</Button></Tip></Row>
      <Note>{info}</Note>
    </Section>
  );
}

function PanelSection() {
  const rt = useBench(s => s.rt);
  const quality = useBench(s => s.quality);
  return (
    <Section title="Panel">
      <Row className="flex-nowrap">
        <Tip text="every setting of the HZD sky, grouped, with presets"><Button disabled={!rt} onClick={() => rt?.tuner.toggle()}>tune (T)</Button></Tip>
        <Tip text="render quality (reloads the page)" side="left">
          <div className="min-w-0 flex-1">
            <Select value={quality} onValueChange={v => { const q = new URLSearchParams(location.search); if (v === 'ultra') q.delete('quality'); else q.set('quality', v); location.search = q.toString(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{QUALITIES.map(q => <SelectItem key={q} value={q}>{`quality: ${q}`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </Tip>
      </Row>
      <Row>
        <Tip text="hide the sidebar and the readout"><Button onClick={() => setUiHidden(true)}>hide UI (H)</Button></Tip>
        <Tip text="keys and notes"><Button onClick={() => bench.setState(s => ({ helpOpen: !s.helpOpen }))}>help (?)</Button></Tip>
      </Row>
    </Section>
  );
}
