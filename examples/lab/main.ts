type Link = { href: string; label: string; note: string };

const current: Link[] = [
  { href: '/flagship/', label: 'Flagship', note: 'Current clouds scene' },
  { href: '/gpu-smoke/', label: 'GPU smoke', note: 'Harness self-test' },
];

const legacy: Link[] = [
  ['authored', 'Authored density'],
  ['clouds', 'First voxel cloud'],
  ['cloudscape', 'Cloudscape (P2)'],
  ['coverage-study', 'Coverage study'],
  ['density-study', 'Density study (P2.7)'],
  ['layer-only', 'Independent 2D layer'],
  ['lighting', 'Lighting and sky (P3)'],
  ['lighting-bench', 'Lighting isolation'],
  ['lod-study', 'LOD study'],
  ['quality-bench', 'Single-cloud quality bench'],
  ['react', 'React R3F example'],
  ['react-density', 'React density'],
  ['realism', 'Realism experiment'],
  ['reconstruction', 'Reconstruction review (P4)'],
  ['three', 'Three.js library'],
].map(([name, label]) => ({ href: `/legacy/${name}/`, label, note: 'Legacy lab page' }));

function list(title: string, links: Link[]): string {
  const items = links
    .map(l => `<li><a href="${l.href}">${l.label}</a> <span class="note">${l.note} · ${l.href}</span></li>`)
    .join('');
  return `<section><h2>${title}</h2><ul>${items}</ul></section>`;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="index"><header><span class="eyebrow">pmndrs / clouds</span><h1>Lab index</h1><p>Current pages first. Legacy pages are kept for reference and are not held to the current page contract.</p></header>${list('Current', current)}${list('Legacy', legacy)}</main>`;
