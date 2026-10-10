// State shared by every pane: one camera, one sun, one lens, one exposure. Compass convention as the rest of the lab: north = -Z, east = +X, y up, metres.
export interface ViewState {
  /** Camera position in metres (y = height above the ground plane at y = 0). */
  position: [number, number, number];
  /** Look direction: compass azimuth (0 = north, 90 = east) and pitch (degrees, up positive). */
  lookAz: number;
  pitch: number;
  /** Vertical field of view in degrees. */
  fov: number;
  sunAz: number;
  sunEl: number;
  /** The common coverage control, 0..1. Each pane maps it to its own parameter (see `mapCoverage`). */
  coverage: number;
  /** Multiplier on every pane's exposure (their own calibration is applied on top). */
  exposure: number;
}

export interface Bookmark { position: [number, number, number]; lookAz: number; pitch: number; sunEl: number; sunAz: number }

/** The wide scene: ground plane to the horizon, ours' cloud field 2.3 km north of the origin (open-water's cloudscape), looking north. */
export const BOOKMARKS: Record<string, Bookmark> = {
  ground: { position: [0, 2, 0], lookAz: 0, pitch: 7, sunEl: 40, sunAz: 150 },
  horizon: { position: [0, 40, 0], lookAz: 15, pitch: 1.5, sunEl: 25, sunAz: 70 },
  sunset: { position: [0, 4, 0], lookAz: 355, pitch: 4, sunEl: 4, sunAz: 355 },
  /** C1: the same low sun from the side (sun in the west, looking north): sun-facing flanks, shaded bodies and the twilight sky in one frame. */
  dusk: { position: [0, 4, 0], lookAz: 0, pitch: 6, sunEl: 3, sunAz: 290 },
  /** C1: the sun 1 degree below the ground's horizon: the ground and low cloud are in the earth's shadow, cloud above about 0.5 km still sees the sun from below. */
  afterglow: { position: [0, 4, 0], lookAz: 320, pitch: 6, sunEl: -1, sunAz: 290 },
  above: { position: [0, 3000, 0], lookAz: 0, pitch: -9, sunEl: 50, sunAz: 150 },
};
export const BOOKMARK_NAMES = Object.keys(BOOKMARKS);

export const DEFAULT_COVERAGE = 0.5;

export const forwardOf = (v: Pick<ViewState, 'lookAz' | 'pitch'>): [number, number, number] => {
  const az = (v.lookAz * Math.PI) / 180, p = (v.pitch * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(p), Math.sin(p), -Math.cos(az) * Math.cos(p)];
};
export const sunVector = (az: number, el: number): [number, number, number] => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

/**
 * Common coverage 0..1 -> each implementation's native parameter. 0.5 is the "scattered fair-weather cumulus" each is tuned to by default.
 * - ours: the weather map's coverage window (`coverageLo/Hi`), lo = 0.56 / hi = 0.9 at 0.5 (open-water's values), shifted by +-0.3 across the range.
 * - Sky Pro: `shell.coverage`; its "Partly cloudy" preset is 0.49, so common * 0.98 (0..0.98).
 * - Takram: `CloudsEffect.coverage`; 0.3 .. 0.4 reads as scattered cumulus (their story default 0.3, README 0.4), so 0.1 + common * 0.5 (0.35 at 0.5).
 */
export const mapCoverage = {
  ours: (c: number): { lo: number; hi: number } => ({ lo: 0.56 + (0.5 - c) * 0.6, hi: Math.min(0.99, 0.9 + (0.5 - c) * 0.3) }),
  skypro: (c: number): number => c * 0.98,
  takram: (c: number): number => 0.1 + c * 0.5,
  /** H1: the HZD shaper's artist coverage bias (hzd15 s38-42, +-0.5 on the NDF's coverage): 0 at 0.5. */
  hzd: (c: number): number => c - 0.5,
};

/** The ground albedo every pane shares (sRGB hex, olive grass; converted to linear per pane). */
export const GROUND_HEX = 0x3d4a2e;

export interface PaneStats { gpuMs: Record<string, number> | null; cpuMs: number }
export interface Pane {
  readonly id: 'ours' | 'hzd' | 'skypro' | 'takram' | 'photo';
  readonly label: string;
  readonly canvas: HTMLCanvasElement;
  init(): Promise<void>;
  resize(width: number, height: number): void;
  render(view: ViewState, dt: number): void;
  ready(): boolean;
  stats(): PaneStats;
  /** Per-pane exposure calibration applied on top of the shared exposure (see README in this folder / the P8-A report). */
  detail(): Record<string, unknown>;
  /** Optional extra label text (the photo pane shows its file name). */
  describe?(): string;
}
