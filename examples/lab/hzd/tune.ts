// Tuning panel for the HZD bench (Tweakpane, the shared ../tune/panel.ts): the procedural sky's settings as live controls, grouped by what
// they change, in pipeline order: the weather map (NDF), cloud types and height profiles, shape noise and the coverage remap, erosion and detail,
// the connective veil and skirts, the horizon ring, wind and motion, then the march and the light, the high cirrus layer and debug views.
// Each group opens with a line saying what it covers; each control has an (i) with its doc comment (procedural/settings.ts, runtime.ts,
// sky-layer.ts, cirrus/index.ts; a line here where there is none). Changed controls turn amber with a reset to the page's starting value
// (the code defaults). String unions, modes and switches are dropdowns. Presets save to this browser and export / import as JSON.
//
// Settings are addressed as `<source>.<key>`: proc (ProceduralSettings), hzd (its HZD shaper), ndf (the generated weather map), c (the
// renderer's CloudSettings), sky (the sky layer the procedural trace runs in), cirrus (the 2.5D high layer). The page writes changed values to
// the URL under the compare page's prefixes (hz_, hzn_, proc_, c_, sky_, cirrus_, sm_), so a link reopens the same sky.
import type { FolderApi } from 'tweakpane';
import { clone, createTunePanel, interfaceBlock, parseDocs, parseUnions, same, type Preset } from '../tune/panel';
import settingsSource from '../../../packages/runtime/src/procedural/settings.ts?raw';
import runtimeSource from '../../../packages/runtime/src/runtime.ts?raw';
import skyLayerSource from '../../../packages/runtime/src/sky-layer.ts?raw';
import cirrusSource from '../../../packages/runtime/src/cirrus/index.ts?raw';
import shadowSource from '../../../packages/runtime/src/shadow-map.ts?raw';

export type SourceId = 'proc' | 'hzd' | 'ndf' | 'c' | 'sky' | 'cirrus' | 'shadow';
/** The URL prefix of each source (the compare page's flags). */
export const PREFIX: Record<SourceId, string> = { proc: 'proc_', hzd: 'hz_', ndf: 'hzn_', c: 'c_', sky: 'sky_', cirrus: 'cirrus_', shadow: 'sm_' };

export interface BenchView { name: string; position: [number, number, number]; lookAz: number; pitch: number; fov: number; sunEl: number; sunAz: number; coverage: number; exposure: number }
export interface HzdPreset extends Preset { view: BenchView; ref: string; settings: Record<string, unknown> }

export interface HzdTuneHost {
  sources: Record<SourceId, Record<string, unknown>>;
  /** After a setting changed (the page resets the temporal history and updates the URL). */
  onChange(key: string): void;
  view(): BenchView;
  applyView(v: BenchView): void;
  ref(): string;
  setRef(id: string): void;
}

const STORE = 'hzd-bench-presets';

// --- Docs: the doc comments of each settings interface, with fixes and lines for the fields that have none ---
const block = (src: string, name: string) => interfaceBlock(src, `export interface ${name}`);
const DOCS: Record<SourceId, Record<string, string>> = {
  proc: parseDocs(block(settingsSource, 'ProceduralSettings'), { inherit: true }),
  hzd: parseDocs(block(settingsSource, 'HzdShape'), { inherit: true }),
  ndf: parseDocs(block(settingsSource, 'HzdNdfSettings'), { inherit: true }),
  c: parseDocs(block(runtimeSource, 'CloudSettings'), { inherit: true }),
  sky: parseDocs(block(skyLayerSource, 'SkyLayerSettings'), { inherit: true }),
  cirrus: parseDocs(block(cirrusSource, 'CirrusSettings'), { inherit: true }),
  shadow: parseDocs(block(shadowSource, 'CloudShadowMapSettings'), { inherit: true }),
};
// Fields that follow another field's comment without one of their own (inherit would give them the wrong text), and fields with none.
Object.assign(DOCS.hzd, {
  bottomCurlDown: 'H7 wispy bottoms: the share of the bottom curl displacement that is vertical (the curl\'s third component): hanging shreds. 0 = horizontal only. Ours.',
  wispyStrength: 'H7 wispy bottoms: the detail erosion\'s strength at h = 0, rising to erosionStrength at wispyHeight (= erosionStrength: gp7\'s single value). Ours.',
  windDirection: DOCS.hzd.windDirection ?? 'Wind direction (x, z; normalised): the tops lean along it and the noise scrolls along it.',
});
Object.assign(DOCS.ndf, { seed: 'Seed of the generated map: another seed gives another arrangement of clouds with the same statistics.' });
Object.assign(DOCS.c, {
  silverG: 'Anisotropy of the forward (silver lining) lobe of the phase function.',
  windVelocity: 'Wind velocity (m/s, x y z): the noise and the weather map scroll with the offset it integrates (with animSpeed).',
  animSpeed: 'Multiplier on time for the cloud motion (0 = frozen, as the H-report captures are; the sidebar\'s "motion" sets it too).',
  hazeHeight: 'Scale height (m) of the horizon haze.',
});
const UNIONS: Record<SourceId, Record<string, string[]>> = {
  proc: parseUnions(block(settingsSource, 'ProceduralSettings')),
  hzd: parseUnions(block(settingsSource, 'HzdShape')),
  ndf: {},
  c: parseUnions(block(runtimeSource, 'CloudSettings')),
  sky: parseUnions(block(skyLayerSource, 'SkyLayerSettings')), cirrus: {}, shadow: parseUnions(block(shadowSource, 'CloudShadowMapSettings')),
};

// Numbers that are really modes, and their meaning.
const MODES: Record<string, Record<string, number>> = {
  'hzd.stage': { '1: base shape x gradient (Fig 4.13)': 1, '2: + coverage, base fade (Fig 4.14)': 2, '3: + detail erosion (Fig 4.16)': 3 },
  'hzd.noiseSupersample': { '1: point sampled (the tool)': 1, '2: 2x2x2 box filter': 2, '3: 3x3x3 box filter': 3 },
  'ndf.resolution': { '128': 128, '256': 256, '512': 512, '1024': 1024 },
  'proc.debug': { 'off': 0, 'step count': 1, 'first-hit distance': 2, 'profile at the first hit': 3 },
  'proc.lightTaps': { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 },
  'c.lightDebug': { 'normal': 0, 'direct sun only': 1, 'inner glow (ms) only': 2, 'deep octaves only': 3, 'sky ambient only': 4, 'environment body only': 5, 'all, no aerial perspective': 6 },
  'sky.debug': { 'off': 0, 'first-hit distance': 1, 'step count': 2, 'depthMax': 3, 'no billow': 4, 'profile at first hit': 5, 'no jitter': 6, 'depth at first hit': 7 },
};
const SWITCHES = new Set(['c.compositeShadow']);
// Slider ranges where the starting value says little (0 defaults, signed values, counts).
const RANGES: Record<string, { min?: number; max?: number; step?: number }> = {
  'ndf.seed': { min: 0, max: 64, step: 1 }, 'ndf.coverageCells': { min: 1, max: 64, step: 1 }, 'ndf.islandCells': { min: 1, max: 16, step: 1 },
  'ndf.typeCells': { min: 1, max: 16, step: 1 }, 'ndf.worleyCells': { min: 1, max: 64, step: 1 },
  'ndf.coverageLo': { min: -2, max: 1, step: 0.01 }, 'ndf.coverageHi': { min: 0, max: 2, step: 0.01 }, 'ndf.islandWeight': { min: 0, max: 1, step: 0.01 },
  'ndf.typeMin': { min: 0, max: 1, step: 0.01 }, 'ndf.typeMax': { min: 0, max: 1, step: 0.01 }, 'ndf.bottomType': { min: 0, max: 1, step: 0.01 },
  'ndf.bottomTypeRange': { min: 0, max: 3, step: 0.01 }, 'ndf.bottomTypeCells': { min: 1, max: 32, step: 1 }, 'ndf.bottomTypeCorrelation': { min: -1.5, max: 1.5, step: 0.01 }, 'ndf.heightCells': { min: 1, max: 32, step: 1 },
  'ndf.gateCells': { min: 1, max: 32, step: 1 },
  'ndf.minHeight': { min: 0, max: 1, step: 0.01 }, 'ndf.maxHeight': { min: 0, max: 1, step: 0.01 }, 'ndf.heightVariation': { min: 0, max: 0.5, step: 0.01 }, 'ndf.footprint': { min: 0, max: 1, step: 0.01 },
  'ndf.tileMeters': { min: 2000, max: 64000, step: 500 },
  'hzd.typeBias': { min: -1, max: 1, step: 0.01 }, 'hzd.extinction': { min: 0.05, max: 2, step: 0.01 },
  'hzd.tableTypeStratus': { min: 0, max: 1, step: 0.01 }, 'hzd.tableTypeStratocumulus': { min: 0, max: 1, step: 0.01 }, 'hzd.tableTypeCumulus': { min: 0, max: 1, step: 0.01 },
  'hzd.tableFloor': { min: 0, max: 0.9, step: 0.005 }, 'hzd.bottomTypeBias': { min: -1, max: 1, step: 0.01 }, 'hzd.bottomTypeVariation': { min: 0, max: 1, step: 0.01 }, 'hzd.layerBottom': { min: 0, max: 6000, step: 10 }, 'hzd.layerTop': { min: 500, max: 14000, step: 10 },
  'hzd.topRound': { min: 0, max: 1, step: 0.01 }, 'hzd.heightFromCoverage': { min: 0, max: 1, step: 0.01 }, 'hzd.heightCoverageRef': { min: 0.01, max: 1, step: 0.01 },
  'hzd.baseLump': { min: 0, max: 0.15, step: 0.001 }, 'hzd.baseFadeMin': { min: 0, max: 1, step: 0.01 }, 'hzd.baseFadeHeight': { min: 0.001, max: 1, step: 0.01 },
  'hzd.mipBias': { min: -2, max: 4, step: 0.05 }, 'hzd.densityPow': { min: 0.1, max: 2, step: 0.01 }, 'hzd.shapeContrast': { min: 0, max: 3, step: 0.01 },
  'hzd.coverageDensityPow': { min: 0, max: 4, step: 0.01 }, 'hzd.coverageDensityRef': { min: 0.01, max: 1, step: 0.01 },
  'hzd.noiseCarve': { min: 0, max: 3, step: 0.01 }, 'hzd.noiseFine': { min: 0, max: 3, step: 0.01 }, 'hzd.noiseSmooth': { min: 0, max: 0.3, step: 0.001 },
  'hzd.n3Tile': { min: 50, max: 4000, step: 10 }, 'hzd.n3Strength': { min: 0, max: 3, step: 0.01 }, 'hzd.n3StratusType': { min: 0, max: 1, step: 0.01 },
  'hzd.n3HhfDistance': { min: 0, max: 5000, step: 10 }, 'hzd.n3Sharpen': { min: 0, max: 1, step: 0.01 }, 'hzd.n3Curl': { min: 0, max: 3, step: 0.01 }, 'hzd.n3ShapeTile': { min: 500, max: 20000, step: 100 },
  'hzd.erosionStrength': { min: 0, max: 1, step: 0.01 }, 'hzd.wispyHeight': { min: 0.01, max: 1, step: 0.01 }, 'hzd.wispyStrength': { min: 0, max: 1, step: 0.01 },
  'hzd.bottomCurl': { min: 0, max: 5, step: 0.01 }, 'hzd.bottomCurlDown': { min: 0, max: 1, step: 0.01 }, 'hzd.bottomErosion': { min: 0, max: 1, step: 0.01 },
  'hzd.lobeStrength': { min: 0, max: 1.5, step: 0.01 }, 'hzd.lobeFull': { min: 0, max: 1, step: 0.01 }, 'hzd.lobeCoverage': { min: 0, max: 1, step: 0.01 },
  'hzd.veilWidth': { min: 0, max: 0.3, step: 0.001 }, 'hzd.veilDensity': { min: 0, max: 0.2, step: 0.001 }, 'hzd.veilHeight': { min: 0.01, max: 1, step: 0.01 },
  'hzd.veilWisp': { min: 0, max: 8, step: 0.1 }, 'hzd.skirtTrail': { min: -2000, max: 2000, step: 10 }, 'hzd.skirtPeak': { min: 0.001, max: 0.5, step: 0.001 },
  'hzd.skirtGap': { min: 0, max: 0.95, step: 0.01 },
  'hzd.ringStart': { min: 0, max: 60000, step: 500 }, 'hzd.ringEnd': { min: 1000, max: 120000, step: 500 }, 'hzd.ringCoverage': { min: 0, max: 1, step: 0.01 },
  'hzd.ringType': { min: 0, max: 1, step: 0.01 }, 'hzd.ringFadeStart': { min: 0, max: 1, step: 0.01 },
  'ndf.paintCoverage': { min: 0, max: 1, step: 0.01 }, 'ndf.paintTypes': { min: 0, max: 1, step: 0.01 }, 'ndf.paintHeights': { min: 0, max: 1, step: 0.01 },
  'hzd.ndfDrift': { min: 0, max: 2, step: 0.01 }, 'hzd.upwardBias': { min: 0, max: 1, step: 0.01 },
  'proc.maxSteps': { min: 16, max: 1024, step: 1 }, 'proc.fullLightingAlpha': { min: 0, max: 1, step: 0.01 }, 'proc.octaveDiffuse': { min: 0, max: 2, step: 0.01 },
  'shadow.advectRefreshMeters': { min: 2, max: 200, step: 1 }, 'shadow.refreshFrames': { min: 1, max: 96, step: 1 }, 'shadow.advectRefreshFrames': { min: 1, max: 96, step: 1 }, 'shadow.advectBlendFrames': { min: 0, max: 96, step: 1 }, 'shadow.advectSpeed': { min: 0, max: 3, step: 0.05 },
  'sky.resolutionScale': { min: 0.25, max: 1.5, step: 0.05 }, 'sky.historySharpFrom': { min: 0, max: 8, step: 0.05 }, 'sky.historySharpFull': { min: 0, max: 16, step: 0.05 }, 'sky.historySharpWindFrom': { min: 0, max: 4, step: 0.01 }, 'sky.historySharpWindFull': { min: 0, max: 8, step: 0.01 }, 'sky.temporalBlend': { min: 0.01, max: 1, step: 0.01 },
  'c.levelScaleDesktop': { min: 0.1, max: 1, step: 0.01 }, 'c.levelScaleLaptop': { min: 0.1, max: 1, step: 0.01 }, 'c.upscaleSharpness': { min: 0, max: 1, step: 0.05 },
  'c.animSpeed': { min: 0, max: 50, step: 0.1 }, 'c.hazeBase': { min: -2000, max: 5000, step: 10 },
  // FX1: the light settings the Review section and the URL set live get full ranges (a guessed range clamped them: LH1's 1 read back as 0.6).
  'c.ambientStrength': { min: 0, max: 3, step: 0.01 }, 'c.ambientSaturation': { min: 0, max: 1, step: 0.01 }, 'c.ambientWarmth': { min: 0, max: 1, step: 0.01 },
  'c.diffuseSun': { min: 0, max: 2, step: 0.01 }, 'c.diffuseFalloff': { min: 0, max: 1, step: 0.005 }, 'c.ambientFloor': { min: 0, max: 1, step: 0.01 },
  'cirrus.altitude': { min: 5000, max: 14000, step: 50 }, 'cirrus.coverage': { min: 0, max: 1, step: 0.01 }, 'cirrus.mapScale': { min: 1, max: 32, step: 0.5 }, 'cirrus.mapCoverageGain': { min: 0, max: 3, step: 0.05 }, 'cirrus.mapTypeRange': { min: 0, max: 0.6, step: 0.01 },
  'ndf.cirrusCells': { min: 1, max: 16, step: 1 }, 'ndf.cirrusTypeCells': { min: 1, max: 16, step: 1 }, 'ndf.cirrusContrast': { min: 0, max: 4, step: 0.05 },
};

// --- Groups, in pipeline order. `about` is the group's one-line explanation. ---
const GROUPS: { title: string; about: string; keys: string[] }[] = [
  { title: 'Weather map (NDF)', about: 'The 2D map that says where clouds are and what kind: coverage, the top type (stratus 0 .. cumulus 1), the bottom type (F2: varies by area, crisp bases under cumulus, soft under stratiform), and each column\'s base and top height. One 32 km tile at 1024^2 (F2; 16 km at 512^2 with every cell count halved is the old tile). Generated from noise (changing these regenerates it). The overall coverage is the sidebar\'s coverage slider (it drives the coverage bias).',
    keys: ['ndf.seed', 'ndf.tileMeters', 'ndf.resolution', 'ndf.coverageCells', 'ndf.islandCells', 'ndf.islandWeight', 'ndf.coverageLo', 'ndf.coverageHi', 'ndf.footprint', 'ndf.worleyCells',
      'ndf.typeCells', 'ndf.typeMin', 'ndf.typeMax', 'hzd.typeBias', 'ndf.bottomType', 'ndf.bottomTypeRange', 'ndf.bottomTypeCells', 'ndf.bottomTypeCorrelation', 'ndf.minHeight', 'ndf.maxHeight', 'ndf.heightVariation', 'ndf.heightCells',
      'ndf.recipe', 'ndf.gateCells', 'ndf.gateLo', 'ndf.gateHi', 'ndf.footLo', 'ndf.footHi', 'ndf.islandGain', 'ndf.typeContrast', 'ndf.cirrusCells', 'ndf.cirrusTypeCells', 'ndf.cirrusContrast', 'ndf.image', 'ndf.heightImage', 'ndf.maskImage', 'ndf.paintBlend', 'ndf.paintCoverage', 'ndf.paintTypes', 'ndf.paintHeights'] },
  { title: 'Cloud types and height profiles', about: 'How tall the layer is and, with profileMode nutshell, the shape of each type\'s height gradient (the Nutshell trapezoids for stratus, stratocumulus and cumulus): how types blend, how round the tops are. Also where the base fades in. The default profile is the tables (next groups).',
    keys: ['hzd.layerBottom', 'hzd.layerTop', 'hzd.typeBlend', 'hzd.topRound', 'hzd.profileSmooth', 'hzd.heightFromCoverage', 'hzd.heightCoverageRef', 'hzd.baseFadeMin', 'hzd.baseFadeHeight', 'hzd.baseLump'] },
  { title: 'Shape noise and the coverage remap', about: 'The 3D low-frequency noise that forms the bodies, and how coverage carves it (cloud where noise x gradient > 1 - coverage). Also the density and the build stage, to compare with GPU Pro 7\'s figures.',
    keys: ['hzd.stage', 'hzd.extinction', 'hzd.shapeTile', 'hzd.shapeContrast', 'hzd.shapeCubicDistance', 'hzd.coverageMultiply', 'hzd.densityPow', 'hzd.coverageDensityPow', 'hzd.coverageDensityRef', 'hzd.mipBias',
      'hzd.noiseFormat', 'hzd.noiseCarve', 'hzd.noiseFine', 'hzd.noiseSmooth', 'hzd.noiseSupersample'] },
  { title: 'Erosion and detail', about: 'The small Worley noise that eats into the edges: billowy on top, wispy at the bottom (curl-distorted), how strong and in which order, plus the optional middle "lobe" rung between body and grain.',
    keys: ['hzd.erosionLaw', 'hzd.erosionOrder', 'hzd.erosionStrength', 'hzd.wispyHeight', 'hzd.wispyStrength', 'hzd.detailTile', 'hzd.detailRecipe', 'hzd.detailCubicDistance', 'hzd.detailDistance',
      'hzd.curlTile', 'hzd.curlStrength', 'hzd.bottomCurl', 'hzd.bottomCurlDown', 'hzd.bottomErosion', 'hzd.lobeStrength', 'hzd.lobeTile', 'hzd.lobeFull', 'hzd.lobeCoverage', 'hzd.lobeCubic'] },
  { title: 'Erosion noise: Nubis Cubed', about: 'N1: noiseSet nubis3 erodes with Guerrilla\'s Nubis Cubed noise (the pack\'s Alligator billows and Curly-Alligator wisps, the voxel clouds\' up-rez noise) instead of the HZD Worley detail, with the deck\'s up-rez: frequency over the coarse density, wispy below wispyHeight and in stratus, billowy above, the HHF fold near the camera, then the sharpen. The HZD noise stays selectable (noiseSet hzd). The erosion order above still applies. shapeNoise nubis3 (step 2) also takes the shape noise\'s dilating fBM from the pack\'s billows.',
    keys: ['hzd.noiseSet', 'hzd.n3Tile', 'hzd.n3Strength', 'hzd.n3StratusType', 'hzd.n3HhfDistance', 'hzd.n3Sharpen', 'hzd.n3Curl', 'hzd.shapeNoise', 'hzd.n3ShapeTile'] },
  { title: 'Connective veil and skirts', about: 'Thin material between and below the bodies: H6\'s veil (a dilated shell around the lower flanks) or H7\'s skirts (a flat, wispy skirt that trails downwind of each body). Veil width 0 turns it off (and saves its cost).',
    keys: ['hzd.skirtMode', 'hzd.veilWidth', 'hzd.veilDensity', 'hzd.veilHeight', 'hzd.veilWisp', 'hzd.veilNoise', 'hzd.veilDistance', 'hzd.skirtTrail', 'hzd.skirtTrailWidth', 'hzd.skirtStretch', 'hzd.skirtPeak', 'hzd.skirtScale', 'hzd.skirtGap'] },
  { title: 'Cloud types: profile tables', about: 'Nubis Evolved\'s top type x bottom type profile tables (F2: the default; profileMode nutshell with extinction 0.5 is H6): crisp or ragged bases from the map\'s bottom type, rounded or tiered tops (towering cumulus with tableTypeCumulus 0.6-0.75). Read from a storage buffer (tableSource; F1\'s uniform array was 2-4 ms slower). The bottom-type bias and variation here are F1\'s shader stopgap, 0 now that the map carries the bottom type.',
    keys: ['hzd.profileMode', 'hzd.tableSource', 'hzd.tableTypeStratus', 'hzd.tableTypeStratocumulus', 'hzd.tableTypeCumulus', 'hzd.bottomTypeBias', 'hzd.bottomTypeVariation', 'hzd.bottomTypeTile', 'hzd.tableFloor'] },
  { title: 'Storms and anvils', about: 'F1 + STORM1: cumulonimbus. stormStrength > 0 turns a storm on: its area is the map\'s storm channel (stormSource map: the generated default blob, ndf.stormBlob, or the painter\'s storm channel) or F1\'s placed cell (stormSource cell). Storms can also come from the map\'s type (stormTypeStart < 1). Anvil: Nubis 2017 exponent, Häggström flattening, a sheared plate downwind (anvilSpread, anvilShear) and the anvil cirrus. Lighting: denser and darker, optional internal lightning.',
    keys: ['hzd.stormStrength', 'hzd.stormSource', 'ndf.stormBlob', 'ndf.stormX', 'ndf.stormZ', 'ndf.stormRadius', 'hzd.stormX', 'hzd.stormZ', 'hzd.stormRadius', 'hzd.stormTop', 'hzd.anvilSpread', 'hzd.anvilShear', 'hzd.stormTypeStart', 'hzd.anvilBias', 'hzd.anvilClamp', 'hzd.anvilFlatten', 'hzd.anvilDensityFix',
      'hzd.stormAnvilShape', 'hzd.stormRotation', 'hzd.anvilCirrus', 'hzd.anvilCirrusLength', 'hzd.anvilCirrusDepth', 'hzd.anvilCirrusFiber', 'hzd.stormDensity', 'hzd.stormDark', 'hzd.stormGlow', 'hzd.stormFlashRate'] },
  { title: 'Mid-level layer and low deck', about: 'F1: two extra sheets. The mid slot (altocumulus or altostratus, around 5.4 km) and the low deck slot (stratus, around 600 m). Each picks off, altocumulus, altostratus or stratus. L3: midLayerMode draws the mid slot as the volume, as the 2.5D thin-cloud layer (type and coverage from the weather map), or as a hybrid that fades the volume into the layer with distance so no clip line shows.',
    keys: ['hzd.midForm', 'hzd.midBottom', 'hzd.midThickness', 'hzd.midCoverage', 'hzd.midCellSize', 'hzd.midElongation', 'hzd.midExtinction', 'hzd.midErosion',
      'hzd.midLayerMode', 'hzd.midLayerFadeStart', 'hzd.midLayerFadeEnd', 'hzd.midLayerNdf', 'hzd.midLayerOpticalDepth', 'hzd.midLayerCoverageBoost',
      'hzd.deckForm', 'hzd.deckBottom', 'hzd.deckThickness', 'hzd.deckCoverage', 'hzd.deckCellSize', 'hzd.deckElongation', 'hzd.deckExtinction', 'hzd.deckErosion'] },
  { title: 'Fractus', about: 'F1: ragged shreds that leave each cloud\'s belly and trail downwind (fractusDensity > 0; try 0.2). Tops stay crisp.',
    keys: ['hzd.fractusDensity', 'hzd.fractusTrail', 'hzd.fractusDrop', 'hzd.fractusBelly', 'hzd.fractusScale', 'hzd.fractusCurl', 'hzd.fractusTaps', 'hzd.fractusDistance'] },
  { title: 'The horizon ring', about: 'HZD 2015 s45: far away (15-35 km) the map is pulled toward cumulus at about half cover so the horizon always has interesting clouds, and nothing is drawn past the ring\'s end. Ring start 0 turns it off.',
    keys: ['hzd.ringStart', 'hzd.ringEnd', 'hzd.ringCoverage', 'hzd.ringType', 'hzd.ringFadeStart'] },
  { title: 'Wind and motion', about: 'Which way the wind blows, how far the tops lean, and how the map and the noise move with time (the sidebar\'s motion sets the speed; 0 freezes everything).',
    keys: ['hzd.windDirection', 'hzd.cloudTopOffset', 'hzd.upwardBias', 'hzd.ndfMotion', 'hzd.ndfDrift', 'hzd.shapeSpeed', 'hzd.detailSpeed', 'c.animSpeed', 'c.windVelocity', 'sky.temporalCloudMotion'] },
  { title: 'Ray march', about: 'How each pixel\'s ray steps through the layer: step size and count, how far it goes, PF1 empty-space skipping from the weather map\'s bounds, the sky layer\'s resolution and the temporal blend that cleans the noise up over frames.',
    keys: ['proc.stepMeters', 'proc.maxSteps', 'proc.maxDistance', 'hzd.emptySkip', 'hzd.emptySkipCoverage', 'sky.resolutionScale', 'sky.temporal', 'sky.temporalBlend', 'sky.historyFilter', 'sky.historySharpFrom', 'sky.historySharpFull', 'sky.historySharpWindFrom', 'sky.historySharpWindFull', 'sky.transmittanceCutoff'] },
  { title: 'Render level (upscaler)', about: 'U2: cinematic renders the sky layer at its own resolution (sky.resolutionScale, the pre-U2 path). desktop and laptop render it at a reduced size (levelScaleDesktop 0.5, levelScaleLaptop 0.25 of the output) and the owner\'s upscaler (@pmndrs/upscaler, temporal path) brings it to full size; the composite then merges it over the scene at full size. The sidebar\'s Review section has the same switch (U2).',
    keys: ['c.renderLevel', 'c.levelScaleDesktop', 'c.levelScaleLaptop', 'c.upscalePath', 'c.upscaleSharpness'] },
  { title: 'Light: the procedural model', about: 'The lighting the procedural trace computes per sample: the model (octave = Frostbite / Takram octaves, nubis = our N3 model), the profile source for nubis (lightProfile: exact = coverage x height gradient and f/|grad f| depth as NE22; standin = the old proxy), the sun taps, powder, the two-lobe phase, the sky ambient and the diffusion tail.',
    keys: ['proc.lightingModel', 'hzd.lightProfile', 'proc.densityScale', 'proc.lightScale', 'proc.lightTaps', 'proc.fullLightingAlpha', 'proc.profileDepth', 'proc.powderScale', 'proc.octavePhase', 'proc.ambientGain', 'proc.octaveDiffuse'] },
  { title: 'Light: renderer settings', about: 'Renderer-wide light settings the procedural trace shares with the voxel clouds: the sky ambient and the ground bounce, the phase for the nubis model, the haze toward the horizon and the cloud shadow on the ground. Some act only in the nubis lighting model.',
    keys: ['c.ambientStrength', 'c.ambientFloor', 'c.ambientSkyBias', 'c.ambientSaturation', 'c.ambientWarmth', 'c.diffuseSun', 'c.diffuseFalloff', 'c.groundAlbedo', 'c.msStrength', 'c.microShadow', 'c.phaseModel', 'c.phaseG', 'c.silverG', 'c.silverStrength',
      'c.hazeDensity', 'c.hazeHeight', 'c.hazeBase', 'c.shadowStrength', 'c.compositeShadow', 'shadow.advect', 'shadow.advectSpeed', 'shadow.advectRefreshFrames', 'shadow.advectBlendFrames', 'shadow.advectContinuous', 'shadow.advectSnap', 'shadow.advectBlendFilter', 'shadow.advectRefreshMeters', 'shadow.refreshFrames'] },
  { title: 'High cirrus layer', about: 'The 2.5D cirrus slab above the volume (NE 2022 p.64-68): streaky, wispy or round (cirrocumulus), with an optional cirrostratus veil and halo. Off by default.',
    keys: ['cirrus.enabled', 'cirrus.altitude', 'cirrus.thickness', 'cirrus.coverage', 'cirrus.type', 'cirrus.veil', 'cirrus.opticalDepth', 'cirrus.scale', 'cirrus.detail', 'cirrus.coverageVariation', 'cirrus.source', 'cirrus.mapScale', 'cirrus.mapCoverageGain', 'cirrus.mapTypeRange', 'cirrus.coverageFadeNe22', 'cirrus.halo', 'cirrus.shadowStrength', 'cirrus.windVelocity', 'cirrus.animSpeed'] },
  { title: 'Debug', about: 'Diagnostic views: the procedural trace\'s step count, hit distance or profile, the sky layer\'s own views, or one lighting term at a time.',
    keys: ['proc.debug', 'sky.debug', 'sky.freezeCycle', 'c.lightDebug'] },
];
/** Every setting the panel shows, as `<source>.<key>`. */
export const TUNED_KEYS = GROUPS.flatMap(g => g.keys);

const split = (k: string) => { const i = k.indexOf('.'); return [k.slice(0, i) as SourceId, k.slice(i + 1)] as const; };

export function createHzdTuner(host: HzdTuneHost) {
  // The starting values: taken once the page has built the sky, before the URL's overrides (so the amber names show what a link changed).
  let base: Record<string, unknown> = {};
  const get = (k: string) => { const [s, key] = split(k); return host.sources[s][key]; };
  const set = (k: string, v: unknown) => { const [s, key] = split(k); if (key in host.sources[s]) host.sources[s][key] = clone(v); };
  const changes = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of TUNED_KEYS) if (k in base && !same(get(k), base[k])) out[k] = clone(get(k));
    return out;
  };
  const snapshot = (): HzdPreset => ({ view: clone(host.view()), ref: host.ref(), settings: changes(), savedAt: new Date().toISOString() });
  const toBase = () => { for (const [k, v] of Object.entries(base)) set(k, v); };
  const apply = (p: HzdPreset) => {
    toBase();
    for (const [k, v] of Object.entries(p.settings ?? {})) set(k, v);
    if (p.view) host.applyView(p.view);
    if (p.ref !== undefined) host.setRef(p.ref);
    host.onChange('*'); panel.refresh();
  };
  const panel = createTunePanel<HzdPreset>({
    title: 'Tune the HZD sky (T)', storeKey: STORE,
    resetTip: 'back to the starting value (the code default)', resetAllTitle: 'reset every setting to the starting values',
    snapshot, apply,
    resetAll: () => { toBase(); host.onChange('*'); panel.refresh(); panel.say('back to the starting values'); },
    defaultName: () => `${host.view().name} ${new Date().toLocaleTimeString()}`,
    exportName: () => `hzd-${host.view().name}`,
    presetLabel: (name, p) => `${name} · ${p.view?.name ?? ''} · ${Object.keys(p.settings ?? {}).length} changed`,
    isPreset: data => !!(data as HzdPreset).settings && !!(data as HzdPreset).savedAt,
    extraTools: (tools, say) => {
      tools.addButton({ title: 'copy link to this view and settings' }).on('click', () => {
        navigator.clipboard.writeText(location.href).then(() => say('link copied')).catch(() => { console.log(location.href); say('copy failed: the link is in the console'); });
      });
    },
  });

  let built = false;
  const build = () => {
    for (const g of GROUPS) {
      const keys = g.keys.filter(k => { const [s, key] = split(k); return key in host.sources[s]; });
      if (!keys.length) continue;
      const f: FolderApi = panel.addGroup(g.title, g.about);
      for (const k of keys) {
        const [s, key] = split(k);
        panel.bindSetting(f, host.sources[s], key, {
          base: () => base[k], doc: DOCS[s][key], union: UNIONS[s][key], mode: MODES[k], switch: SWITCHES.has(k), boolDropdown: true, range: RANGES[k],
          onChange: () => host.onChange(k),
        });
      }
    }
    built = true;
  };

  return {
    toggle: panel.toggle,
    refresh: () => panel.refresh(),
    /** Called once the sky is built: the starting values for "changed" and reset; builds the panel. */
    start() {
      base = Object.fromEntries(TUNED_KEYS.filter(k => { const [s, key] = split(k); return key in host.sources[s]; }).map(k => [k, clone(get(k))]));
      if (!built) build();
      panel.refresh();
    },
    /** The settings that differ from the starting values, as `<source>.<key>` -> value (the page writes them to the URL). */
    changes,
    set: (k: string, v: unknown) => { set(k, v); panel.refresh(); },
    snapshot,
    apply,
  };
}
