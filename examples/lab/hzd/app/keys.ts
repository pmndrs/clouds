// The bench's keys (as the vanilla bench): H hide the UI, ? help, R cycle the reference mode, , . step references, hold F the reference alone,
// [ ] { } the sun elevation. T is the tuning panel's own (tune/panel.ts), M the painter's (paint/editor.ts, which wins while the pointer is
// over its dock), WASD QE the camera rig's.
import { useEffect } from 'react';
import { SUN_MAX, SUN_MIN } from '../../compare/sun-control';
import { HZD_REFS } from '../refs';
import { bench, cycleRefMode, setUiHidden, stepRef, viewChanged } from '../bench/store';

const REF_IDS = HZD_REFS.map(r => r.id);
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

export function useBenchKeys(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // The sun keys work over sliders too (the compare page's control skipped only text fields).
      const d = e.key === '[' ? -0.1 : e.key === ']' ? 0.1 : e.key === '{' ? -1 : e.key === '}' ? 1 : 0;
      if (d && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) {
        e.preventDefault();
        const v = bench.getState().view;
        v.sunEl = Math.round(Math.min(SUN_MAX, Math.max(SUN_MIN, v.sunEl + d)) * 10) / 10;
        viewChanged();
        return;
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      const s = bench.getState();
      if (e.key === 'h') setUiHidden(!s.uiHidden);
      else if (e.key === '?') bench.setState({ helpOpen: !s.helpOpen });
      else if (e.key === 'r') cycleRefMode();
      else if (e.key === ',') stepRef(-1, REF_IDS);
      else if (e.key === '.') stepRef(1, REF_IDS);
      else if (e.key === 'f' && !s.flip && s.ref.id) bench.setState({ flip: true });
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'f' && bench.getState().flip) bench.setState({ flip: false }); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);
}
