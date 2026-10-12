// Examples gallery. Cards come from gallery/cards.json (shared with scripts/gallery-thumbs.mjs, which regenerates gallery/thumbs/<id>.webp).
import data from './gallery/cards.json';

type Card = { id: string; title: string; page: string; desc: string; packages: string[]; bookmarks: string[]; optional?: boolean };
type More = { title: string; page: string; note: string };

const thumbs = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, string> })
  .glob('./gallery/thumbs/*.webp', { eager: true, query: '?url', import: 'default' });
const thumbOf = (id: string): string | undefined => thumbs[`./gallery/thumbs/${id}.webp`];

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function card(c: Card): string {
  const src = thumbOf(c.id);
  const img = src ? `<img src="${src}" alt="" width="640" height="360" loading="lazy" decoding="async">` : '<span class="none">preview pending</span>';
  const marks = c.bookmarks.length
    ? `<div class="marks" aria-label="Bookmarks"><span class="marks-label">views</span>${c.bookmarks.map(b => `<a class="chip" href="${c.page}?bookmark=${b}">${esc(b)}</a>`).join('')}</div>`
    : '';
  return `<article class="card">
    <a class="thumb" href="${c.page}" tabindex="-1" aria-hidden="true">${img}</a>
    <div class="body">
      <h2><a href="${c.page}">${esc(c.title)}</a></h2>
      <p>${esc(c.desc)}</p>
      <div class="pkgs">${c.packages.map(p => `<span class="pkg">${esc(p)}</span>`).join('')}</div>
      ${marks}
    </div>
  </article>`;
}

function group(title: string, items: More[]): string {
  return `<h3>${title}</h3><ul>${items.map(m => `<li><a href="${m.page}">${esc(m.title)}</a><span class="note">${esc(m.note)}</span></li>`).join('')}</ul>`;
}

// Work pages: the benches and notes the parity and research rounds use (not examples, so they are not in cards.json).
const PARK = ['p101', 'p102', 'p125', 'p161', 'p213'];
const STORM = ['s206', 's214', 's33t3', 's33t6', 's33t9'];
const shot = (b: string, cloud: string) => `<a class="chip" href="decima/?cloud=${cloud}&bookmark=${b}&compare=wipe">${b}</a>`;
const HZD_VIEWS = ['ground', 'gp7', 'horizon', 'sunset', 'dusk', 'afterglow', 'above', 'high'];
const HZD_REFS: [string, string][] = [['gp7-f4.16', 'GP7 Fig 4.16'], ['hzd15-p039', 'HZD15 erosion'], ['n3-image55', 'HFW sunset'], ['ne22-p023', 'NE cumulus'], ['photo-20220701-151538_DSC00139', 'humilis photo']];
const REVIEWS: [string, string][] = [
  ['Decima parity review', 'https://claude.ai/artifact/UfkrDuARTKY61vDBUXfmBt'],
  ['Rounds overview', 'https://claude.ai/artifact/VqPT2dzg3uFNXpcvnMQRQw'],
  ['Round H review', 'https://claude.ai/artifact/RPabtz6qpXTh9nS9nfGMu5'],
  ['Research review', 'https://claude.ai/artifact/SUx3sFPuiHSBEARrFHhsfS'],
];
const work = `
<section class="work" aria-label="Work pages">
  <h2>Work</h2>
  <div class="work-grid">
    <article class="wcard">
      <h3><a href="decima/">Decima parity bench</a></h3>
      <p>Guerrilla's own clouds against their Decima frames. R = compare (wipe, overlay, frame; drag the handle), T = every dial with presets, [ ] = switch Guerrilla's frame.</p>
      <div class="marks"><span class="marks-label">Parkouring</span>${PARK.map(b => shot(b, 'parkouring')).join('')}</div>
      <div class="marks"><span class="marks-label">Stormbird</span>${STORM.map(b => shot(b, 'stormbird')).join('')}</div>
    </article>
    <article class="wcard">
      <h3><a href="hzd/">HZD bench</a></h3>
      <p>Our procedural Horizon Zero Dawn sky beside Guerrilla's papers and the owner's photos (side by side or picture in picture). T = every setting, grouped, with presets; M = paint the weather map; R = reference mode; , . = step references. The URL keeps the view and every changed setting. React + R3F.</p>
      <div class="marks"><span class="marks-label">Views</span>${HZD_VIEWS.map(v => `<a class="chip" href="hzd/?view=${v}">${v}</a>`).join('')}</div>
      <div class="marks"><span class="marks-label">Against</span>${HZD_REFS.map(([id, t]) => `<a class="chip" href="hzd/?ref=${id}&refmode=side">${t}</a>`).join('')}</div>
    </article>
    <article class="wcard">
      <h3><a href="docs/">Docs</a></h3>
      <p>Every note in docs/ and work/, rendered and searchable: the handoff, the tools guide, round reports, judging results, research.</p>
      <div class="marks"><a class="chip" href="docs/#work%2FHANDOFF.md">handoff</a><a class="chip" href="docs/#work%2FD1-TOOLS.md">tools</a><a class="chip" href="docs/#work%2FHZD-BENCH.md">HZD bench</a><a class="chip" href="docs/#work%2Freports%2FD1.md">D1 report</a><a class="chip" href="docs/#work%2FBOARD.md">board</a><a class="chip" href="docs/#docs%2Fresearch%2Ftopics%2FREADME.md">research</a></div>
    </article>
    <article class="wcard">
      <h3>Other benches</h3>
      <ul class="plain">
        <li><a href="compare/">Compare</a> <span class="note">our procedural sky against photos and other engines</span></li>
        <li><a href="frog/">Frog</a> <span class="note">the Houdini-node Frog cloud against the owner's photo</span></li>
        <li><a href="target/">Target</a> <span class="note">the Texas-afternoon tower target loop</span></li>
        <li><a href="flagship/">Flagship</a> <span class="note">the main scene and its bookmarks</span></li>
      </ul>
    </article>
    <article class="wcard">
      <h3>Review pages</h3>
      <ul class="plain">${REVIEWS.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul>
      <p class="note">Local only (never committed): comparison sheets in <code>artifacts/research/d1-parity/sheets-r*/</code>, blind sets in <code>artifacts/research/d1-parity/blind/</code>.</p>
    </article>
  </div>
</section>`;

const more = data.more as More[];
const tests = more.filter(m => m.page.startsWith('runtime-tests/') || ['ocean/', 'gpu-smoke/'].includes(m.page));
const legacy = more.filter(m => m.page.startsWith('legacy/'));

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="wrap">
  <header class="hero">
    <span class="eyebrow">pmndrs / clouds</span>
    <h1>Realtime clouds, in your browser.</h1>
    <p class="lede">Volumetric WebGPU clouds for three.js and React Three Fiber, sky lit by <span class="pkg">@pmndrs/sky</span>. Each example is a live page; the view chips jump to a camera bookmark.</p>
  </header>
  <div class="banner" id="nogpu" role="alert" hidden>
    WebGPU is not available in this browser, so the examples will not render. Use a recent Chrome, Edge or Safari with WebGPU enabled.
  </div>
  <main>
    ${work}
    <h2 class="examples-title">Examples</h2>
    <section class="grid" aria-label="Examples">${(data.cards as Card[]).map(card).join('')}</section>
    <details class="more">
      <summary>Tests, tools and legacy pages</summary>
      ${group('Tests and tools', tests)}
      ${group('Legacy (kept for reference, not held to the current page contract)', legacy)}
    </details>
  </main>
  <footer>Pages share a capture contract (<code>window.__clouds</code>) so they can be shot headlessly on the GPU. See <a href="https://github.com/pmndrs">pmndrs</a>.</footer>
</div>`;

if (!('gpu' in navigator)) document.querySelector<HTMLElement>('#nogpu')!.hidden = false;
