// Build-time WGSL minifier (B1). Dist builds only: sources stay readable.
//
// Finds template literals tagged with a `/* wgsl */` comment in TypeScript source (nested templates inside a tagged template's `${...}`
// inherit the tag) and rewrites their static parts: `//` and `/* */` comments removed, whitespace collapsed to one space, and spaces dropped
// around `{ } ( ) [ ] ; , : =`. Identifiers, operators (+ - * / & | < >), numbers and every `${...}` interpolation are left alone, so the
// WGSL means the same thing. A space next to an interpolation is kept as one space (the value is unknown). WGSL has no string literals and
// no backslashes, so a static part containing a backslash is rejected loudly rather than guessed at.
//
// Exports: minifyWgsl(text), minifyWgslTemplates(tsSource, file), wgslMinifyPlugin (esbuild plugin).
import { readFile } from 'node:fs/promises';

/** Minify one static part of a template. `first`/`last`: the part touches the template's start/end (trim) rather than an interpolation (keep one space). */
export function minifyWgsl(text, { first = true, last = true, where = '' } = {}) {
  if (text.includes('\\')) throw new Error(`wgsl-minify: backslash in a WGSL template part (${where})`);
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { // line comment: to the newline (which stays as whitespace)
      const nl = text.indexOf('\n', i);
      if (nl < 0) { if (!last) throw new Error(`wgsl-minify: line comment runs into a \${} interpolation (${where})`); i = text.length; } else i = nl;
      out += ' ';
    } else if (c === '/' && d === '*') { // block comment (WGSL allows nesting)
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; } else if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      if (depth > 0) throw new Error(`wgsl-minify: unterminated block comment (${where})`);
      out += ' '; i = j;
    } else { out += c; i++; }
  }
  out = out.replace(/\s+/g, ' ').replace(/ ?([{}()[\];,:=]) ?/g, '$1');
  if (first) out = out.replace(/^ /, '');
  if (last) out = out.replace(/ $/, '');
  return out;
}

// ---- a small lexer over TS source: enough to find template literals and skip strings, comments and regexes ----
function skipString(s, i) { const q = s[i]; i++; while (i < s.length && s[i] !== q) i += s[i] === '\\' ? 2 : 1; return i + 1; }
function skipComment(s, i) { // returns the index after the comment, or -1 if s[i] does not start one
  if (s[i] === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); return n < 0 ? s.length : n; }
  if (s[i] === '/' && s[i + 1] === '*') { const n = s.indexOf('*/', i + 2); return n < 0 ? s.length : n + 2; }
  return -1;
}
const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|\b(?:return|typeof|case|in|of)$/;
function skipRegex(s, i) { i++; let cls = false; while (i < s.length) { const c = s[i]; if (c === '\\') i++; else if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) return i + 1; i++; } return i; }

/** Scan code from `i` until the matching `}` of a `${` (depth 0), copying it with nested templates processed. Returns [text, indexAfterBrace]. */
function scanExpr(s, i, wgsl, file) {
  let out = '', depth = 0;
  while (i < s.length) {
    const c = s[i];
    const cEnd = skipComment(s, i);
    if (cEnd >= 0) { out += s.slice(i, cEnd); i = cEnd; continue; }
    if (c === '"' || c === "'") { const e = skipString(s, i); out += s.slice(i, e); i = e; continue; }
    if (c === '`') { const [t, e] = scanTemplate(s, i, wgsl, file); out += t; i = e; continue; }
    if (c === '/' && REGEX_AFTER.test(s.slice(Math.max(0, i - 12), i).trimEnd())) { const e = skipRegex(s, i); out += s.slice(i, e); i = e; continue; }
    if (c === '{') depth++;
    if (c === '}') { if (depth === 0) return [out, i + 1]; depth--; }
    out += c; i++;
  }
  throw new Error(`wgsl-minify: unterminated \${ in ${file}`);
}

/** s[i] is a backtick. Returns [rewrittenTemplate, indexAfter]. */
function scanTemplate(s, i, wgsl, file) {
  const parts = [], exprs = [];
  let cur = ''; i++;
  for (;;) {
    if (i >= s.length) throw new Error(`wgsl-minify: unterminated template in ${file}`);
    const c = s[i];
    if (c === '\\') { cur += s.slice(i, i + 2); i += 2; }
    else if (c === '`') { parts.push(cur); i++; break; }
    else if (c === '$' && s[i + 1] === '{') { parts.push(cur); cur = ''; const [e, after] = scanExpr(s, i + 2, wgsl, file); exprs.push(e); i = after; }
    else { cur += c; i++; }
  }
  if (!wgsl) return ['`' + parts.map((p, k) => p + (k < exprs.length ? '${' + exprs[k] + '}' : '')).join('') + '`', i];
  const where = `${file}:${s.slice(0, i).split('\n').length}`;
  const min = parts.map((p, k) => minifyWgsl(p, { first: k === 0, last: k === parts.length - 1, where }));
  return ['`' + min.map((p, k) => p + (k < exprs.length ? '${' + exprs[k] + '}' : '')).join('') + '`', i];
}

/** Rewrite every `/* wgsl *\/` template in a TS/JS source. Returns the source unchanged when it has none. */
export function minifyWgslTemplates(s, file = '<source>') {
  if (!s.includes('/* wgsl */')) return s;
  let out = '', i = 0, last = 0, templates = 0;
  while (i < s.length) {
    const c = s[i];
    const cEnd = skipComment(s, i);
    if (cEnd >= 0) {
      if (s.startsWith('/* wgsl */', i)) { // tag: the next non-space char must be a backtick
        let j = cEnd; while (/\s/.test(s[j])) j++;
        if (s[j] === '`') { out += s.slice(last, j); const [t, e] = scanTemplate(s, j, true, file); out += t; i = last = e; templates++; continue; }
      }
      i = cEnd; continue;
    }
    if (c === '"' || c === "'") { i = skipString(s, i); continue; }
    if (c === '`') { const [, e] = scanTemplate(s, i, false, file); i = e; continue; } // untagged template: skip, nested tagged ones are not found
    if (c === '/' && REGEX_AFTER.test(s.slice(Math.max(0, i - 12), i).trimEnd())) { i = skipRegex(s, i); continue; }
    i++;
  }
  return out + s.slice(last);
}

/** esbuild plugin: minify tagged WGSL templates in the .ts files it loads. */
export const wgslMinifyPlugin = {
  name: 'wgsl-minify',
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async ({ path }) => {
      if (path.includes('node_modules')) return undefined;
      const src = await readFile(path, 'utf8');
      if (!src.includes('/* wgsl */')) return undefined;
      return { contents: minifyWgslTemplates(src, path), loader: path.endsWith('x') ? 'tsx' : 'ts' };
    });
  },
};
