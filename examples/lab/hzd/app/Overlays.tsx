// The readout (HUD), the help card and the "show UI" button.
import { Button } from '../ui/components/button';
import { Kbd } from '../ui/components/misc';
import { bench, setUiHidden, useBench } from '../bench/store';

export function Hud({ left }: { left: number }) {
  const text = useBench(s => s.hud);
  return <div className="pointer-events-none fixed top-2 z-[4] rounded-sm bg-black/60 px-2 py-1.5 whitespace-pre tabular-nums" style={{ left: left + 8 }}>{text}</div>;
}

export function ShowUiButton() {
  return <Button className="fixed top-2 right-2 z-[6] bg-secondary/80" onClick={() => setUiHidden(false)}>show UI (H)</Button>;
}

export function Help() {
  return (
    <div className="fixed top-2 right-[270px] z-[7] grid max-w-[380px] gap-2 rounded-sm bg-black/85 px-2.5 py-2 whitespace-normal">
      <div>
        <b className="text-label">The HZD bench</b> <span className="text-muted-foreground">(React)</span>
        <p>Our procedural Horizon Zero Dawn-style sky (GPU Pro 7's chain on the HZD noise set and the five-field weather map), beside Guerrilla's frames and the owner's photos.</p>
      </div>
      <div>
        <b className="text-label">Keys</b>
        <ul className="grid gap-0.5">
          <li><Kbd>T</Kbd> tuning panel · <Kbd>M</Kbd> weather-map painter · <Kbd>H</Kbd> hide the UI · <Kbd>?</Kbd> this card</li>
          <li><Kbd>R</Kbd> cycle the reference mode (off, side by side, picture in picture) · hold <Kbd>F</Kbd> the reference alone</li>
          <li><Kbd>,</Kbd> <Kbd>.</Kbd> previous / next reference</li>
          <li><Kbd>[</Kbd> <Kbd>]</Kbd> sun elevation 0.1° · <Kbd>{'{'}</Kbd> <Kbd>{'}'}</Kbd> 1°</li>
          <li>drag to look · fly: <Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> <Kbd>Q</Kbd><Kbd>E</Kbd>, shift faster, wheel = speed · orbit: wheel = distance</li>
        </ul>
      </div>
      <div>
        <b className="text-label">Notes</b>
        <p>References are not pixel-matched: their starting views (sun, camera, coverage) are approximate, set by eye. Papers' pages show the figure; "show: the whole page" shows the page.</p>
        <p>The URL keeps the view, the reference and every changed setting: copy it to share or reopen this state. Guide: work/HZD-BENCH.md.</p>
      </div>
      <Button size="sm" variant="ghost" className="justify-self-end" onClick={() => bench.setState({ helpOpen: false })}>close</Button>
    </div>
  );
}
