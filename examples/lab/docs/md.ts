// A small markdown renderer for the docs page: headings (with anchors), paragraphs, nested lists, tables, fenced code, blockquotes, rules, and
// inline code, bold, italics, links, images. Enough for this repo's notes; not a full CommonMark implementation.

export interface LinkResolver { link(href: string): { href: string; external?: boolean }; image(src: string): string }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~[\]()]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function inline(text: string, r: LinkResolver): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => `<img src="${esc(r.image(src))}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => {
    const l = r.link(href.replace(/&amp;/g, '&'));
    return `<a href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function render(md: string, r: LinkResolver): { html: string; headings: { level: number; text: string; id: string }[] } {
  const lines = md.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const out: string[] = [];
  const headings: { level: number; text: string; id: string }[] = [];
  const used = new Map<string, number>();
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), r)}</p>`); para.length = 0; } };

  const renderList = (start: number): number => {
    // Collect the list block (items and their indented continuation lines), then build nested lists by indentation.
    type Node = { indent: number; ordered: boolean; text: string[]; children: Node[] };
    const roots: Node[] = []; const stack: Node[] = [];
    let j = start;
    for (; j < lines.length; j++) {
      const line = lines[j];
      const m = line.match(listItem);
      if (m) {
        const node: Node = { indent: m[1].length, ordered: /\d/.test(m[2]), text: [m[3]], children: [] };
        while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
        (stack.length ? stack[stack.length - 1].children : roots).push(node);
        stack.push(node);
      } else if (line.trim() === '') {
        const next = lines[j + 1] ?? '';
        if (!next.match(listItem) && !/^\s{2,}\S/.test(next)) break;
      } else if (/^\s+\S/.test(line) && stack.length) {
        stack[stack.length - 1].text.push(line.trim());
      } else break;
    }
    const emit = (nodes: Node[]): string => {
      if (!nodes.length) return '';
      const tag = nodes[0].ordered ? 'ol' : 'ul';
      return `<${tag}>${nodes.map(n => {
        const raw = n.text.join(' ');
        const box = raw.match(/^\[([ xX])\]\s+/);
        const body = inline(box ? raw.slice(box[0].length) : raw, r);
        return `<li>${box ? `<input type="checkbox" disabled${box[1].trim() ? ' checked' : ''}> ` : ''}${body}${emit(n.children)}</li>`;
      }).join('')}</${tag}>`;
    };
    out.push(emit(roots));
    return j;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[2] ? ` class="lang-${fence[2]}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      const text = inline(h[2], r);
      let id = slug(h[2]) || 'section';
      const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id += `-${n}`;
      headings.push({ level: h[1].length, text: text.replace(/<[^>]+>/g, ''), id });
      out.push(`<h${h[1].length} id="${id}">${text}</h${h[1].length}>`);
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (line.includes('|') && isTableSep(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map(c => `<th>${inline(c, r)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${inline(c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(body.join('\n'), r).html}</blockquote>`);
      continue;
    }
    if (listItem.test(line)) { flush(); i = renderList(i); continue; }
    if (line.trim() === '') { flush(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flush();
  return { html: out.join('\n'), headings };
}
