// The weather-map painter (M) as React components: a dock on the left whose head, source picker and map stay put while the controls under
// them scroll. Each section is its own component reading the painter store; the engine (engine.ts) does the work.
import * as React from 'react';
import { sharedBackend } from '@clouds/three';
import { ArrowDown, ArrowUp, Blend, Droplets, Eye, Hand, Paintbrush, RotateCcw, Sparkles, X } from 'lucide-react';
import { CHANNELS, type Channel } from './fields';
import { Button } from '../ui/components/button';
import { Checkbox } from '../ui/components/checkbox';
import { Input } from '../ui/components/input';
import { Kbd, Label } from '../ui/components/misc';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/components/select';
import { Slider } from '../ui/components/slider';
import { ToggleGroup, ToggleGroupItem } from '../ui/components/toggle-group';
import { Tip } from '../ui/components/tooltip';
import { cn } from '../ui/lib/utils';
import { bench, settingsChanged, useBench, viewChanged } from '../bench/store';
import { ABOUT, LABEL, RECIPES, TOOLS, type Tool } from './constants';
import { getEngine, type PaintEngine } from './engine';
import { MapView } from './MapView';
import { paint, saveUi, usePaint } from './store';

const TOOL_ICON: Record<Tool, React.ComponentType<{ className?: string }>> = {
  paint: Paintbrush, raise: ArrowUp, lower: ArrowDown, smooth: Droplets, smudge: Hand, noise: Sparkles, restore: RotateCcw, gradient: Blend,
};
const EngineContext = React.createContext<PaintEngine | null>(null);
const useEngine = () => React.useContext(EngineContext)!;

/** Mounted once the sky is up (and not in clean mode); renders nothing while closed. */
export function PainterDock() {
  const rt = useBench(s => s.rt);
  const open = usePaint(s => s.open);
  const width = usePaint(s => s.width);
  const engine = React.useMemo(() => (rt ? getEngine({
    proc: rt.proc, device: sharedBackend(rt.renderer).device, ndf: rt.sources.ndf, hzd: rt.sources.hzd, core: rt.core, view: bench.getState().view, renderer: rt.renderer,
    onViewChange: () => { rt.core.resetTemporal(); viewChanged(); },
    onSettingsChange: () => settingsChanged({ refreshTuner: true }),
  }) : null), [rt]);
  const hovering = React.useRef(false);
  const spaceHeld = React.useRef(false);

  // The map view recolours when what it shows changes.
  React.useEffect(() => paint.subscribe((s, p) => {
    if (engine && (s.display !== p.display || s.viewChannel !== p.viewChannel || s.contour !== p.contour)) engine.dirtyMap = true;
  }), [engine]);

  usePainterKeys(engine, hovering, spaceHeld);
  // For the console and scripts, as window.__tune: the store and the engine.
  React.useEffect(() => { if (engine) (window as unknown as { __paint: unknown }).__paint = { store: paint, engine }; }, [engine]);
  if (!engine || !open) return null;
  return (
    <EngineContext.Provider value={engine}>
      <div id="paint" className="fixed top-0 bottom-0 left-0 z-[8] flex flex-col border-r border-border bg-background text-xs" style={{ width }}
        onPointerEnter={() => { hovering.current = true; }} onPointerLeave={() => { hovering.current = false; spaceHeld.current = false; }}>
        <Grip />
        <div className="grid flex-none gap-1.5 border-b border-border px-2 pt-2 pb-1.5">
          <Head />
          <SourcePanel />
          <MapBox spaceHeld={spaceHeld} />
          <StatusLine />
        </div>
        <div className="grid min-h-0 flex-1 content-start gap-1.5 overflow-x-hidden overflow-y-auto p-2 [grid-template-columns:minmax(0,1fr)]">
          <ToolsPanel />
          <ChannelsPanel />
          <MapViewPanel />
          <SkyPanel />
          <FilesPanel />
        </div>
      </div>
    </EngineContext.Provider>
  );
}

function Sec({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-1.5 text-[10.5px] tracking-wider text-label uppercase">{children}</h3>;
}
function Row({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-1', className)}>{children}</div>;
}
function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-snug text-muted-foreground', className)}>{children}</p>;
}
function PSlider({ name, tip, min, max, step, value, onChange, fmt }: { name: string; tip: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <Tip text={tip} side="right">
      <label className="grid items-center gap-1" style={{ gridTemplateColumns: '70px 1fr 64px' }}>
        <span>{name}</span>
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={name} />
        <span className="text-right text-value tabular-nums">{fmt(value)}</span>
      </label>
    </Tip>
  );
}

function Grip() {
  return (
    <div className="absolute top-0 -right-1 bottom-0 z-10 w-2 cursor-ew-resize" title="drag to resize"
      onPointerDown={e => {
        const el = e.currentTarget; el.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => paint.setState({ width: Math.min(Math.max(300, m.clientX), Math.round(innerWidth * 0.7)) });
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); saveUi(); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      }} />
  );
}

function Head() {
  const engine = useEngine();
  const [help, setHelp] = React.useState(false);
  return (
    <>
      <div className="flex items-center gap-1.5">
        <b className="flex-1 text-[11px] tracking-wider text-label uppercase">Weather map painter</b>
        <Tip text="keys and notes"><Button size="sm" active={help} onClick={() => setHelp(!help)}>help</Button></Tip>
        <Tip text="close (M)"><Button size="icon" className="size-5" onClick={() => engine.toggle(false)}><X /></Button></Tip>
      </div>
      {help && (
        <Note>
          Left-drag paints. Alt-click picks the values under the cursor. Right-click puts the camera there. Wheel zooms, space- or middle-drag pans, shift-wheel sets the size.
          Over the map: <Kbd>1</Kbd>-<Kbd>8</Kbd> tools, <Kbd>[</Kbd> <Kbd>]</Kbd> size, <Kbd>⌘Z</Kbd> undo, <Kbd>⇧⌘Z</Kbd> redo, <Kbd>0</Kbd> fits the map. <Kbd>M</Kbd> opens and closes the painter; opening it sets the map motion to static, so what you paint stays put (pick drift again in the Sky section).
          The painting replaces the generated map in the sky from the first stroke until you drop it; the tuning panel's weather-map settings apply to "generated" sources.
          Beyond ringStart (15 km) the horizon ring replaces the map, as in HZD. Paint soft gradients: a flat plateau of coverage turns into a flat-sided slab.
        </Note>
      )}
    </>
  );
}

function SourcePanel() {
  const engine = useEngine();
  const s = { maps: usePaint(st => st.maps), autosaveTime: usePaint(st => st.autosaveTime), source: usePaint(st => st.source), busy: usePaint(st => st.busy) };
  const label = usePaint(st => st.sourceLabel), n = usePaint(st => st.n), edited = usePaint(st => st.edited), owned = usePaint(st => st.owned);
  useBench(b => b.settingsTick);
  const ndf = engine.host.ndf;
  const file = React.useRef<HTMLInputElement>(null);
  const tile = engine.tile();
  const load = (v: string) => { if (v === 'file') { if (file.current) { file.current.value = ''; file.current.click(); } } else void engine.loadSource(v); };
  return (
    <>
      <Sec>Source</Sec>
      <Row className="flex-nowrap">
        <Tip text="what to start painting from" side="right">
          <div className="min-w-0 flex-1">
            <Select value={s.source} onValueChange={v => paint.setState({ source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[60vh]">
                <SelectItem value="sky">the sky as it is now</SelectItem>
                <SelectItem value="generated">generated (seed, footprint, the tuning panel's map settings)</SelectItem>
                <SelectItem value="blank">blank (no cloud)</SelectItem>
                {s.autosaveTime > 0 && <SelectItem value="autosave">{`last painting (${new Date(s.autosaveTime).toLocaleString()})`}</SelectItem>}
                {s.maps.examples.length > 0 && <SelectGroup><SelectLabel>W1 example maps (assets/clouds/ndf)</SelectLabel>
                  {s.maps.examples.map(m => <SelectItem key={m.url} value={`url:${m.url}|${m.heightUrl}`}>{`${m.name}${m.heightUrl ? ' + height' : ''}`}</SelectItem>)}</SelectGroup>}
                {s.maps.painted.length > 0 && <SelectGroup><SelectLabel>painted (assets/clouds/ndf/painted)</SelectLabel>
                  {s.maps.painted.map(m => <SelectItem key={m.url} value={`url:${m.url}|${m.heightUrl}`}>{`${m.name}${m.heightUrl ? ' + height' : ''}`}</SelectItem>)}</SelectGroup>}
                <SelectItem value="file">a PNG from disk...</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Tip>
        <Tip text="replace the painting with this source (undoable only by loading again)"><Button disabled={!!s.busy} onClick={() => load(s.source)}>load</Button></Tip>
        <input ref={file} type="file" accept="image/png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void engine.loadFile(f); }} />
      </Row>
      <Row className="flex-nowrap">
        <span>seed</span>
        <Tip text="the generator's seed (ndf.seed)">
          <Input type="number" step={1} className="w-14" value={String(ndf.seed)} onChange={e => { ndf.seed = Math.round(Number(e.target.value) || 0); settingsChanged({ refreshTuner: true }); }} />
        </Tip>
        <Tip text="a random seed, then load the generated map">
          <Button size="icon" onClick={() => { ndf.seed = Math.floor(Math.random() * 1000); settingsChanged({ refreshTuner: true }); paint.setState({ source: 'generated' }); void engine.loadSource('generated'); }}>🎲</Button>
        </Tip>
        <Tip text={'the generator\'s footprint (ndf.footprint): Perlin "connected formations" or Perlin-Worley "isolated islands" (n17 p.56-57)'} side="right">
          <div className="min-w-0 flex-1">
            <Select value={Number(ndf.footprint) >= 0.5 ? '1' : '0'} onValueChange={v => { ndf.footprint = Number(v); settingsChanged({ refreshTuner: true }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="0">connected</SelectItem><SelectItem value="1">islands</SelectItem></SelectContent>
            </Select>
          </div>
        </Tip>
      </Row>
      <Note>
        {n ? `${label} · ${n}² over ${(tile / 1000).toFixed(0)} km (${(tile / n).toFixed(0)} m per pixel)` : 'no map yet'}
        {edited && <span className="text-warn"> · unsaved changes</span>}
        {owned ? ' · in the sky' : ` · the sky shows ${ndf.image ? String(ndf.image).replace(/^.*\//, '') : 'the generator'} until the first stroke`}
      </Note>
    </>
  );
}

function MapBox({ spaceHeld }: { spaceHeld: React.RefObject<boolean> }) {
  const engine = useEngine();
  const busy = usePaint(s => s.busy);
  return (
    <div className="relative aspect-square w-[min(100%,max(180px,100vh-340px))] max-w-full flex-none self-center overflow-hidden rounded-sm border border-border bg-black touch-none">
      <MapView engine={engine} spaceHeld={spaceHeld} />
      {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-value">{busy}</div>}
    </div>
  );
}

function StatusLine() {
  const status = usePaint(s => s.status);
  return <div className="min-h-[2.7em] text-[11px] whitespace-pre text-value">{status}</div>;
}

function ToolsPanel() {
  const engine = useEngine();
  const tool = usePaint(s => s.tool), size = usePaint(s => s.sizeMeters), strength = usePaint(s => s.strength), hardness = usePaint(s => s.hardness), cells = usePaint(s => s.noiseCells);
  const tile = engine.tile();
  return (
    <>
      <Sec>Tools</Sec>
      <ToggleGroup type="single" value={tool} onValueChange={v => v && paint.setState({ tool: v as Tool })}>
        {TOOLS.map(([t, name, about], i) => {
          const Icon = TOOL_ICON[t];
          return <Tip key={t} text={<>{about} <Kbd>{i + 1}</Kbd></>}><ToggleGroupItem value={t} className="gap-1"><Icon className="size-3.5" />{name}</ToggleGroupItem></Tip>;
        })}
      </ToggleGroup>
      <PSlider name="size" tip="brush radius in metres ([ ] or shift-wheel over the map)" min={50} max={8000} step={10} value={size} onChange={v => paint.setState({ sizeMeters: v })}
        fmt={v => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)} />
      <PSlider name="strength" tip="per dab (a stroke lays a dab every quarter radius); for the gradient, its full weight" min={0.01} max={1} step={0.01} value={strength} onChange={v => paint.setState({ strength: v })} fmt={v => v.toFixed(2)} />
      <PSlider name="hardness" tip="0 = a soft cosine falloff, 1 = a hard disc" min={0} max={1} step={0.01} value={hardness} onChange={v => paint.setState({ hardness: v })} fmt={v => v.toFixed(2)} />
      {tool === 'noise' && (
        <PSlider name="grain" tip={'the noise brush and "+ noise": the size of its largest blobs'} min={200} max={8000} step={50} value={tile / cells}
          onChange={v => paint.setState({ noiseCells: Math.max(1, Math.round(tile / v)) })} fmt={v => `${(tile / Math.max(1, Math.round(tile / v)) / 1000).toFixed(2)} km`} />
      )}
    </>
  );
}

function ChannelRow({ c }: { c: Channel }) {
  const engine = useEngine();
  const ticked = usePaint(s => s.ticked[c]), target = usePaint(s => s.targets[c]);
  const viewing = usePaint(s => s.display === 'channel' && s.viewChannel === c);
  const [lb, lt] = engine.layer();
  const fmt = (x: number) => (c === 'minHeight' || c === 'maxHeight' ? `${Math.round(lb + x * (lt - lb))} m` : x.toFixed(2));
  const view = () => { paint.setState({ viewChannel: c, display: 'channel' }); saveUi(); };
  const setTicked = (v: boolean) => paint.setState(s => ({ ticked: { ...s.ticked, [c]: v } }));
  return (
    <div className="grid items-center gap-1" style={{ gridTemplateColumns: '16px 84px 1fr 64px 20px' }}>
      <Checkbox checked={ticked} onCheckedChange={v => setTicked(v === true)} aria-label={`paint ${LABEL[c]}`} />
      <Tip text={`${ABOUT[c]} (click to view this channel)`} side="right">
        <button type="button" className={cn('cursor-pointer truncate text-left', viewing && 'text-[#ffd27a]')} onClick={view}>{LABEL[c]}</button>
      </Tip>
      <Slider min={0} max={1} step={0.01} value={[target]} aria-label={`${LABEL[c]} value`}
        onValueChange={([v]) => paint.setState(s => ({ targets: { ...s.targets, [c]: v }, ticked: s.ticked[c] ? s.ticked : { ...s.ticked, [c]: true } }))} />
      <span className="text-right text-value tabular-nums">{fmt(target)}</span>
      <Tip text="view this channel in the map">
        <Button size="icon" variant="ghost" className={cn('size-5', viewing ? 'text-[#ffd27a]' : 'text-muted-foreground')} onClick={view}><Eye /></Button>
      </Tip>
    </div>
  );
}

function ChannelsPanel() {
  const engine = useEngine();
  return (
    <>
      <Sec>Channels</Sec>
      <Note>Tick the channels a stroke changes; each one's value is what paint, noise, gradient and fill go toward. Click a name to view it.</Note>
      {CHANNELS.map(c => <ChannelRow key={c} c={c} />)}
      <Row>
        {RECIPES.map(([name, about, t]) => (
          <Tip key={name} text={`${about}; ticks those channels and switches to paint`}>
            <Button onClick={() => paint.setState(s => ({
              ticked: Object.fromEntries(CHANNELS.map(c => [c, t[c] !== undefined])) as Record<Channel, boolean>,
              targets: { ...s.targets, ...t } as Record<Channel, number>,
              tool: s.tool === 'noise' ? 'noise' : 'paint',
            }))}>{name}</Button>
          </Tip>
        ))}
      </Row>
      <Row>
        <Tip text="set the ticked channels to their values everywhere"><Button onClick={() => engine.whole('fill')}>fill</Button></Tip>
        <Tip text="blur the ticked channels by a quarter of the brush size"><Button onClick={() => engine.whole('blur')}>blur all</Button></Tip>
        <Tip text="the ticked channels become 1 - value"><Button onClick={() => engine.whole('invert')}>invert</Button></Tip>
        <Tip text="multiply the ticked channels by fBM at the grain size, by the strength: breaks up plateaus in place"><Button onClick={() => engine.whole('noise')}>+ noise</Button></Tip>
      </Row>
    </>
  );
}

function MapViewPanel() {
  const engine = useEngine();
  const display = usePaint(s => s.display), contour = usePaint(s => s.contour), overlays = usePaint(s => s.overlays), follow = usePaint(s => s.follow);
  const set = (p: Partial<ReturnType<typeof paint.getState>>) => { paint.setState(p); saveUi(); };
  return (
    <>
      <Sec>Map view</Sec>
      <Row className="flex-nowrap">
        <Tip text="composite: coverage as cloud over sky, tinted by top type (blue-grey stratus to warm cumulus); channel: the viewed channel as a ramp" side="right">
          <div className="min-w-0 flex-1">
            <Select value={display} onValueChange={v => set({ display: v as 'composite' | 'channel' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="composite">show: composite</SelectItem><SelectItem value="channel">show: the viewed channel</SelectItem></SelectContent>
            </Select>
          </div>
        </Tip>
        <Tip text="the whole map, centred on the world origin (0)">
          <Button onClick={() => { const n = engine.fields?.n ?? 0; paint.setState({ zoom: 1, pan: [n / 2, n / 2], follow: false }); }}>fit</Button>
        </Tip>
      </Row>
      <Row className="gap-3">
        <Tip text="the coverage threshold (0.38 less the coverage bias): roughly where clouds start to form"><Label><Checkbox checked={contour} onCheckedChange={v => set({ contour: v === true })} />contour</Label></Tip>
        <Tip text="the camera and its view, the horizon ring, the sun and the wind"><Label><Checkbox checked={overlays} onCheckedChange={v => set({ overlays: v === true })} />overlays</Label></Tip>
        <Tip text="keep the camera in the middle of the map view"><Label><Checkbox checked={follow} onCheckedChange={v => set({ follow: v === true })} />follow camera</Label></Tip>
      </Row>
    </>
  );
}

function SkyPanel() {
  const engine = useEngine();
  const liveMode = usePaint(s => s.liveMode), owned = usePaint(s => s.owned), topDown = usePaint(s => s.topDown);
  useBench(b => b.settingsTick);
  const hzd = engine.host.hzd, ndf = engine.host.ndf, tile = engine.tile();
  const sizes = [8, 12, 16, 24, 32, 48, 64].map(km => km * 1000);
  if (!sizes.includes(tile)) sizes.push(tile);
  return (
    <>
      <Sec>Sky</Sec>
      <Row className="flex-nowrap">
        <Tip text="live: the sky updates while you paint (each update restarts its temporal blend, so it is noisy until you stop); on release: when the stroke ends" side="right">
          <div className="min-w-0 flex-1">
            <Select value={liveMode} onValueChange={v => { paint.setState({ liveMode: v as 'live' | 'release' }); saveUi(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="live">update: while painting</SelectItem><SelectItem value="release">update: on release</SelectItem></SelectContent>
            </Select>
          </div>
        </Tip>
        <Tip text="hzd.ndfMotion: drift moves the map with the wind (the default), static keeps it where you painted it (Nubis)" side="right">
          <div className="min-w-0 flex-1">
            <Select value={String(hzd.ndfMotion)} onValueChange={v => { hzd.ndfMotion = v; settingsChanged({ refreshTuner: true }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['drift', 'static', 'rigid', 'shape', 'detail'].map(m => <SelectItem key={m} value={m}>{`map motion: ${m}`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </Tip>
      </Row>
      <Tip text="ndf.tileMeters: the world size of the map (it tiles). Changes the sky at once; the painting keeps its pixels" side="right">
        <div>
          <Select value={String(tile)} onValueChange={v => { ndf.tileMeters = Number(v); settingsChanged({ refreshTuner: true }); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sizes.map(m => <SelectItem key={m} value={String(m)}>{`map size: ${m / 1000} km`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Tip>
      <Row>
        <Tip text="look straight down from 14 km over the camera's spot (again to go back)"><Button active={topDown} onClick={() => engine.toggleTopDown()}>{topDown ? 'back from above' : 'view from above'}</Button></Tip>
        <Tip text="the sky goes back to the generated map (or ndf.image); the painting stays here"><Button disabled={!owned} onClick={() => engine.dropPainting()}>drop the painting</Button></Tip>
      </Row>
    </>
  );
}

function FilesPanel() {
  const engine = useEngine();
  const canUndo = usePaint(s => s.canUndo), canRedo = usePaint(s => s.canRedo), bytes = usePaint(s => s.undoBytes), name = usePaint(s => s.name), note = usePaint(s => s.note);
  return (
    <>
      <Sec>History and files</Sec>
      <Row>
        <Tip text="ctrl/cmd-Z"><Button disabled={!canUndo} onClick={() => engine.undoStep(true)}>undo</Button></Tip>
        <Tip text="shift-ctrl/cmd-Z"><Button disabled={!canRedo} onClick={() => engine.undoStep(false)}>redo</Button></Tip>
        {bytes > 0 && <span className="text-[11px] text-muted-foreground">{`history ${(bytes / 1048576).toFixed(1)} MB`}</span>}
      </Row>
      <Row className="flex-nowrap">
        <Tip text="saved as assets/clouds/ndf/painted/<name>.png and <name>-height.png" side="right">
          <Input type="text" placeholder="name (a-z 0-9 -)" className="min-w-0 flex-1" value={name} onChange={e => paint.setState({ name: e.target.value })} onBlur={saveUi} />
        </Tip>
        <Tip text="write the two PNGs to assets/clouds/ndf/painted/ (dev server) and point ndf.image at them, so the page's URL reopens this sky"><Button onClick={() => void engine.save()}>save</Button></Tip>
        <Tip text="download the two PNGs (the authored-map format: assets/clouds/ndf/README.md)"><Button onClick={() => void engine.download()}>download</Button></Tip>
      </Row>
      <Row>
        <Tip text="copy the page's URL (after a save it reopens this painted sky)">
          <Button onClick={() => { void navigator.clipboard?.writeText(location.href); engine.note('link copied'); }}>copy link</Button>
        </Tip>
      </Row>
      {note && <Note>{note}</Note>}
    </>
  );
}

/** M opens and closes the painter (not while typing). While it is open: cmd/ctrl-Z undo, shift for redo, Y redo; over the dock: 1-8 tools,
 *  [ ] size, 0 fits the map, space pans. Capture phase: over the dock these win over the bench's keys (the sun's [ ]) and the camera rig's. */
function usePainterKeys(engine: PaintEngine | null, hovering: React.RefObject<boolean>, space: React.RefObject<boolean>) {
  React.useEffect(() => {
    if (!engine) return;
    const typing = (t: EventTarget | null) => (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'number')) || t instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === 'm' && !e.metaKey && !e.ctrlKey) { engine.toggle(); e.stopImmediatePropagation(); return; }
      if (!paint.getState().open) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); engine.undoStep(!e.shiftKey); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopImmediatePropagation(); engine.undoStep(false); return; }
      if (!hovering.current) return;
      const s = paint.getState(), n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TOOLS.length) paint.setState({ tool: TOOLS[n - 1][0] });
      else if (e.key === '[' || e.key === '{') paint.setState({ sizeMeters: Math.max(50, s.sizeMeters / 1.2) });
      else if (e.key === ']' || e.key === '}') paint.setState({ sizeMeters: Math.min(8000, s.sizeMeters * 1.2) });
      else if (e.key === '0' && engine.fields) paint.setState({ zoom: 1, pan: [engine.fields.n / 2, engine.fields.n / 2], follow: false });
      else if (e.code === 'Space') { space.current = true; e.preventDefault(); }
      else return;
      e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    return () => { removeEventListener('keydown', down, true); removeEventListener('keyup', up, true); };
  }, [engine, hovering, space]);
}
