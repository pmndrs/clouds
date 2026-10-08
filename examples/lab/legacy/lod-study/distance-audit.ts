import { PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { type createReferenceCloud } from '@clouds/legacy-three';
import { createBlendedField, volumeAverage, volumeAverageAxes, type LodField } from '../../../../experiments/lod/reference';
import { compareOpticalImages, evaluateOpticalMetrics, DEFAULT_OPTICAL_GATES, type OpticalImageMetrics, type OpticalMetricEvaluation } from '../../../../experiments/lod/image-metrics';

type Cloud = ReturnType<typeof createReferenceCloud>;
type Comparison = { name: string; directRepresentation: boolean; payloadBytes: number; metrics: OpticalImageMetrics; gate: OpticalMetricEvaluation; usableAtThisPose: boolean };
type AuditRow = { distanceMetres: number; angleDegrees: number; convergence: OpticalImageMetrics; converged: boolean; endpointMaxAbsT: number; comparisons: Comparison[] };
const DISTANCES = [20_000, 12_000, 8_000, 4_000, 1_000];
const ANGLES = [20, 90, 150];

/** Serial, fixed-pose audit. Caller suspends animation, controls and resizing. */
export async function runDistanceAudit(args: {
  renderer: WebGPURenderer; scene: Scene; reference: Cloud; candidate: Cloud;
  canonical: LodField; imageSize?: 320 | 640; cancelled: () => boolean; progress: (text: string) => void;
}) {
  const { reference, candidate, canonical } = args;
  const SIZE = args.imageSize ?? 320;
  if (![320, 640].includes(SIZE)) throw new Error("Unsupported audit image size.");
  const coarse16 = volumeAverage(canonical, 16);
  const coarse32 = volumeAverage(canonical, 32);
  const vertical32 = volumeAverageAxes(canonical, [32, 64, 32]);
  const arms = [
    { name: '16x16x16', field: coarse16, direct: true },
    { name: '32x32x32', field: coarse32, direct: true },
    { name: '32x64x32', field: vertical32, direct: true },
    { name: '32x32x32-half', field: createBlendedField(coarse32, canonical, .5), direct: false },
    { name: '32x64x32-half', field: createBlendedField(vertical32, canonical, .5), direct: false },
  ];
  const camera = new PerspectiveCamera(42, 1, .1, 100_000);
  camera.coordinateSystem = args.renderer.coordinateSystem;
  reference.resize(SIZE, SIZE); candidate.resize(SIZE, SIZE);
  reference.setField(canonical);
  const rows: AuditRow[] = [];
  const oldReferenceSteps = reference.settings.viewSteps;
  const oldCandidateSteps = candidate.settings.viewSteps;
  const checkCancelled = () => { if (args.cancelled()) throw new Error('Distance audit cancelled.'); };
  try {
    for (const distanceMetres of DISTANCES) for (const angleDegrees of ANGLES) {
      checkCancelled();
      const angle = angleDegrees * Math.PI / 180;
      camera.position.set(Math.sin(angle) * distanceMetres, 1_550 + distanceMetres * .08, Math.cos(angle) * distanceMetres);
      camera.lookAt(0, 1_550, 0); camera.updateProjectionMatrix();
      reference.settings.viewSteps = 256;
      reference.render(args.scene, camera, false);
      const baseline = await reference.readOptical();
      checkCancelled();
      reference.settings.viewSteps = 512;
      reference.render(args.scene, camera, false);
      const dense = await reference.readOptical();
      const convergence = compareOpticalImages(dense, baseline, SIZE, SIZE);
      // Declared independently of representation gates; failed convergence
      // prevents a coarse representation receiving an accepted measurement.
      const converged = convergence.maxAbsT <= .002 && convergence.supportMeanAbsT <= .0005;
      const comparisons: Comparison[] = [];
      for (const arm of arms) {
        checkCancelled();
        args.progress(`${rows.length + 1}/15 poses · ${distanceMetres / 1_000} km · ${angleDegrees}° · ${arm.name}`);
        candidate.settings.viewSteps = 256; candidate.setField(arm.field);
        candidate.render(args.scene, camera, false);
        const pixels = await candidate.readOptical();
        const metrics = compareOpticalImages(baseline, pixels, SIZE, SIZE);
        const gate = evaluateOpticalMetrics(metrics);
        comparisons.push({ name: arm.name, directRepresentation: arm.direct, payloadBytes: arm.field.data.byteLength, metrics, gate,
          usableAtThisPose: converged && gate.passed && !gate.inconclusive });
      }
      // Independent same-field endpoint control on the candidate runtime.
      candidate.setField(canonical); candidate.render(args.scene, camera, false);
      const endpoint = compareOpticalImages(baseline, await candidate.readOptical(), SIZE, SIZE);
      rows.push({ distanceMetres, angleDegrees, convergence, converged, endpointMaxAbsT: endpoint.maxAbsT, comparisons });
    }
  } finally {
    reference.settings.viewSteps = oldReferenceSteps;
    candidate.settings.viewSteps = oldCandidateSteps;
  }
  // Recommend only direct coarse fields that pass all tested angles at a distance.
  // A failed or unsupported row falls back to the canonical field, never hidden clouds.
  const selection = DISTANCES.map(distanceMetres => {
    const poses = rows.filter(row => row.distanceMetres === distanceMetres);
    const selected = arms.filter(arm => arm.direct).find(arm => poses.every(row => row.comparisons.find(value => value.name === arm.name)?.usableAtThisPose));
    return { distanceMetres, representation: selected?.name ?? '64x64x64',
      reason: selected ? 'Passes provisional optical gates at all three tested angles.' : 'No coarse candidate established; retain canonical density.' };
  });
  return {
    version: 1, date: new Date().toISOString(), renderSize: [SIZE, SIZE], fovDegrees: 42,
    selfShadowing: false, temporalHistory: false, viewSteps: [256, 512],
    convergenceLimits: { maxAbsT: .002, supportMeanAbsT: .0005 }, gates: DEFAULT_OPTICAL_GATES,
    fixture: canonical.descriptor, rows, selection,
    limitations: 'One bounded fixture at the recorded image size; provisional engineering gates, not human visual acceptance, performance evidence or a world LOD policy. CPU-blended arms retain full-size uploads.',
  };
}

export type DistanceAuditReport = Awaited<ReturnType<typeof runDistanceAudit>>;
