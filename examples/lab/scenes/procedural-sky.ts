// X3: opt a lab page into the procedural sky (?model=procedural|hybrid). The procedural model is not in the core entry; it is imported from source,
// with Takram's textures from node_modules as a dev-time stand-in (see packages/runtime/src/procedural/NOTICE.md).
//   ?model=hybrid       the page's voxel volume (heroes, stamps, its generated field) inside a procedural cumulus sky
//   ?model=procedural   the procedural sky only (the page's voxel volume stays bound but is not marched)
//   ?light=octave|nubis the procedural lighting model (default octave)   ?vlight=nubis|octave the voxel field's (default nubis)
//   ?proc_<key>=N / ?tk_<key>=N  override a procedural / Takram-shaper setting (numbers), e.g. ?proc_boxCarve=400 ?tk_coverage=0.4
import { attachProceduralClouds, type ProceduralClouds } from '../../../packages/runtime/src/procedural';
import tkShapeUrl from '../../../node_modules/@takram/three-clouds/assets/shape.bin?url';
import tkShapeDetailUrl from '../../../node_modules/@takram/three-clouds/assets/shape_detail.bin?url';
import tkLocalWeatherUrl from '../../../node_modules/@takram/three-clouds/assets/local_weather.png?url';
import tkTurbulenceUrl from '../../../node_modules/@takram/three-clouds/assets/turbulence.png?url';

type Runtime = Parameters<typeof attachProceduralClouds>[0] & { settings: { lightingModel: 'nubis' | 'octave' | 'fit' } };

/** Reads ?model / ?light / ?vlight / ?proc_* / ?tk_*. Returns null when the page stays on the NVDF path. */
export async function attachProceduralSky(runtime: Runtime, device: GPUDevice, query: URLSearchParams, defaults: { boxCarve?: number } = {}): Promise<ProceduralClouds | null> {
  if (query.get('vlight') === 'octave') runtime.settings.lightingModel = 'octave';
  const model = query.get('model');
  if (model !== 'procedural' && model !== 'hybrid') return null;
  const proc = await attachProceduralClouds(runtime, device, {
    model, urls: { takram: { shape: tkShapeUrl, shapeDetail: tkShapeDetailUrl, localWeather: tkLocalWeatherUrl, turbulence: tkTurbulenceUrl } },
    settings: { lightingModel: query.get('light') === 'nubis' ? 'nubis' : 'octave', boxCarve: defaults.boxCarve ?? 0 },
  });
  const num = (o: object, k: string, v: string) => { if (typeof (o as Record<string, unknown>)[k] === 'number') (o as Record<string, number>)[k] = Number(v); };
  for (const [k, v] of query) {
    if (k.startsWith('proc_')) num(proc.settings, k.slice(5), v);
    if (k.startsWith('tk_')) num(proc.settings.takram, k.slice(3), v);
  }
  return proc;
}
