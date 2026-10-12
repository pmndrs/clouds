// The sidebar's building blocks: sections, rows, notes, and sliders bound to the camera view (they re-read it on viewTick).
import * as React from 'react';
import type { ViewState } from '../../compare/shared';
import { SUN_MAX, SUN_MIN, indexToSun, sunToIndex } from '../../compare/sun-control';
import { Slider } from '../ui/components/slider';
import { Input } from '../ui/components/input';
import { Tip } from '../ui/components/tooltip';
import { cn } from '../ui/lib/utils';
import { bench, scheduleUrl, useBench, viewChanged } from '../bench/store';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      <h2 className="mt-1.5 text-[10.5px] tracking-wider text-label uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function Row({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-1', className)}>{children}</div>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

/** A labelled slider row: name, track, value (62px / 1fr / 40px, as the vanilla sidebar). */
export function SliderRow({ name, tip, min, max, step, value, onChange, fmt = v => String(Math.round(v * 100) / 100), valueWidth = 40 }: {
  name: string; tip?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt?: (v: number) => string; valueWidth?: number;
}) {
  return (
    <Tip text={tip} side="left">
      <label className="grid items-center gap-1" style={{ gridTemplateColumns: `62px 1fr ${valueWidth}px` }}>
        <span>{name}</span>
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={name} />
        <span className="text-right text-value tabular-nums">{fmt(value)}</span>
      </label>
    </Tip>
  );
}

/** A slider on the camera view: writes the view, bumps viewTick, the URL follows. */
export function ViewSlider({ get, set, ...props }: Omit<React.ComponentProps<typeof SliderRow>, 'value' | 'onChange'> & { get: (v: ViewState) => number; set: (v: ViewState, x: number) => void }) {
  useBench(s => s.viewTick);
  const view = bench.getState().view;
  return <SliderRow {...props} value={get(view)} onChange={x => { set(view, x); viewChanged(); }} />;
}

/** Sun elevation: 0.1° steps from -6 to 15°, then 0.5° (the compare page's control), and a number field. [ ] { } are in useBenchKeys. */
export function SunControl() {
  useBench(s => s.viewTick);
  const view = bench.getState().view;
  const [draft, setDraft] = React.useState<string | null>(null);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const setEl = (el: number) => { view.sunEl = r1(Math.min(SUN_MAX, Math.max(SUN_MIN, el))); viewChanged(); };
  return (
    <Tip text="sun elevation: 0.1° steps from -6 to 15°, then 0.5° ([ ] 0.1°, { } 1°)" side="left">
      <label className="grid items-center gap-1" style={{ gridTemplateColumns: '62px 1fr 52px 8px' }}>
        <span>sun el</span>
        <Slider min={0} max={sunToIndex(SUN_MAX)} step={1} value={[sunToIndex(view.sunEl)]} onValueChange={([i]) => setEl(indexToSun(i))} aria-label="sun elevation" />
        <Input type="number" step={0.1} min={SUN_MIN} max={SUN_MAX} className="h-5 px-1 tabular-nums" value={draft ?? view.sunEl.toFixed(1)}
          onChange={e => { setDraft(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) { view.sunEl = Math.min(SUN_MAX, Math.max(SUN_MIN, v)); viewChanged(); } }}
          onBlur={() => { setDraft(null); scheduleUrl(); }} />
        <span>°</span>
      </label>
    </Tip>
  );
}
