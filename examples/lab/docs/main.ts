// Project docs: every markdown file under docs/ and work/ (plus the root README), rendered in the browser with a "start here" list, a folder
// tree, a search over names and text, and links between the notes. Links to code or other files open in your editor (Vite's open-in-editor);
// images in the repo show inline. Dev server only: the files are read from the checkout.
import { render } from './md';

declare const __REPO_ROOT__: string;
const ROOT = __REPO_ROOT__.replace(/\/$/, '');

const loaders = (import.meta as unknown as { glob: (p: string[], o: object) => Record<string, () => Promise<string>> }).glob(
  ['../../../docs/**/*.{md,mdx}', '../../../work/**/*.md', '../../../README.md', '../../../assets/**/*.md', '../../../houdini/**/*.md', '../../../scripts/**/*.md'],
  { query: '?raw', import: 'default' },
);
const files = new Map<string, () => Promise<string>>();
for (const [k, load] of Object.entries(loaders)) files.set(k.replace(/^(\.\.\/)+/, ''), load);
const cache = new Map<string, string>();
const read = async (p: string) => { if (!cache.has(p)) cache.set(p, await files.get(p)!()); return cache.get(p)!; };

// What to read first, in order.
const START: [string, string][] = [
  ['work/STATUS.md', 'Start here: what is running, what is waiting on you, what landed'],
  ['work/D1-TOOLS.md', 'Every bench, capture and measuring command'],
  ['work/HZD-BENCH.md', 'The HZD bench: our procedural sky against the papers and photos'],
  ['work/reports/D1.md', 'The Decima parity rounds, in full'],
  ['work/calibration/d1k-results.md', 'The latest judged round'],
  ['work/reports/D1-florets.md', 'Why the cauliflower bumps were missing'],
  ['work/archive/BOARD.md', 'Archived: all October tasks'],
  ['docs/research/topics/README.md', 'Research map and the top 20'],
  ['docs/research/README.md', 'Research index'],
  ['work/README.md', 'How the agents work'],
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const nav = $('#nav'), doc = $('#doc'), toc = $('#toc'), search = $<HTMLInputElement>('#search'), deep = $<HTMLInputElement>('#deep'), count = $('#count');

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
const resolvePath = (base: string, rel: string) => {
  const parts = (rel.startsWith('/') ? rel.slice(1) : `${dirOf(base)}/${rel}`).split('/');
  const out: string[] = [];
  for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
};
const route = () => { const h = decodeURIComponent(location.hash.slice(1)); const [path, anchor] = h.split('::'); return { path: path || START[0][0], anchor }; };
const hrefFor = (path: string, anchor?: string) => `#${encodeURIComponent(path)}${anchor ? `::${encodeURIComponent(anchor)}` : ''}`;
const editorHref = (path: string) => `/__open-in-editor?file=${encodeURIComponent(path.startsWith('/') ? path : `${ROOT}/${path}`)}`;

function resolver(current: string) {
  return {
    link(href: string) {
      if (/^(https?:|mailto:)/.test(href)) return { href, external: true };
      if (href.startsWith('#')) return { href: hrefFor(current, href.slice(1)) };
      const [p, anchor] = href.split('#');
      if (p.startsWith('/Users/')) return { href: editorHref(p.replace(/:\d+$/, '')) };
      const path = resolvePath(current, p.replace(/:\d+$/, ''));
      if (files.has(path)) return { href: hrefFor(path, anchor) };
      return { href: editorHref(path) };
    },
    image(src: string) {
      if (/^(https?:|data:)/.test(src)) return src;
      return `/@fs${src.startsWith('/Users/') ? src : `${ROOT}/${resolvePath(current, src)}`}`;
    },
  };
}

// The tree: folders collapse; "start here" sits on top.
const collapsed = new Set<string>(JSON.parse(localStorage.getItem('docs-collapsed') ?? '["docs/archive","work/calibration"]'));
function buildNav(matches?: Set<string>) {
  const q = search.value.trim().toLowerCase();
  const visible = [...files.keys()].filter(p => (!q || deep.checked ? true : p.toLowerCase().includes(q)) && (!matches || matches.has(p))).sort();
  count.textContent = `${visible.length} of ${files.size} files`;
  const groups = new Map<string, string[]>();
  for (const p of visible) { const d = dirOf(p) || '.'; if (!groups.has(d)) groups.set(d, []); groups.get(d)!.push(p); }
  const current = route().path;
  const item = (p: string, label = p.split('/').pop()!.replace(/\.mdx?$/, '')) => `<a class="file${p === current ? ' on' : ''}" href="${hrefFor(p)}" title="${p}">${label}</a>`;
  let html = '';
  if (!q && !matches) html += `<div class="group start"><div class="gtitle">Start here</div>${START.filter(([p]) => files.has(p)).map(([p, d]) => `<a class="file start${p === current ? ' on' : ''}" href="${hrefFor(p)}"><b>${p.split('/').pop()!.replace(/\.md$/, '')}</b><span>${d}</span></a>`).join('')}</div>`;
  for (const [d, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const open = q || matches ? true : !collapsed.has(d);
    html += `<div class="group"><button class="gtitle fold" data-dir="${d}">${open ? '▾' : '▸'} ${d} <span>${list.length}</span></button>${open ? list.map(p => item(p)).join('') : ''}</div>`;
  }
  nav.innerHTML = html;
}
nav.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.fold');
  if (!b) return;
  const d = b.dataset.dir!; collapsed.has(d) ? collapsed.delete(d) : collapsed.add(d);
  try { localStorage.setItem('docs-collapsed', JSON.stringify([...collapsed])); } catch { /* optional */ }
  buildNav(lastMatches);
});

let lastMatches: Set<string> | undefined;
let searchSeq = 0;
async function runSearch() {
  const q = search.value.trim().toLowerCase();
  const seq = ++searchSeq;
  if (!q || !deep.checked) { lastMatches = undefined; buildNav(); return; }
  count.textContent = 'searching…';
  const hits = new Set<string>();
  await Promise.all([...files.keys()].map(async p => { if (p.toLowerCase().includes(q) || (await read(p)).toLowerCase().includes(q)) hits.add(p); }));
  if (seq !== searchSeq) return;
  lastMatches = hits; buildNav(hits);
}
search.addEventListener('input', () => void runSearch());
deep.addEventListener('change', () => void runSearch());

async function show() {
  const { path, anchor } = route();
  if (!files.has(path)) { doc.innerHTML = `<p class="missing">No document at <code>${path}</code>.</p>`; toc.innerHTML = ''; return; }
  const text = await read(path);
  const { html, headings } = render(text, resolver(path));
  doc.innerHTML = `<div class="path"><code>${path}</code><a href="${editorHref(path)}">open in editor</a></div>${html}`;
  toc.innerHTML = headings.filter(h => h.level <= 3).map(h => `<a class="l${h.level}" href="${hrefFor(path, h.id)}">${h.text}</a>`).join('');
  document.title = `${path.split('/').pop()} · Clouds docs`;
  const q = search.value.trim();
  if (q && deep.checked) highlight(q);
  if (anchor) document.getElementById(anchor)?.scrollIntoView(); else doc.parentElement!.scrollTop = 0;
  buildNav(lastMatches);
}
function highlight(q: string) {
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  while (walker.nextNode()) { const t = walker.currentNode as Text; if (t.data.toLowerCase().includes(q.toLowerCase())) hits.push(t); }
  for (const t of hits) {
    const i = t.data.toLowerCase().indexOf(q.toLowerCase());
    const mark = document.createElement('mark'); const rest = t.splitText(i); rest.splitText(q.length);
    mark.textContent = rest.data; rest.replaceWith(mark);
  }
  doc.querySelector('mark')?.scrollIntoView({ block: 'center' });
}
addEventListener('hashchange', () => void show());
buildNav();
void show();
