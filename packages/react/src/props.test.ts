import { describe, expect, it } from 'vitest';
import { collectSettings, settingsKey, settingsPatch } from './props';

describe('collectSettings', () => {
  it('splits loose settings props from component props', () => {
    const s = collectSettings({ volume: '/x/', position: [0, 1, 2], quality: 'high', densityScale: 0.02, msStrength: 1.5, onLoad: () => {} });
    expect(s).toEqual({ densityScale: 0.02, msStrength: 1.5 });
  });
  it('lets loose props override the settings object and drops undefined', () => {
    expect(collectSettings({ settings: { densityScale: 1, msStrength: 2 }, densityScale: 3, silverG: undefined })).toEqual({ densityScale: 3, msStrength: 2 });
  });
});

describe('settingsKey / settingsPatch', () => {
  it('is order independent', () => expect(settingsKey({ densityScale: 1, msStrength: 2 })).toBe(settingsKey({ msStrength: 2, densityScale: 1 })));
  it('restores defaults of dropped keys and keeps new ones', () => {
    expect(settingsPatch({ densityScale: 9, msStrength: 2 }, { msStrength: 3 }, { densityScale: 0.01, msStrength: 1 })).toEqual({ densityScale: 0.01, msStrength: 3 });
  });
});
