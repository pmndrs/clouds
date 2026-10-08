// P1-02 atmosphere test: atmosphereWgsl() against the sky's own numbers, on the real GPU.
//  - sunRadianceAt vs createSun({physical:true}) colour * intensity (5 % per channel) at ground and 2 km, several sun heights.
//  - skyAmbient upper hemisphere vs a brute-force cosine average of the sky's baked cube (independent of the LUT path),
//    and both hemispheres vs a CPU brute-force integral of the sky-view LUT readback.
//  - aerial perspective vs the analytic single-path transmittance of a horizontal ray, and direction vs uv entry points.
import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { atmosphereWgsl } from '../../../../packages/runtime/src/shaders/atmosphere.wgsl';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { sharedBackend } from '../../../../packages/three/src/gpu/backend';
import { createSkyBridge } from '../../flagship/sky-bridge';

const harness = installCloudsHarness();
const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

type V3 = [number, number, number];
const half = (h: number) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : e === 31 ? s * Infinity : s * (1 + m / 1024) * 2 ** (e - 15); };
const relErr = (a: number, ref: number, floor: number) => Math.abs(a - ref) / Math.max(Math.abs(ref), floor);
const fmt = (v: ArrayLike<number>) => Array.from(v).slice(0, 3).map(x => x.toPrecision(4)).join(', ');

const KERNEL = /* wgsl */ `
@group(1) @binding(0) var<storage, read_write> outBuf: array<vec4<f32>>;
struct Probe { pos: vec4<f32>, ap: vec4<f32> }   // pos.xyz world position; ap.xy uv, ap.z distance (m), ap.w unused
@group(1) @binding(1) var<uniform> probe: Probe;
@group(1) @binding(2) var cubeTex: texture_cube<f32>;
@group(1) @binding(3) var<uniform> viewDirIn: vec4<f32>;

fn cubeMean(sign: f32) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  let nr = 48; let na = 96;
  for (var i = 0; i < nr; i++) {
    let s2 = (f32(i) + 0.5) / f32(nr);           // sin^2(theta) uniform => cosine-weighted
    let sinT = sqrt(s2); let cosT = sqrt(1.0 - s2);
    for (var j = 0; j < na; j++) {
      let phi = (f32(j) + 0.5) * 6.28318530718 / f32(na);
      let d = vec3<f32>(sinT * cos(phi), sign * cosT, sinT * sin(phi));
      acc += textureSampleLevel(cubeTex, atmSampler, d, 0.0).rgb;
    }
  }
  return acc / f32(nr * na);
}

@compute @workgroup_size(1) fn main() {
  outBuf[0] = vec4<f32>(sunRadianceAt(probe.pos.xyz), 0.0);
  let a = skyAmbient(probe.pos.xyz);
  outBuf[1] = vec4<f32>(a.upper, 0.0);
  outBuf[2] = vec4<f32>(a.lower, 0.0);
  outBuf[3] = vec4<f32>(cubeMean(1.0), 0.0);
  outBuf[4] = vec4<f32>(cubeMean(-1.0), 0.0);
  outBuf[5] = atmAerialPerspectiveAt(probe.ap.xy, probe.ap.z);
  outBuf[6] = vec4<f32>(applyAerialPerspective(vec3<f32>(0.0), 0.0, viewDirIn.xyz, probe.ap.z), 0.0);   // pure in-scatter, direction entry
  outBuf[7] = vec4<f32>(applyAerialPerspective(vec3<f32>(1.0), 1.0, viewDirIn.xyz, probe.ap.z), 0.0);   // opaque-cloud-free white: 1 - a
  outBuf[8] = vec4<f32>(applyAerialPerspectiveUv(vec3<f32>(0.0), 0.0, probe.ap.xy, probe.ap.z), 0.0); // uv entry
  for (var k = 0; k < 10; k++) {
    outBuf[9 + k] = atmAerialPerspectiveAt(vec2<f32>(0.5, 0.5), 500.0 * pow(2.0, f32(k)));   // 0.5, 1, 2, ... 256 km
  }
}
`;

async function readTexture(device: GPUDevice, tex: GPUTexture): Promise<{ w: number; h: number; px: Float32Array }> {
  const w = tex.width, h = tex.height, bpr = Math.ceil((w * 8) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h, 1]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange().slice(0));
  buf.unmap(); buf.destroy();
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) px[y * w * 4 + x] = half(u16[(y * bpr) / 2 + x]);
  return { w, h, px };
}

// CPU forward map for the sky-view LUT and bilinear fetch by memory row (clamped), independent of the WGSL.
function lutRadiance(lut: { w: number; h: number; px: Float32Array }, vz: number, lv: number, bot: number, hKm: number): V3 {
  const beta = Math.acos(Math.min(1, Math.sqrt(Math.max(0, hKm * hKm - bot * bot)) / hKm));
  const zha = Math.PI - beta, vza = Math.acos(Math.max(-1, Math.min(1, vz)));
  const ground = vz < -Math.sqrt(Math.max(0, 1 - (bot / hKm) ** 2));
  const uvY = ground ? Math.sqrt(Math.max(0, (vza - zha) / beta)) * 0.5 + 0.5 : (1 - Math.sqrt(Math.max(0, 1 - vza / zha))) * 0.5;
  const uvX = Math.sqrt(Math.min(1, Math.max(0, -lv * 0.5 + 0.5)));
  const u = (uvX + 0.5 / lut.w) * (lut.w / (lut.w + 1)), v = (uvY + 0.5 / lut.h) * (lut.h / (lut.h + 1));
  const px = u * lut.w - 0.5, py = v * lut.h - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
  const at = (x: number, y: number, c: number) => lut.px[(Math.min(lut.h - 1, Math.max(0, y)) * lut.w + Math.min(lut.w - 1, Math.max(0, x))) * 4 + c];
  const r: V3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) r[c] = (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy;
  return r;
}
function lutHemisphereMean(lut: { w: number; h: number; px: Float32Array }, lower: boolean, bot: number, hKm: number): V3 {
  const nu = 400, np = 360, acc: V3 = [0, 0, 0];
  for (let i = 0; i < nu; i++) {
    const s2 = (i + 0.5) / nu, cosT = Math.sqrt(1 - s2) * (lower ? -1 : 1);
    for (let j = 0; j < np; j++) {
      const r = lutRadiance(lut, cosT, Math.cos(((j + 0.5) / np) * Math.PI), bot, hKm);
      acc[0] += r[0]; acc[1] += r[1]; acc[2] += r[2];
    }
  }
  return acc.map(x => x / (nu * np)) as V3;
}

interface Check { name: string; ok: boolean; value: string }
const checks: Check[] = [];
const cases: Record<string, unknown>[] = [];
const check = (name: string, ok: boolean, value: string) => { checks.push({ name, ok, value }); log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${value}`); };

try {
  const renderer = new WebGPURenderer({ antialias: false });
  await renderer.init();
  const { device, texture } = sharedBackend(renderer);
  renderer.setSize(64, 64, false);
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 16 / 9, 0.5, 1_500_000);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 12, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();

  const setCamera = async (altitude: number, pitchDeg = 0) => {
    const p = (pitchDeg * Math.PI) / 180;
    camera.position.set(0, altitude, 0);
    camera.lookAt(0, altitude + Math.sin(p), -Math.cos(p));   // toward -Z, pitched up by pitchDeg
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    sky.update(camera);
    await sky.updateAerialPerspective();
    renderer.render(scene, camera);   // materialise everything three allocates lazily
  };
  await setCamera(1);
  const bridge = createSkyBridge(renderer, sky);
  const baker = sky.baker as any;

  // ---- kernel pipeline ----
  const module = device.createShaderModule({ label: 'atmosphere test', code: atmosphereWgsl(0) + KERNEL });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) if (m.type === 'error') throw new Error(`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
  const testLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: 'cube' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ] });
  const pipeline = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bridge.layout, testLayout] }), compute: { module, entryPoint: 'main' } });
  const OUT_VEC4 = 24;
  const outBuf = device.createBuffer({ size: OUT_VEC4 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: OUT_VEC4 * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const probeBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dirBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const run = async (probeY: number, apDistance: number, viewDir: V3, uv: [number, number] = [0.5, 0.5]) => {
    bridge.update(camera);
    device.queue.writeBuffer(probeBuf, 0, new Float32Array([0, probeY, 0, 0, uv[0], uv[1], apDistance, 0]));
    device.queue.writeBuffer(dirBuf, 0, new Float32Array([...viewDir, 0]));
    const cube = texture(baker.cubeRenderTarget.texture).createView({ dimension: 'cube', mipLevelCount: 1 });
    const bg = device.createBindGroup({ layout: testLayout, entries: [
      { binding: 0, resource: { buffer: outBuf } }, { binding: 1, resource: { buffer: probeBuf } },
      { binding: 2, resource: cube }, { binding: 3, resource: { buffer: dirBuf } },
    ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bridge.bindGroup); pass.setBindGroup(1, bg); pass.dispatchWorkgroups(1); pass.end();
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, OUT_VEC4 * 16);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const r = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    return r;
  };

  // ---- sun radiance + ambient, several sun heights, ground and 2 km ----
  const SUN_TOL = 0.05, AMB_CUBE_TOL = 0.08, AMB_LUT_TOL = 0.03;
  let sunCases = 0;
  for (const altitude of [1, 2000]) {
    for (const hour of [12, 15.5, 17.5, 18.5, 19]) {
      sky.setTimeOfDay(hour);
      await setCamera(altitude);
      if (sky.sunElevation < 2) continue;   // the light's horizon fade (flat-world disc fraction) is not part of the LUT lookup
      sunCases++;
      const r = await run(altitude, 10_000, [0, 0, -1]);
      const c = sun.light.color, k = sun.light.intensity;
      const ref: V3 = [c.r * k, c.g * k, c.b * k];
      const got: V3 = [r[0], r[1], r[2]];
      const peak = Math.max(...ref);
      const errs = got.map((g, i) => relErr(g, ref[i], 0.02 * peak));
      const tag = `sun  alt ${altitude} m  t ${hour} h  elev ${sky.sunElevation.toFixed(1)} deg`;
      check(tag, Math.max(...errs) <= SUN_TOL, `wgsl [${fmt(got)}]  sky [${fmt(ref)}]  max err ${(Math.max(...errs) * 100).toFixed(2)} %`);

      // ambient: needs a fresh readback of the sky-view LUT baked for this state
      const lut = await readTexture(device, texture(baker.skyViewLUT.texture));
      const bot = baker.atmosphereParams.bottomRadius, hKm = baker.skyViewLUT.viewHeight;
      const upLut = lutHemisphereMean(lut, false, bot, hKm), dnLut = lutHemisphereMean(lut, true, bot, hKm);
      const scale = baker.sky.luminanceScale.value, sc = baker.sky.sunColor.value;
      const tint = (v: V3): V3 => [v[0] * scale * sc.x, v[1] * scale * sc.y, v[2] * scale * sc.z];
      const upRef = tint(upLut), dnRef = tint(dnLut);
      const up: V3 = [r[4], r[5], r[6]], dn: V3 = [r[8], r[9], r[10]];
      const cubeUp: V3 = [r[12], r[13], r[14]];
      const e = (a: V3, b: V3) => Math.max(...a.map((x, i) => relErr(x, b[i], 1e-4 + 0.02 * Math.max(...b))));
      const eLutUp = e(up, upRef), eLutDn = e(dn, dnRef), eCubeUp = e(up, cubeUp);
      const t2 = `amb  alt ${altitude} m  t ${hour} h`;
      check(`${t2} upper vs LUT brute force`, eLutUp <= AMB_LUT_TOL, `wgsl [${fmt(up)}]  cpu [${fmt(upRef)}]  err ${(eLutUp * 100).toFixed(2)} %`);
      check(`${t2} lower vs LUT brute force`, eLutDn <= AMB_LUT_TOL, `wgsl [${fmt(dn)}]  cpu [${fmt(dnRef)}]  err ${(eLutDn * 100).toFixed(2)} %`);
      check(`${t2} upper vs sky cube average`, eCubeUp <= AMB_CUBE_TOL, `wgsl [${fmt(up)}]  cube [${fmt(cubeUp)}]  err ${(eCubeUp * 100).toFixed(2)} %`);
      cases.push({ altitude, hour, elevationDeg: sky.sunElevation, sun: { wgsl: got, sky: ref, maxErr: Math.max(...errs) }, ambient: { upper: up, lower: dn, lutUpper: upRef, lutLower: dnRef, cubeUpper: cubeUp, errLutUpper: eLutUp, errLutLower: eLutDn, errCubeUpper: eCubeUp } });
    }
  }
  check('sun cases evaluated', sunCases >= 6, `${sunCases}`);

  // ---- orientation sanity: a clear noon sky is bluest at the zenith, i.e. row 0 of the sky-view LUT ----
  {
    sky.setTimeOfDay(12);
    await setCamera(1);
    const lut = await readTexture(device, texture(baker.skyViewLUT.texture));
    const px = (y: number) => { const i = (y * lut.w + (lut.w >> 1)) * 4; return [lut.px[i], lut.px[i + 1], lut.px[i + 2]]; };
    const zenith = px(1), ground = px(lut.h - 2);
    const bz = zenith[2] / zenith[0], bg = ground[2] / ground[0];
    check('LUT row 0 is the zenith (bluer than ground rows)', bz > 1.5 * bg, `b/r zenith ${bz.toFixed(2)}  ground ${bg.toFixed(2)}`);
  }

  // ---- aerial perspective: the frame-centre ray pitched 4 degrees up from 1 m altitude ----
  // (A level ray at the ground is a bad probe: the LUT's texel rows straddling the horizon point below it, where the
  // underground-froxel correction shortens the path, so the centre reads about half the true attenuation.)
  {
    sky.setTimeOfDay(12);
    const pitch = 4, p = (pitch * Math.PI) / 180;
    await setCamera(1, pitch);
    const dir: V3 = [0, Math.sin(p), -Math.cos(p)];
    const params = baker.atmosphereParams;
    const R = params.bottomRadius;
    const analyticAlpha = (distM: number) => {
      // numeric optical depth along the straight ray, Rayleigh + Mie (ozone is 0 below 15 km), curved-planet altitude
      const n = 400, dt = distM / 1000 / n, r0 = R + 0.001;
      const od = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dt;
        const h = Math.sqrt(r0 * r0 + t * t + 2 * r0 * t * Math.sin(p)) - R;
        for (let c = 0; c < 3; c++) od[c] += (params.rayleighScattering.getComponent(c) * Math.exp(-h / 8) + params.mieExtinction.getComponent(c) * Math.exp(-h / 1.2)) * dt;
      }
      return 1 - od.map(x => Math.exp(-x)).reduce((a, b) => a + b, 0) / 3;
    };
    const rows: Record<string, unknown>[] = [];
    for (const dist of [2_000, 5_000, 10_000]) {
      const r = await run(1, dist, dir);
      const ap = [r[20], r[21], r[22], r[23]];
      const ref = analyticAlpha(dist);
      check(`AP alpha at ${dist / 1000} km, 4 deg up ~ analytic 1 - mean(T)`, Math.abs(ap[3] - ref) <= 0.1 * ref + 0.003, `lut ${ap[3].toFixed(4)}  analytic ${ref.toFixed(4)}`);
      rows.push({ distanceM: dist, rgb: ap.slice(0, 3), alpha: ap[3], alphaAnalytic: ref });
      if (dist === 10_000) {
        // an off-centre pixel: ndc (0.5, -0.3) -> world direction, then both entry points must agree
        const ndc = [0.5, -0.3];
        const d = new Vector3(ndc[0], ndc[1], 0.5).applyMatrix4(camera.projectionMatrixInverse).transformDirection(camera.matrixWorld);
        const off = await run(1, dist, [d.x, d.y, d.z], [ndc[0] * 0.5 + 0.5, 0.5 - ndc[1] * 0.5]);
        const dirIn = [off[24], off[25], off[26]], uvIn = [off[32], off[33], off[34]];
        const dErr = Math.max(...dirIn.map((x, i) => relErr(x, uvIn[i], 1e-5)));
        check('AP direction entry == uv entry at an off-centre pixel', dErr <= 0.01 && uvIn[2] > 0, `dir [${fmt(dirIn)}]  uv [${fmt(uvIn)}]`);
        check('AP applied to white (T=1) leaves 1 - alpha', Math.abs(r[28] - (1 - ap[3])) <= 0.005, `${r[28].toFixed(4)} vs ${(1 - ap[3]).toFixed(4)}`);
        check('AP in-scatter is non-zero and blue-heavy', ap[2] > ap[0] && ap[0] > 0, `rgb [${fmt(ap)}]`);
        const alphas = Array.from({ length: 10 }, (_, k) => r[36 + 4 * k + 3]);
        check('AP alpha increases with distance (0.5 .. 256 km)', alphas.every((a, i) => i === 0 || a > alphas[i - 1]), alphas.map(a => a.toFixed(3)).join(' < '));
      }
    }
    cases.push({ ap: rows });
  }

  const failed = checks.filter(c => !c.ok);
  log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  const summary = { passed: failed.length === 0, checks, cases };
  const tick = () => { harness.frame(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  harness.ready({ report: () => ({ gpuMs: {}, frameMs: { p50: 0, p95: 0, last: 0 }, renderSize: [64, 64], ...summary }) });
  if (failed.length) console.error(`atmosphere test FAILED:\n${failed.map(c => `${c.name}: ${c.value}`).join('\n')}`);
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
