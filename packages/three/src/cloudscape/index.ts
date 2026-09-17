import {
  Color, Data3DTexture, RedFormat, RedIntegerFormat, UnsignedIntType, UnsignedByteType, LinearFilter, StorageTexture,
  Storage3DTexture, HalfFloatType, RenderTarget, DepthTexture, FloatType,
  MeshBasicNodeMaterial, QuadMesh, Matrix4, Vector3, WebGPUCoordinateSystem,
  type WebGPURenderer, type Scene, type PerspectiveCamera,
} from 'three/webgpu';
import { texture, mrt, output as sceneOutput, vec4 } from 'three/tsl';
import type { WorldSnapshot } from '../world';
import type { createCloudscapeAtlas } from '../sources/cloudscape-atlas';
import { sharedBackend } from '../gpu/backend';
import { createComputeTimer } from '../gpu/timer';
import { decodeFloat16 } from '../volumetric';
import { CLOUDSCAPE_WGSL, LIGHT_CACHE_WGSL, CANDIDATE_WGSL } from './shaders';

type Atlas = ReturnType<typeof createCloudscapeAtlas>;
export function createCloudscape(renderer: WebGPURenderer, source: Atlas, initialWorld: WorldSnapshot) {
  const backend = sharedBackend(renderer), { device } = backend;
  const atlas = new Data3DTexture(source.data, ...source.dimensions);
  atlas.format = RedFormat; atlas.type = UnsignedByteType; atlas.unpackAlignment = 1;
  atlas.minFilter = atlas.magFilter = LinearFilter; atlas.generateMipmaps = false; atlas.needsUpdate = true;
  renderer.initTexture(atlas);
  const target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, count: 2 });
  target.texture.name = 'output'; target.textures[1].name = 'cloudReceiver'; target.textures[1].type = UnsignedByteType;
  target.depthTexture = new DepthTexture(1, 1, FloatType);
  const sceneMRT = mrt({ output: sceneOutput, cloudReceiver: vec4(0) }); sceneMRT.setClearColor('cloudReceiver', new Color(0), 0);
  const output = new StorageTexture(1, 1), optical = new StorageTexture(1, 1);
  for (const t of [output, optical]) { t.type = HalfFloatType; t.generateMipmaps = false; renderer.initTexture(t); }
  const light = new Storage3DTexture(1, 1, 1); light.type = HalfFloatType; light.generateMipmaps = false;
  light.minFilter = light.magFilter = LinearFilter;
  const candidates = new Storage3DTexture(1, 1, 1); candidates.format = RedIntegerFormat; candidates.type = UnsignedIntType; candidates.generateMipmaps = false;
  const material = new MeshBasicNodeMaterial({ colorNode: texture(output), depthWrite: false, depthTest: false });
  const quad = new QuadMesh(material);
  const params = device.createBuffer({ label: 'cloudscape-frame', size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cellBuffer = device.createBuffer({ label: 'cloudscape-resident-cells', size: 17 * 17 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: CLOUDSCAPE_WGSL }), entryPoint: 'main' } });
  const lightPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: LIGHT_CACHE_WGSL }), entryPoint: 'main' } });
  const candidatePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: CANDIDATE_WGSL }), entryPoint: 'main' } });
  const timer = createComputeTimer(device), lightTimer = createComputeTimer(device), candidateTimer = createComputeTimer(device);
  const settings = {
    density: 1, stepMetres: 24, maxSteps: 320, detail: 0.16,
    skipEmpty: true, distanceFade: true, earlyTermination: true, cachedLighting: true, shadows: true, constantLight: false,
    sunDirection: new Vector3(-0.65, 0.75, 0.2).normalize(),
    casterMin: new Vector3(950, 0, 850), casterMax: new Vector3(1250, 1800, 1150),
  };
  let world: WorldSnapshot, worldBinding: GPUBindGroup | undefined, frameBinding: GPUBindGroup | undefined, cacheBinding: GPUBindGroup | undefined, candidateBinding: GPUBindGroup | undefined;
  let disposed = false, lightDirty = true, lightKey = '', cacheUpdates = 0, worldUploads = 0, cacheWidth = 1, candidateWidth = 1, candidateDirty = true, candidateUpdates = 0, worldUploadCpuMs = 0;
  const values = new Float32Array(52), inverse = new Matrix4(), position = new Vector3();
  const ensureAlive = () => { if (disposed) throw new Error('Cloudscape has been disposed.'); };
  function setWorld(next: WorldSnapshot) {
    ensureAlive(); if (world === next) return;
    if (!Number.isInteger(next.side) || next.side < 1 || next.side > 17 || next.cells.length !== next.side ** 2) throw new Error('Invalid cloud world grid.');
    if (!Number.isFinite(next.cellSize) || next.cellSize <= 0) throw new Error('Invalid cloud cell size.');
    if (next.gridMin.length !== 2 || !next.gridMin.every(Number.isSafeInteger)) throw new Error('Invalid cloud grid origin.');
    const data = new Float32Array(next.cells.length * 8);
    next.cells.forEach((cell, i) => {
      if (cell.cellX !== next.gridMin[0] + i % next.side || cell.cellZ !== next.gridMin[1] + Math.floor(i / next.side)) throw new Error('Cloud cells must use X-fastest grid ordering.');
      if (cell.active && (cell.bounds.min[0] < (cell.cellX - 0.25) * next.cellSize || cell.bounds.max[0] > (cell.cellX + 1.25) * next.cellSize || cell.bounds.min[2] < (cell.cellZ - 0.25) * next.cellSize || cell.bounds.max[2] > (cell.cellZ + 1.25) * next.cellSize || cell.bounds.min[1] < 700 || cell.bounds.max[1] > 3500)) throw new Error('Cloud bounds exceed the resident neighbor contract.');
      if (!Number.isInteger(cell.atlasIndex) || cell.atlasIndex < 0 || cell.atlasIndex >= source.tileCount || !Number.isFinite(cell.extinctionScale) || cell.extinctionScale < 0) throw new Error('Invalid cloud cell density metadata.');
      for (let axis = 0; axis < 3; axis++) if (!Number.isFinite(cell.bounds.min[axis]) || !Number.isFinite(cell.bounds.max[axis]) || cell.bounds.max[axis] <= cell.bounds.min[axis]) throw new Error('Invalid cloud cell bounds.');
      data.set([...cell.bounds.min, cell.active ? cell.extinctionScale : 0, ...cell.bounds.max, cell.atlasIndex], i * 8);
    });
    const uploadStart = performance.now(); device.queue.writeBuffer(cellBuffer, 0, data); worldUploadCpuMs = performance.now() - uploadStart; world = next; worldUploads++;
    const size = (next.side + 2) * 12; cacheWidth = size;
    light.setSize(size, 32, size); renderer.initTexture(light);
    candidateWidth = (next.side + 2) * 8; candidates.setSize(candidateWidth, 32, candidateWidth); renderer.initTexture(candidates);
    worldBinding = cacheBinding = candidateBinding = undefined; lightDirty = candidateDirty = true;
  }
  setWorld(initialWorld);
  function resize(width: number, height: number) {
    ensureAlive(); if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)) throw new Error('Invalid cloudscape render size.');
    if (target.width === width && target.height === height) return;
    target.setSize(width, height); output.setSize(width, height, 1); optical.setSize(width, height, 1);
    renderer.initTexture(output); renderer.initTexture(optical); frameBinding = undefined;
  }
  function upload(camera: PerspectiveCamera) {
    camera.updateMatrixWorld(); inverse.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse).toArray(values);
    camera.getWorldPosition(position).toArray(values, 16); values[19] = 2 * Math.tan(camera.fov * Math.PI / 360) / target.height;
    const sun = settings.sunDirection.clone().normalize(); sun.toArray(values, 20); values[23] = +settings.earlyTermination;
    values.set([world.gridMin[0], world.gridMin[1], world.side, world.cellSize], 24);
    values.set([(world.gridMin[0] - 1) * world.cellSize, 700, (world.gridMin[1] - 1) * world.cellSize], 28); values[31] = +settings.distanceFade;
    values.set([(world.gridMin[0] + world.side + 1) * world.cellSize, 3500, (world.gridMin[1] + world.side + 1) * world.cellSize], 32);
    values.set([settings.density, settings.stepMetres, settings.maxSteps, settings.detail], 36);
    values.set([+settings.skipEmpty, +settings.cachedLighting, +settings.shadows, +settings.constantLight], 40);
    settings.casterMin.toArray(values, 44); settings.casterMax.toArray(values, 48);
    device.queue.writeBuffer(params, 0, values);
    const key = `${sun.toArray().map(v => v.toPrecision(12))}|${settings.density}|${settings.skipEmpty}`;
    if (key !== lightKey) { lightDirty = true; lightKey = key; }
  }
  const commonEntries = (): GPUBindGroupEntry[] => [
    { binding: 0, resource: { buffer: params } }, { binding: 1, resource: backend.texture(atlas).createView() },
    { binding: 2, resource: sampler }, { binding: 3, resource: { buffer: cellBuffer } },
  ];
  function render(scene: Scene, camera: PerspectiveCamera, present = true, measure = false) {
    ensureAlive();
    if (renderer.reversedDepthBuffer || camera.coordinateSystem !== WebGPUCoordinateSystem) throw new Error('Cloudscape requires conventional WebGPU perspective depth.');
    if (!Number.isFinite(settings.density) || settings.density < 0 || !Number.isFinite(settings.stepMetres) || settings.stepMetres <= 0 || !Number.isInteger(settings.maxSteps) || settings.maxSteps < 1 || settings.maxSteps > 1024 || !Number.isFinite(settings.detail) || settings.detail < 0 || settings.detail > 1 || !settings.sunDirection.toArray().every(Number.isFinite) || settings.sunDirection.lengthSq() === 0) throw new Error('Invalid cloudscape settings.');
    const previousTarget = renderer.getRenderTarget(), previousMRT = renderer.getMRT();
    let measuredCache = false, measuredCandidates = false;
    try {
      renderer.setRenderTarget(target); renderer.setMRT(sceneMRT); renderer.render(scene, camera); upload(camera);
      if (!worldBinding) worldBinding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [...commonEntries(), { binding: 4, resource: backend.texture(light).createView() }, { binding: 5, resource: backend.texture(candidates).createView() }] });
      if (!cacheBinding) cacheBinding = device.createBindGroup({ layout: lightPipeline.getBindGroupLayout(0), entries: [...commonEntries(), { binding: 4, resource: backend.texture(light).createView() }, { binding: 5, resource: backend.texture(candidates).createView() }] });
      if (!candidateBinding) candidateBinding = device.createBindGroup({ layout: candidatePipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: params } }, { binding: 3, resource: { buffer: cellBuffer } }, { binding: 4, resource: backend.texture(candidates).createView() },
      ] });
      if (!frameBinding) frameBinding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
        { binding: 0, resource: backend.texture(target.texture).createView() },
        { binding: 1, resource: backend.texture(target.depthTexture!).createView() },
        { binding: 2, resource: backend.texture(target.textures[1]).createView() },
        { binding: 3, resource: backend.texture(optical).createView() },
        { binding: 4, resource: backend.texture(output).createView() },
      ] });
      const encoder = device.createCommandEncoder({ label: 'cloudscape-frame' });
      if (candidateDirty) {
        const pass = encoder.beginComputePass(measure && candidateTimer ? { timestampWrites: candidateTimer.begin() } : {}); pass.setPipeline(candidatePipeline); pass.setBindGroup(0, candidateBinding);
        pass.dispatchWorkgroups(Math.ceil(candidateWidth / 4), 8, Math.ceil(candidateWidth / 4)); pass.end();
        if (measure && candidateTimer) { candidateTimer.resolve(encoder); measuredCandidates = true; }
        candidateDirty = false; candidateUpdates++;
      }
      if (lightDirty && settings.cachedLighting) {
        const pass = encoder.beginComputePass(measure && lightTimer ? { timestampWrites: lightTimer.begin() } : {});
        pass.setPipeline(lightPipeline); pass.setBindGroup(0, cacheBinding);
        pass.dispatchWorkgroups(Math.ceil(cacheWidth / 4), 8, Math.ceil(cacheWidth / 4)); pass.end();
        if (measure && lightTimer) { lightTimer.resolve(encoder); measuredCache = true; }
        lightDirty = false; cacheUpdates++;
      }
      const pass = encoder.beginComputePass(measure && timer ? { timestampWrites: timer.begin() } : {});
      pass.setPipeline(pipeline); pass.setBindGroup(0, worldBinding); pass.setBindGroup(1, frameBinding);
      pass.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8)); pass.end();
      if (measure && timer) timer.resolve(encoder);
      device.queue.submit([encoder.finish()]);
    } finally { renderer.setMRT(previousMRT); renderer.setRenderTarget(previousTarget); }
    if (present) quad.render(renderer);
    return { measuredCache, measuredCandidates };
  }
  async function readPixels(source: StorageTexture) {
    ensureAlive(); const w = target.width, h = target.height, pitch = Math.ceil(w * 8 / 256) * 256;
    const staging = device.createBuffer({ size: pitch * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: backend.texture(source) }, { buffer: staging, bytesPerRow: pitch }, [w, h]); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ); const raw = new Uint16Array(staging.getMappedRange()), result = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) result[y * w * 4 + x] = decodeFloat16(raw[y * pitch / 2 + x]);
      return result;
    } finally { staging.destroy(); }
  }
  return {
    settings, output, optical, setWorld, resize, render,
    invalidateLighting() { ensureAlive(); lightDirty = true; },
    async measureGpu(scene: Scene, camera: PerspectiveCamera, rebuild = false) {
      ensureAlive(); if (!timer) return null; if (rebuild) lightDirty = candidateDirty = true;
      const rebuilt = render(scene, camera, false, true);
      return { cloudMs: await timer.readMilliseconds(), cacheMs: rebuilt.measuredCache && lightTimer ? await lightTimer.readMilliseconds() : null, candidateMs: rebuilt.measuredCandidates && candidateTimer ? await candidateTimer.readMilliseconds() : null };
    },
    readOptical: () => readPixels(optical), readComposite: () => readPixels(output),
    async readCandidates() {
      ensureAlive(); const w = candidateWidth, h = 32, pitch = Math.ceil(w * 4 / 256) * 256;
      const staging = device.createBuffer({ size: pitch * h * w, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: backend.texture(candidates) }, { buffer: staging, bytesPerRow: pitch, rowsPerImage: h }, [w, h, w]); device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ); const raw = new Uint32Array(staging.getMappedRange()), result = new Uint32Array(w * h * w);
        for (let z = 0; z < w; z++) for (let y = 0; y < h; y++) result.set(raw.subarray((z * h + y) * pitch / 4, (z * h + y) * pitch / 4 + w), (z * h + y) * w);
        return result;
      } finally { staging.destroy(); }
    },
    get evidence() { return {
      worldRevision: world.revision, gridMin: world.gridMin, side: world.side, residentCells: world.cells.length, activeCells: world.cells.filter(c => c.active).length,
      worldUploads, worldUploadCpuMs, cacheUpdates, candidateUpdates, candidateBytes: candidateWidth * 32 * candidateWidth * 4, atlasBytes: source.data.byteLength, cellBufferBytes: cellBuffer.size,
      lightCacheSize: [cacheWidth, 32, cacheWidth], lightCacheBytes: cacheWidth * 32 * cacheWidth * 8,
      frameTargetBytes: target.width * target.height * 32, renderSize: [target.width, target.height],
      settings: { ...settings, sunDirection: settings.sunDirection.toArray(), casterMin: settings.casterMin.toArray(), casterMax: settings.casterMax.toArray() },
    }; },
    dispose() { if (disposed) return; disposed = true; atlas.dispose(); light.dispose(); candidates.dispose(); target.dispose(); output.dispose(); optical.dispose(); material.dispose(); params.destroy(); cellBuffer.destroy(); timer?.dispose(); lightTimer?.dispose(); candidateTimer?.dispose(); },
  };
}
