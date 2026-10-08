import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The core must stay renderer-agnostic (P2 measure): no three.js, no @pmndrs/sky, no adapter imports.
const root = new URL('.', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
});

describe('@clouds/runtime is renderer-agnostic', () => {
  it('imports nothing from three, @pmndrs/sky or the adapters', () => {
    const offenders = files(root).filter(f => /from\s+['"](three|three\/[^'"]*|@pmndrs\/sky[^'"]*|@clouds\/three[^'"]*)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
