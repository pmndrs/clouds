import { REFERENCE_SHADOW_WGSL } from '../lighting/reference';
import { DIRECTIONAL_SHADOW_WGSL } from '../lighting/p3';
import { TRAVERSAL_WGSL } from '../world-traversal';

const COMMON = /* wgsl */`
struct Params {
  inverseVP: mat4x4<f32>,
  camera: vec4<f32>, // camera.w = world metres per pixel per metre of distance
  sun: vec4<f32>,
  grid: vec4<f32>, // min global cell X/Z, side, cellSize
  lo: vec4<f32>, // lo.w = enable camera-relative view-density fade
  hi: vec4<f32>,
  settings: vec4<f32>, // density multiplier, desired step metres, max steps, detail strength
  flags: vec4<f32>, // skip empty cells, cached lighting, shadows, diagnostic constant light
  casterLo: vec4<f32>,
  casterHi: vec4<f32>,
  sunRadiance: vec4<f32>, // w = exponential haze density
  ambientRadiance: vec4<f32>, // w = haze strength
  hazeColor: vec4<f32>, // w = use scene shadow map instead of reference box
  currentVP: mat4x4<f32>, // unjittered guide projection
  previousVP: mat4x4<f32>,

}
struct Cell { lo: vec4<f32>, hi: vec4<f32> } // lo.w extinction; hi.w atlas index
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var atlas: texture_3d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<storage, read> cells: array<Cell>;
@group(0) @binding(5) var candidates: texture_3d<u32>;
${REFERENCE_SHADOW_WGSL}
${TRAVERSAL_WGSL}

fn cellIndex(c: vec2<i32>) -> i32 {
  let local = c - vec2<i32>(p.grid.xy);
  if (any(local < vec2(0)) || any(local >= vec2<i32>(i32(p.grid.z)))) { return -1; }
  return local.x + local.y * i32(p.grid.z);
}
fn tileDensity(world: vec3<f32>, cell: Cell) -> f32 {
  let uvw = (world - cell.lo.xyz) / (cell.hi.xyz - cell.lo.xyz);
  if (any(uvw <= vec3(0.0)) || any(uvw >= vec3(1.0))) { return 0.0; }
  let tile = u32(cell.hi.w);
  let offset = vec3<f32>(f32(tile & 1u), f32((tile >> 1u) & 1u), f32((tile >> 2u) & 1u));
  let halfTexel = 1.0 / f32(textureDimensions(atlas).x);
  return textureSampleLevel(atlas, linearSampler, (offset + clamp(uvw, vec3(halfTexel), vec3(1.0-halfTexel))) * 0.5, 0.0).r;
}
// Resolve overlapping extinction at each world sample, never sort cloud boxes.
fn candidateBits(world:vec3<f32>) -> u32 {
  let uvw=(world-p.lo.xyz)/(p.hi.xyz-p.lo.xyz);
  if(any(uvw<vec3(0.0)) || any(uvw>=vec3(1.0))){return 0u;}
  return textureLoad(candidates,vec3<i32>(uvw*vec3<f32>(textureDimensions(candidates))),0).r;
}
fn extinctionAt(world: vec3<f32>) -> f32 {
  let c = vec2<i32>(floor(world.xz / p.grid.w));
  var sigma = 0.0;
  var bits=511u;
  if(p.flags.x>0.5){bits=candidateBits(world);}
  loop {
    if(bits==0u){break;}
    let bit=firstTrailingBit(bits); bits=bits & (bits-1u);
    let index = cellIndex(c + vec2(i32(bit%3u)-1,i32(bit/3u)-1));
    if (index >= 0) {
      let cell = cells[index];
      if (cell.lo.w > 0.0) { sigma += tileDensity(world, cell) * cell.lo.w; }
    }
  }
  return sigma * p.settings.x;
}
fn emptyCell(world: vec3<f32>) -> bool {
  let c = vec2<i32>(floor(world.xz / p.grid.w));
  for (var z = -1; z <= 1; z++) { for (var x = -1; x <= 1; x++) {
    let index = cellIndex(c + vec2(x,z));
    if (index >= 0 && cells[index].lo.w > 0.0) { return false; }
  } }
  return true;
}
fn nextEmptyVoxel(world:vec3<f32>,ray:vec3<f32>,ds:f32,i:u32)->u32 {
  let local=world-p.lo.xyz;
  let voxel=(p.hi.xyz-p.lo.xyz)/vec3<f32>(textureDimensions(candidates));
  let tx=traversalNextFaceDistance(local.x,ray.x,voxel.x);
  let ty=traversalNextFaceDistance(local.y,ray.y,voxel.y);
  let tz=traversalNextFaceDistance(local.z,ray.z,voxel.z);
  let face=min(tx,min(ty,tz));
  let epsilon=max(max(max(abs(world.x),abs(world.y)),abs(world.z)),p.grid.w)*1e-6;
  let advance=max(1.0,floor(max(0.0,face-epsilon)/ds)+1.0);
  return i+u32(min(advance,1024.0));
}
fn directLight(world: vec3<f32>) -> f32 {
  let segment = boxInterval(world, p.sun.xyz, p.lo.xyz, p.hi.xyz);
  let start = max(0.0, segment.x); let end = max(start, segment.y);
  let ds = (end-start) / 48.0;
  var tau = 0.0;
  for (var i = 0u; i < 48u; i++) {
    tau += extinctionAt(world+p.sun.xyz*(start+(f32(i)+0.5)*ds))*ds;
  }
  return exp(-tau);
}

// Fade only the view contribution at the edge of the camera's support window.
// The radius is derived from the resident side rather than p.lo/p.hi, so a
// world rebase does not move the fade plane through retained cells. Analytic
// fixtures set p.lo.w to zero and keep the physical density unmodified.
fn viewDensityFade(world: vec3<f32>) -> f32 {
  if (p.lo.w < 0.5) { return 1.0; }
  // A one- or two-cell fixture has no useful interior support annulus. Keep
  // those bounded fixtures physical; rebasing continuity is guaranteed for
  // the normal P2 windows with at least three cells per side.
  if (p.grid.z < 3.0) { return 1.0; }
  let supportRadius = max(0.0, 0.5 * (p.grid.z - 1.0) - 0.5);
  let startRadius = max(0.0, supportRadius - 1.5);
  let distanceCells = length((world.xz - p.camera.xz) / p.grid.w);
  if (supportRadius <= 0.0) {
    return select(0.0, 1.0, distanceCells <= 1e-5);
  }
  if (distanceCells <= startRadius) { return 1.0; }
  if (distanceCells >= supportRadius) { return 0.0; }
  return 1.0 - smoothstep(startRadius, supportRadius, distanceCells);
}
`;

export const CANDIDATE_WGSL = COMMON + /* wgsl */`
@group(0) @binding(4) var candidateOut:texture_storage_3d<r32uint,write>;
@compute @workgroup_size(4,4,4)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(candidateOut);if(any(id>=size)){return;}
  let voxel=(p.hi.xyz-p.lo.xyz)/vec3<f32>(size);
  let lo=p.lo.xyz+vec3<f32>(id)*voxel;
  let hi=lo+voxel;
  let c=vec2<i32>(floor(((lo+hi)*0.5).xz/p.grid.w));
  var bits=0u;
  for(var z=-1;z<=1;z++){for(var x=-1;x<=1;x++){
    let index=cellIndex(c+vec2(x,z));
    if(index>=0){let cell=cells[index];
      if(cell.lo.w>0.0 && all(cell.lo.xyz<=hi+vec3(0.0001)) && all(cell.hi.xyz>=lo-vec3(0.0001))){bits|=1u<<u32((z+1)*3+x+1);}
    }
  }}
  textureStore(candidateOut,id,vec4<u32>(bits,0u,0u,0u));
}
`;

export const LIGHT_CACHE_WGSL = COMMON + /* wgsl */`
@group(0) @binding(4) var lightOut: texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(lightOut); if (any(id >= size)) { return; }
  let uvw = (vec3<f32>(id)+0.5)/vec3<f32>(size);
  let world = mix(vec3(p.lo.x,0.0,p.lo.z), vec3(p.hi.x,4000.0,p.hi.z), uvw);
  textureStore(lightOut,id,vec4(directLight(world),0.0,0.0,1.0));
}
`;

const VIEW_WGSL = COMMON + DIRECTIONAL_SHADOW_WGSL + /* wgsl */`
@group(0) @binding(4) var lightCache: texture_3d<f32>;
@group(1) @binding(0) var sceneColor: texture_2d<f32>;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;
@group(1) @binding(2) var receiver: texture_2d<f32>;
@group(1) @binding(3) var opticalOut: texture_storage_2d<rgba16float,write>;
@group(1) @binding(4) var compositeOut: texture_storage_2d<rgba16float,write>;
/* GUIDE_BINDINGS */
fn lightAt(world:vec3<f32>) -> f32 {
  if (p.flags.z < 0.5) { return 1.0; }
  var geometryT = 1.0;
  if (p.hazeColor.w > 0.5) { if (p.casterHi.w > 0.5) { geometryT = sceneShadowAt(world); } }
  else if (p.casterHi.w > 0.5 && boxOccludes(world+p.sun.xyz*0.1,p.sun.xyz,p.casterLo.xyz,p.casterHi.xyz)) { return 0.0; }
  if (p.flags.y < 0.5) { return geometryT * directLight(world); }
  let uvw = (world-vec3(p.lo.x,0.0,p.lo.z))/(vec3(p.hi.x,4000.0,p.hi.z)-vec3(p.lo.x,0.0,p.lo.z));
  return geometryT * textureSampleLevel(lightCache,linearSampler,uvw,0.0).r;
}
fn worldAt(ndc:vec2<f32>,depth:f32) -> vec3<f32> {
  let h=p.inverseVP*vec4(ndc,depth,1.0); return h.xyz/h.w;
}
fn detailFactor(world:vec3<f32>, distance:f32) -> f32 {
  // Sub-voxel modulation fades with projected footprint, without changing the
  // broad voxel source or switching a distant formation into a flat layer.
  if(p.settings.w==0.0 || distance*p.camera.w>=45.0){return 1.0;}
  let fade=1.0-smoothstep(8.0,45.0,distance*p.camera.w);
  let n=sin(world.x*0.075+sin(world.z*0.041))*sin(world.y*0.091+world.z*0.025);
  return 1.0 - p.settings.w*fade*(0.5+0.5*n);
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3<u32>) {
  let size=textureDimensions(compositeOut); if(any(id.xy>=size)){return;}
  let pixel=vec2<i32>(id.xy);
  let uv=(vec2<f32>(id.xy)+0.5)/vec2<f32>(size);
  let ndc=vec2(uv.x*2.0-1.0,1.0-uv.y*2.0);
  let ray=normalize(worldAt(ndc,1.0)-p.camera.xyz);
  let scenePixel=min(vec2<i32>(uv*vec2<f32>(textureDimensions(sceneDepth))),vec2<i32>(textureDimensions(sceneDepth))-1);
  let depth=textureLoad(sceneDepth,scenePixel,0);
  let opaque=worldAt(ndc,depth);
  let opaqueDistance=select(1e8,dot(opaque-p.camera.xyz,ray),depth<1.0);
  let interval=boxInterval(p.camera.xyz,ray,p.lo.xyz,p.hi.xyz);
  let start=max(max(0.0,interval.x),length(worldAt(ndc,0.0)-p.camera.xyz));
  let end=min(interval.y,opaqueDistance);
  var T=1.0; var L=vec3(0.0);
  /* GUIDE_MOMENT */
  if(end>start){
    // Use a camera-anchored lattice. The projected world extent determines a
    // stable lower bound for ds, while the user setting can request a coarser
    // step. Rebased grids retain the same side and cell size, so this value
    // does not change when p.lo/p.hi move by one cell.
    let rayExtent=dot(abs(ray),p.hi.xyz-p.lo.xyz);
    let ds=max(p.settings.y,rayExtent/max(1.0,p.settings.z));
    let firstIndex=u32(max(0.0,floor(start/ds)));
    let lastIndex=u32(max(0.0,ceil(end/ds)));
    let g=0.45; let mu=dot(ray,p.sun.xyz);
    let phase=(1.0-g*g)/(12.5663706*pow(1.0+g*g-2.0*g*mu,1.5));
    var i=firstIndex;
    loop {
      if(i>=lastIndex){break;}
      let latticeStart=f32(i)*ds;
      let latticeEnd=latticeStart+ds;
      let segmentStart=max(start,latticeStart);
      let segmentEnd=min(end,latticeEnd);
      if(segmentEnd<=segmentStart){i++;continue;}
      let segmentDs=segmentEnd-segmentStart;
      let t=0.5*(segmentStart+segmentEnd);
      let world=p.camera.xyz+ray*t;
      let fullSegment=segmentStart==latticeStart && segmentEnd==latticeEnd;
      if(p.flags.x>0.5 && fullSegment && candidateBits(world)==0u) {
        i=nextEmptyVoxel(world,ray,ds,i); continue;
      }
      var sigma=extinctionAt(world)*viewDensityFade(world);
      if(sigma>0.0) {
        sigma*=detailFactor(world,t);
        let segmentT=exp(-sigma*segmentDs);
        let sunlight=lightAt(world);
        var lighting=p.ambientRadiance.rgb+p.sunRadiance.rgb*phase*sunlight;
        if(p.flags.w>0.5){lighting=vec3(1.0);}
        // Distance haze treats distant cloud radiance and background coherently
        // enough for the coverage study; physical atmosphere composition is P3.
        let haze=1.0-exp(-t*p.sunRadiance.w);
        lighting=mix(lighting,p.hazeColor.rgb,haze*p.ambientRadiance.w);
        if(p.flags.w>0.5){lighting=vec3(1.0);}
        /* GUIDE_ACCUMULATE */
        L+=T*(1.0-segmentT)*lighting; T*=segmentT;
      }
      if(p.sun.w>0.5 && T<0.0001){break;}
      i++;
    }
  }
  var bg=textureLoad(sceneColor,scenePixel,0).rgb;
  if(p.flags.z>0.5 && textureLoad(receiver,scenePixel,0).r>0.5 && abs(ray.y)>1e-7) {
    let hit=p.camera.xyz+ray*(-p.camera.y/ray.y);
    bg*=0.35+0.65*lightAt(vec3(hit.x,0.05,hit.z));
  }
  /* GUIDE_STORE */
  textureStore(opticalOut,pixel,vec4(L,T));
  textureStore(compositeOut,pixel,vec4(L+T*bg,1.0));
}
`;

/** Guides are opt-in: older reference scenes pay no guide attachment cost. */
export function cloudscapeShader(guides = false) {
  return VIEW_WGSL
    .replace('/* GUIDE_BINDINGS */', guides ? `
@group(1) @binding(5) var sceneVelocity:texture_2d<f32>;
@group(1) @binding(6) var guideOut:texture_storage_2d<rgba32float,write>;
` : '')
    .replace('/* GUIDE_MOMENT */', guides ? 'var weightedDistance=0.0;' : '')
    .replace('/* GUIDE_ACCUMULATE */', guides ? 'weightedDistance+=T*(1.0-segmentT)*t;' : '')
    .replace('/* GUIDE_STORE */', guides ? `
  let opacity=1.0-T;
  let cloudDistance=weightedDistance/max(opacity,1e-6);
  let cloudPosition=p.camera.xyz+ray*cloudDistance;
  // A single depth cannot encode cloud + background layers. Use the dominant
  // contributor and mark mixed pixels reactive, instead of claiming exact flow.
  var guideDepth=depth;
  var motion=textureLoad(sceneVelocity,scenePixel,0).xy;
  var reactive=clamp(4.0*opacity*T,0.0,1.0);
  if(opacity>0.5 || depth>=1.0){
    var position=cloudPosition;
    if(opacity<=0.5){position=p.camera.xyz+ray*1e7;}
    let current=p.currentVP*vec4(position,1.0);
    let previous=p.previousVP*vec4(position,1.0);
    if(current.w>1e-5 && previous.w>1e-5){
      motion=current.xy/current.w-previous.xy/previous.w;
      if(opacity>0.5){guideDepth=clamp(current.z/current.w,0.0,1.0);}
    }else{motion=vec2(0.0);reactive=1.0;}
  }
  textureStore(guideOut,pixel,vec4(motion,guideDepth,reactive));
` : '');
}
export const CLOUDSCAPE_WGSL = cloudscapeShader();
