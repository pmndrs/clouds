import { REFERENCE_SHADOW_WGSL } from '../lighting/reference/index';

// Original quality-first transport experiment. Optical-depth cache uses the
// density field's bounds/texel centers; interpolation precedes exponentiation.
const COMMON = /* wgsl */`
const BAKE_DETAIL = false;
struct Params {
  inverseVP: mat4x4<f32>, camera:vec4<f32>, boundsMin:vec4<f32>, boundsMax:vec4<f32>,
  sun:vec4<f32>, settings:vec4<f32>, flags:vec4<f32>, boxMin:vec4<f32>, boxMax:vec4<f32>,
  morphology:vec4<f32>, morphologyDetail:vec4<f32>,
}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var density:texture_3d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
@group(0) @binding(3) var occupancy:texture_3d<f32>;
${REFERENCE_SHADOW_WGSL}
fn hashCell(c:vec3<i32>)->f32 {
  var h=(u32(c.x)*1597334677u) ^ (u32(c.y)*3812015801u) ^ (u32(c.z)*2798796415u);
  h=(h^(h>>16u))*2246822519u;h=h^(h>>13u);return f32(h)/4294967295.0;
}
fn noise3(v:vec3<f32>)->f32{
  let c=vec3<i32>(floor(v));let f=fract(v);let s=f*f*(3.0-2.0*f);
  let a=mix(hashCell(c),hashCell(c+vec3(1,0,0)),s.x);
  let b=mix(hashCell(c+vec3(0,1,0)),hashCell(c+vec3(1,1,0)),s.x);
  let d=mix(hashCell(c+vec3(0,0,1)),hashCell(c+vec3(1,0,1)),s.x);
  let e=mix(hashCell(c+vec3(0,1,1)),hashCell(c+vec3(1,1,1)),s.x);
  return mix(mix(a,b,s.y),mix(d,e,s.y),s.z);
}
fn densityAt(world:vec3<f32>)->f32 {
  let uvw=(world-p.boundsMin.xyz)/(p.boundsMax.xyz-p.boundsMin.xyz);
  if(any(uvw<vec3(0.0)) || any(uvw>vec3(1.0))){return 0.0;}
  let base=textureSampleLevel(density,linearSampler,uvw,0.0).r;
  if(!BAKE_DETAIL || base<=0.0 || p.flags.w<=0.0){return base;}
  let rim=1.0-smoothstep(.12,.75,base);
  let extent=p.boundsMax.xyz-p.boundsMin.xyz;
  let frequency=max(.012,32.0/max(extent.x,max(extent.y,extent.z)));
  let local=(world-p.boundsMin.xyz)*frequency;
  let noise=.6*noise3(local)+.3*noise3(local*2.083+vec3(31.4,17.3,8.2))+.1*noise3(local*4.167);
  let amount=p.flags.w*rim;
  return clamp((base-amount*noise)/max(.01,1.0-amount),0.0,1.0);
}
`;

// Original formation evaluator: separate weather columns, billowy boundary,
// and physical-scale erosion. Both sunlight and view sample this function.
const MORPHOLOGY_WGSL = /* wgsl */`
@group(0) @binding(10) var weatherNoise:texture_2d<f32>;
@group(0) @binding(11) var shapeNoise:texture_3d<f32>;
@group(0) @binding(12) var detailNoise:texture_3d<f32>;
@group(0) @binding(13) var repeatSampler:sampler;
fn noiseLod(footprint:f32,scale:f32)->f32 {
  return max(0.0,log2(max(1.0,footprint*f32(textureDimensions(shapeNoise).x)/scale)));
}
fn densityAtFootprint(world:vec3<f32>,footprint:f32)->f32 {
  if(any(world<p.boundsMin.xyz)||any(world>p.boundsMax.xyz)||p.morphology.x<=0.0){return 0.0;}
  let height=(world.y-p.boundsMin.y)/(p.boundsMax.y-p.boundsMin.y);
  let weather=textureSampleLevel(weatherNoise,repeatSampler,world.xz/p.morphology.z,0.0).rgb;
  let mass=clamp(.5+(weather.r-.5)*2.7,0.0,1.0);
  let coverage=clamp((mass+p.morphology.x-1.0)/max(.12,p.morphology.x),0.0,1.0);
  if(coverage<=0.0){return 0.0;}
  let top=(.40+.55*weather.g)*pow(coverage,.32);
  let basePosition=vec3(world.x-height*180.0,world.y*1.25,world.z)/p.morphology.w;
  let base=textureSampleLevel(shapeNoise,repeatSampler,basePosition,noiseLod(footprint,p.morphology.w)).rgb;
  let floorHeight=.012+base.g*.018;
  let column=clamp((top-height)*4.5,0.0,1.0)*smoothstep(0.0,.2,coverage)*smoothstep(floorHeight,floorHeight+.016,height);
  let boundary=base.r+column-1.0;
  let localHeight=clamp(height/max(top,.01),0.0,1.0);
  let warp=vec3(base.g-.5,0.0,base.b-.5)*.12;
  let detail=textureSampleLevel(detailNoise,repeatSampler,world/p.morphologyDetail.x+warp,noiseLod(footprint,p.morphologyDetail.x)).rgb;
  let cellular=dot(detail,vec3(.58,.29,.13));
  let erosionField=mix(1.0-cellular,cellular,smoothstep(.02,.12,localHeight));
  let erosion=p.morphology.y*mix(.20,1.10,smoothstep(.04,.75,localHeight))*erosionField;
  let edge=p.morphologyDetail.y;
  let density=smoothstep(-edge,edge,boundary-erosion);
  // Finite benchmark domain fade, shared by lighting; no camera-distance fade.
  let side=min(min(world.x-p.boundsMin.x,p.boundsMax.x-world.x),min(world.z-p.boundsMin.z,p.boundsMax.z-world.z));
  return density*smoothstep(0.0,180.0,side);
}
fn densityAt(world:vec3<f32>)->f32 {return densityAtFootprint(world,0.0);}
`;

/** Substitute the procedural evaluator, retaining the transport/cache code. */
export function morphologyShader(code: string, view = false): string {
  let result = code.replace('fn densityAt(world:vec3<f32>)->f32', 'fn voxelDensityAt(world:vec3<f32>)->f32');
  if (view) result = result.replace('let d=densityAt(world);', 'let d=densityAtFootprint(world,max(ds,(start+(f32(i)+jitter)*ds)*p.morphologyDetail.z));');
  else result = result.replace('densityAt(world+p.sun.xyz*(f32(i)+.5)*ds)', 'densityAtFootprint(world+p.sun.xyz*(f32(i)+.5)*ds,ds)');
  return result + MORPHOLOGY_WGSL;
}
export const DENSITY_BAKE_WGSL = COMMON.replace('const BAKE_DETAIL = false;', 'const BAKE_DETAIL = true;') + /* wgsl */`
@group(0) @binding(9) var densityOut:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(densityOut);if(any(id>=size)){return;}
 let world=mix(p.boundsMin.xyz,p.boundsMax.xyz,(vec3<f32>(id)+.5)/vec3<f32>(size));
 textureStore(densityOut,vec3<i32>(id),vec4(densityAt(world),0.0,0.0,1.0));
}
`;
export const OPTICAL_DEPTH_CACHE_WGSL = COMMON + /* wgsl */`
@group(0) @binding(9) var lightOut:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(lightOut);if(any(id>=size)){return;}
  let uvw=(vec3<f32>(id)+.5)/vec3<f32>(size);
  let world=mix(p.boundsMin.xyz,p.boundsMax.xyz,uvw);
  let interval=boxInterval(world,p.sun.xyz,p.boundsMin.xyz,p.boundsMax.xyz);
  let end=max(0.0,interval.y);let steps=u32(p.settings.z);let ds=end/f32(steps);
  var tau=0.0;
  for(var i=0u;i<steps;i++){tau+=densityAt(world+p.sun.xyz*(f32(i)+.5)*ds)*p.settings.x*ds;}
  textureStore(lightOut,vec3<i32>(id),vec4(tau,0.0,0.0,1.0));
}
`;
export const REALISTIC_CLOUD_WGSL = COMMON + /* wgsl */`
@group(0) @binding(4) var sceneColor:texture_2d<f32>;
@group(0) @binding(5) var sceneDepth:texture_depth_2d;
@group(0) @binding(6) var cloudOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(7) var compositeOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(8) var groundReceiver:texture_2d<f32>;
@group(0) @binding(9) var lightCache:texture_3d<f32>;
fn opticalDepth(world:vec3<f32>)->f32 {
  return textureSampleLevel(lightCache,linearSampler,(world-p.boundsMin.xyz)/(p.boundsMax.xyz-p.boundsMin.xyz),0.0).r;
}
fn hg(mu:f32,g:f32)->f32 {return (1.0-g*g)/(12.5663706*pow(max(.001,1.0+g*g-2.0*g*mu),1.5));}
fn worldAt(ndc:vec2<f32>,depth:f32)->vec3<f32>{let h=p.inverseVP*vec4(ndc,depth,1.0);return h.xyz/h.w;}
fn lighting(world:vec3<f32>,ray:vec3<f32>,d:f32)->vec3<f32>{
  let tau=opticalDepth(world);let mu=dot(ray,p.sun.xyz);
  // Forward/backward phase lobes plus decreasing-order scattering estimate.
  // This is an artist-tunable approximation, not a full multiple-scattering solver.
  var scatter=0.0;var attenuation=1.0;var energy=1.0;var anisotropy=1.0;
  for(var i=0u;i<4u;i++){
    let phase=.82*hg(mu,.65*anisotropy)+.18*hg(mu,-.25*anisotropy);
    scatter+=energy*phase*exp(-tau*attenuation);
    if(p.flags.z>1.5){break;}
    energy*=p.settings.w;attenuation*=.35;anisotropy*=.5;
  }
  let h=clamp((world.y-p.boundsMin.y)/(p.boundsMax.y-p.boundsMin.y),0.0,1.0);
  let ambient=mix(vec3(.025,.04,.065),vec3(.15,.22,.32),smoothstep(0.0,.7,h));
  let powder=mix(1.0,1.6*(1.0-exp(-d*2.0)),(1.0-smoothstep(-.2,.6,mu)));
  var sun=vec3(6.0,5.7,5.1)*scatter*max(.7,powder);
  if(p.flags.y>.5 && boxOccludes(world+p.sun.xyz*.01,p.sun.xyz,p.boxMin.xyz,p.boxMax.xyz)){sun=vec3(0.0);}
  return ambient+sun;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(compositeOut);if(any(id.xy>=size)){return;}
  let pixel=vec2<i32>(id.xy);let uv=(vec2<f32>(id.xy)+.5)/vec2<f32>(size);let ndc=vec2(uv.x*2.0-1.0,1.0-uv.y*2.0);
  let ray=normalize(worldAt(ndc,1.0)-p.camera.xyz);let depth=textureLoad(sceneDepth,pixel,0);
  let opaqueDistance=select(1e8,dot(worldAt(ndc,depth)-p.camera.xyz,ray),depth<.999999);
  let interval=boxInterval(p.camera.xyz,ray,p.boundsMin.xyz,p.boundsMax.xyz);
  let start=max(max(0.0,interval.x),dot(worldAt(ndc,0.0)-p.camera.xyz,ray));let end=min(interval.y,opaqueDistance);
  var T=1.0;var L=vec3(0.0);
  if(end>start){
    let steps=u32(p.settings.y);let ds=(end-start)/f32(steps);
    // Fixed per-pixel sample offset breaks coherent step sheets. No changing
    // frame seed: this experiment does not rely on unimplemented history.
    let jitter=fract(52.9829189*fract(dot(vec2<f32>(id.xy),vec2(.06711056,.00583715))));
    for(var i=0u;i<steps;i++){
      let world=p.camera.xyz+ray*(start+(f32(i)+jitter)*ds);let d=densityAt(world);
      if(d>0.0){let segmentT=exp(-d*p.settings.x*ds);var light=lighting(world,ray,d);if(p.flags.z>.5&&p.flags.z<1.5){light=vec3(1.0);}
        L+=T*(1.0-segmentT)*light;T*=segmentT;
        if(p.camera.w>.5 && T<.0001){break;}
      }
    }
  }
  var bg=textureLoad(sceneColor,pixel,0).rgb;
  if(p.flags.x>.5 && textureLoad(groundReceiver,pixel,0).r>.5 && abs(ray.y)>1e-7){
    let point=p.camera.xyz+ray*(-p.camera.y/ray.y);let intervalGround=boxInterval(vec3(point.x,.02,point.z),p.sun.xyz,p.boundsMin.xyz,p.boundsMax.xyz);
    let entry=max(0.0,intervalGround.x);
    if(intervalGround.y>entry){let sunPoint=vec3(point.x,.02,point.z)+p.sun.xyz*(entry+.1);bg*=.25+.75*exp(-opticalDepth(sunPoint));}
  }
  textureStore(cloudOut,pixel,vec4(L,T));textureStore(compositeOut,pixel,vec4(L+T*bg,1.0));
}
`;
