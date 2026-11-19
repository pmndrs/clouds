// S1: the sky's look as a switch (procedural/styles.ts): horizon (the bench as it is), early raymarch, photo weight. Its own section so the
// sidebar can take other axes (a render level) beside it. The URL follows it (`style=`), and `?style=` opens a look for captures.
import { PROCEDURAL_STYLES, PROCEDURAL_STYLE_NAMES, type ProceduralStyle } from '../../../../packages/runtime/src/procedural/styles';
import { ToggleGroup, ToggleGroupItem } from '../ui/components/toggle-group';
import { Tip } from '../ui/components/tooltip';
import { useBench } from '../bench/store';
import { setStyle } from '../bench/style';
import { Note, Section } from './controls';

export function StyleSection() {
  const style = useBench(s => s.style);
  const ready = useBench(s => !!s.rt);
  const b = PROCEDURAL_STYLES[style];
  const n = Object.keys(b.proc ?? {}).length + Object.keys(b.hzd ?? {}).length + Object.keys(b.ndf ?? {}).length + Object.keys(b.cloud ?? {}).length;
  return (
    <Section title="Style">
      <ToggleGroup type="single" value={style} disabled={!ready} onValueChange={v => v && setStyle(v as ProceduralStyle)}>
        {PROCEDURAL_STYLE_NAMES.map(s => <Tip key={s} text={PROCEDURAL_STYLES[s].about}><ToggleGroupItem value={s}>{PROCEDURAL_STYLES[s].label}</ToggleGroupItem></Tip>)}
      </ToggleGroup>
      <Note>{style === 'horizon' ? 'The bench defaults.' : `${n} settings over the bench defaults (work/reports/S1-styles.md); the tune panel (T) shows changes relative to the style.`}</Note>
    </Section>
  );
}
