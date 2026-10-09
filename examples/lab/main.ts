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
