import { PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { createCloudscapeAtlas } from '../../../../packages/three/src/sources/cloudscape-atlas';
import { type DenseDensityField } from '../../../../packages/three/src/sources/density';
import { type createReferenceCloud } from '../../../../packages/three/src/volumetric';
import { createBlendedField } from '../../../../experiments/lod/reference';
import { compareOpticalImages, evaluateOpticalMetrics, DEFAULT_OPTICAL_GATES, type OpticalImageMetrics, type OpticalMetricEvaluation } from '../../../../experiments/lod/image-metrics';

const SIZE = 320;
const DISTANCES = [12_000, 4_000] as const;
const ANGLES = [20, 90] as const;
const BOUNDS = { min: [-1200, 700, -1000] as [number, number, number], max: [1200, 2700, 1000] as [number, number, number] };
const ATLAS_48 = createCloudscapeAtlas(48);

type Cloud = ReturnType<typeof createReferenceCloud>;
type Comparison = { name: string; payloadBytes: number; metrics: OpticalImageMetrics; gate: OpticalMetricEvaluation; usableAtThisPose: boolean };
type Pose = { distanceMetres: number; angleDegrees: number; convergence: OpticalImageMetrics; converged: boolean; comparisons: Comparison[] };

/** Extract one 48³ source tile from the production 2×2×2 atlas (X is fastest). */
export function extractAtlasField(tileIndex: number): DenseDensityField {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex > 7) throw new RangeError('Atlas tile index must be an integer from 0 to 7.');
  const size = 48;
  const tileX = tileIndex & 1;
  const tileY = (tileIndex >> 1) & 1;
  const tileZ = (tileIndex >> 2) & 1;
  const data = new Uint8Array(size ** 3);
  const atlasSize = size * 2;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const source = (tileX * size + x) + (tileY * size + y) * atlasSize + (tileZ * size + z) * atlasSize * atlasSize;
    data[x + y * size + z * size * size] = ATLAS_48.data[source];
  }
  return {
    descriptor: { id: `placeholder-${tileIndex}`, revision: 1, dimensions: [size, size, size], bounds: BOUNDS, extinctionScale: 0.003, encoding: 'r8unorm' },
    data,
  };
}

/** Box-average X and Z by two while retaining the full vertical resolution. */
export function coarsenDensityField(source: DenseDensityField): DenseDensityField {
  const [sx, sy, sz] = source.descriptor.dimensions;
  if (source.descriptor.encoding !== 'r8unorm' || !(source.data instanceof Uint8Array) || ![sx, sy, sz].every(n => Number.isSafeInteger(n) && n > 0) || sx < 2 || sz < 2 || sx % 2 !== 0 || sz % 2 !== 0 || source.data.length !== sx * sy * sz) throw new RangeError('Density field must be a complete r8unorm payload with positive integer dimensions and even X/Z dimensions.');
  const dimensions: [number, number, number] = [sx / 2, sy, sz / 2];
  const data = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);
  for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < dimensions[0]; x++) {
    const base = (x * 2) + y * sx + (z * 2) * sx * sy;
    const average = (source.data[base] + source.data[base + 1] + source.data[base + sx * sy] + source.data[base + sx * sy + 1]) / 4;
    data[x + y * dimensions[0] + z * dimensions[0] * sy] = Math.round(average);
  }
  return { descriptor: { ...source.descriptor, dimensions }, data };
}

/**
 * Fixed, unlit optical audit. The caller owns suspension and restoration of
 * scene, camera, cloud fields, and renderer state after this diagnostic run.
 */
export async function runDensityAudit(args: {
  renderer: WebGPURenderer; scene: Scene; reference: Cloud; candidate: Cloud;
  fields: DenseDensityField[]; cancelled: () => boolean; progress: (text: string) => void;
}) {
  const { reference, candidate } = args;
  if (args.fields.length === 0) throw new Error('Density audit requires at least one source field.');
  const camera = new PerspectiveCamera(42, 1, 0.1, 100_000);
  camera.coordinateSystem = args.renderer.coordinateSystem;
  reference.resize(SIZE, SIZE); candidate.resize(SIZE, SIZE);
  for (const cloud of [reference, candidate]) {
    cloud.settings.densityMultiplier = 1; cloud.settings.castShadow = false; cloud.settings.receiveShadow = false; cloud.settings.constantLight = true;
    cloud.settings.occupancy = false; cloud.settings.lightSteps = 1;
  }
  const convergenceLimits = { maxAbsT: 0.002, supportMeanAbsT: 0.0005 };
  const sources = args.fields.map((field, index) => ({ name: field.descriptor.id || `source-${index}`, field }));
  const reports: Array<{ source: string; fixture: DenseDensityField['descriptor']; rows: Pose[]; support: { referenceSupportCount: number; inconclusiveRows: number; failedRows: number }; halfBlend: { supported: boolean; comparisons: Comparison[] } }> = [];
  let poseNumber = 0;
  for (const source of sources) {
    const coarse = coarsenDensityField(source.field);
    const arms: Array<{ name: string; field: DenseDensityField }> = [{ name: `native-${coarse.descriptor.dimensions.join('x')}`, field: coarse }];
    const halfBlendField = createBlendedField(coarse, source.field, 0.5);
    arms.push({ name: 'single-density-half', field: halfBlendField });
    const halfBlendSupported = true;
    const rows: Pose[] = [];
    const halfBlend: Comparison[] = [];
    for (const distanceMetres of DISTANCES) for (const angleDegrees of ANGLES) {
      if (args.cancelled()) throw new Error('Density audit cancelled.');
      const angle = angleDegrees * Math.PI / 180;
      camera.position.set(Math.sin(angle) * distanceMetres, 1700, Math.cos(angle) * distanceMetres);
      camera.lookAt(0, 1700, 0); camera.updateProjectionMatrix();
      reference.setField(source.field); reference.settings.viewSteps = 256; reference.render(args.scene, camera, false);
      const baseline = await reference.readOptical();
      reference.settings.viewSteps = 512; reference.render(args.scene, camera, false);
      const dense = await reference.readOptical();
      const convergence = compareOpticalImages(dense, baseline, SIZE, SIZE);
      const converged = convergence.maxAbsT <= convergenceLimits.maxAbsT && convergence.supportMeanAbsT <= convergenceLimits.supportMeanAbsT;
      const comparisons: Comparison[] = [];
      ++poseNumber;
      for (const arm of arms) {
        if (args.cancelled()) throw new Error('Density audit cancelled.');
        args.progress(`${poseNumber}/${sources.length * DISTANCES.length * ANGLES.length} poses · ${source.name} · ${distanceMetres / 1000} km · ${angleDegrees}° · ${arm.name}`);
        candidate.setField(arm.field); candidate.settings.viewSteps = 512; candidate.render(args.scene, camera, false);
        const metrics = compareOpticalImages(dense, await candidate.readOptical(), SIZE, SIZE);
        const gate = evaluateOpticalMetrics(metrics);
        const comparison = { name: arm.name, payloadBytes: arm.field.data.byteLength, metrics, gate, usableAtThisPose: converged && gate.passed && !gate.inconclusive };
        comparisons.push(comparison);
        if (arm.name === 'single-density-half') halfBlend.push(comparison);
      }
      rows.push({ distanceMetres, angleDegrees, convergence, converged, comparisons });
    }
    const referenceSupportCount = rows.reduce((sum, row) => sum + Math.max(...row.comparisons.map(c => c.metrics.referenceSupportCount), 0), 0);
    reports.push({ source: source.name, fixture: source.field.descriptor, rows, support: { referenceSupportCount, inconclusiveRows: rows.filter(row => row.comparisons.some(c => c.gate.inconclusive)).length, failedRows: rows.filter(row => row.comparisons.some(c => !c.gate.passed && !c.gate.inconclusive)).length }, halfBlend: { supported: halfBlendSupported, comparisons: halfBlend } });
  }
  return {
    version: 1, date: new Date().toISOString(), renderSize: [SIZE, SIZE], fovDegrees: 42,
    distancesMetres: [...DISTANCES], anglesDegrees: [...ANGLES], center: [0, 1700, 0], bounds: BOUNDS,
    selfShadowing: false, constantLight: true, densityMultiplier: 1, temporalHistory: false, viewSteps: [256, 512], convergenceLimits,
    gates: DEFAULT_OPTICAL_GATES, sources: reports,
    limitations: 'Unlit discrete optical audit of supplied density fields; sources are candidates, not calibrated real atmosphere. State is restored by the caller. Failed and inconclusive gates remain visible in each row.',
  };
}

export type DensityAuditReport = Awaited<ReturnType<typeof runDensityAudit>>;
