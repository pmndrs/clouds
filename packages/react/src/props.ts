// Pure prop helpers for @clouds/react (no React, no three): splitting settings from component props and diffing them.
import type { CloudSettings } from '@clouds/three';

/** Props that belong to the component; every other prop is a `CloudSettings` key (`<Clouds densityScale={0.02} />`). */
export const OWN_PROPS = ['volume', 'noise', 'position', 'quality', 'settings', 'sky', 'haze', 'lighting', 'planetCenter', 'onLoad', 'children'] as const;
const OWN = new Set<string>(OWN_PROPS);

/** Merges the `settings` object and the loose settings props (loose props win); drops undefined values. */
export function collectSettings(props: Record<string, unknown>): Partial<CloudSettings> {
  const out: Record<string, number> = {};
  const add = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    for (const [k, v] of Object.entries(source)) if (typeof v === 'number') out[k] = v;
  };
  add(props.settings);
  add(Object.fromEntries(Object.entries(props).filter(([k]) => !OWN.has(k))));
  return out as Partial<CloudSettings>;
}

/** Stable key for a settings object, so an effect re-runs on value changes and not on identity changes. */
export function settingsKey(settings: Partial<CloudSettings>): string {
  return JSON.stringify(Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Settings to write when `next` replaces `prev`: every key in `next`, plus the defaults of keys that were in `prev` and are gone
 * (so removing a prop restores the value the instance was created with).
 */
export function settingsPatch(prev: Partial<CloudSettings>, next: Partial<CloudSettings>, defaults: Partial<CloudSettings>): Partial<CloudSettings> {
  const patch: Record<string, number> = {};
  for (const k of Object.keys(prev)) if (!(k in next) && k in defaults) patch[k] = (defaults as Record<string, number>)[k];
  return { ...patch, ...next } as Partial<CloudSettings>;
}
