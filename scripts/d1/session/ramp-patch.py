# D1 round 11: the sky ramp fix. 8 stops with smooth (smoothstep) easing in the WGSL and the @pmndrs look; the horizon haze on the clouds
# reads the physical LUT (not the ramp), so the base is not faded into the painted band; the ramp's ambient share is a strength of its own.
import re
p='packages/runtime/src/shaders/atmosphere.wgsl.ts'; s=open(p).read()
old="""  skyTint: vec3<f32>, rampStrength: f32,
  ramp0: vec4<f32>, ramp1: vec4<f32>, ramp2: vec4<f32>, ramp3: vec4<f32>,
}"""
new="""  skyTint: vec3<f32>, rampStrength: f32,
  ramp0: vec4<f32>, ramp1: vec4<f32>, ramp2: vec4<f32>, ramp3: vec4<f32>,
  ramp4: vec4<f32>, ramp5: vec4<f32>, ramp6: vec4<f32>, ramp7: vec4<f32>,   // D1 round 11: 8 stops, smoothstep between them (no kinks)
  rampAmbient: f32, rampPad0: f32, rampPad1: f32, rampPad2: f32,           // the ramp's weight in the hemisphere means (0..1)
}"""
assert old in s; s=s.replace(old,new,1)
old=s[s.find("// D1 round 10: the sky ramp at sin(elevation)"):s.find("fn atmSkyRadiance(viewZenithCos")]
new="""// D1 round 10/11: the sky ramp at sin(elevation): 8 stops ascending in w, smoothstep between neighbours (the round-10 linear stops printed
// their kinks as a stepped band), clamped outside.
fn atmRampSeg(c: vec3<f32>, a: vec4<f32>, b: vec4<f32>, sinEl: f32) -> vec3<f32> {
  return mix(c, b.xyz, smoothstep(0.0, 1.0, saturate((sinEl - a.w) / max(b.w - a.w, 1e-4))));
}
fn atmSkyRamp(sinEl: f32) -> vec3<f32> {
  var c = atmosphere.ramp0.xyz;
  c = atmRampSeg(c, atmosphere.ramp0, atmosphere.ramp1, sinEl); c = atmRampSeg(c, atmosphere.ramp1, atmosphere.ramp2, sinEl);
  c = atmRampSeg(c, atmosphere.ramp2, atmosphere.ramp3, sinEl); c = atmRampSeg(c, atmosphere.ramp3, atmosphere.ramp4, sinEl);
  c = atmRampSeg(c, atmosphere.ramp4, atmosphere.ramp5, sinEl); c = atmRampSeg(c, atmosphere.ramp5, atmosphere.ramp6, sinEl);
  c = atmRampSeg(c, atmosphere.ramp6, atmosphere.ramp7, sinEl);
  return c;
}
// The shaped sky radiance (LUT units): mix(LUT, ramp, strength) x tint, above the horizon only (below it the LUT's own lower hemisphere stays).
// strength = rampStrength for the sky seen directly, rampAmbient for the hemisphere means the clouds' ambient integrates (round 11: the band
// over-lit the bellies at full weight), 0 for the horizon haze on the clouds (round 11: the haze faded the base into the painted band).
fn atmSkyShapeW(lut: vec3<f32>, sinEl: f32, strength: f32) -> vec3<f32> {
  var c = lut;
  if (strength > 0.0) { c = mix(lut, atmSkyRamp(sinEl), strength * smoothstep(-0.04, 0.02, sinEl)); }
  return c * atmosphere.skyTint;
}
fn atmSkyShape(lut: vec3<f32>, sinEl: f32) -> vec3<f32> { return atmSkyShapeW(lut, sinEl, atmosphere.rampStrength); }
"""
s=s.replace(old,new,1)
# hemisphere means: the ambient weight
s=s.replace("      row += atmSkyShape(textureSampleLevel(atmSkyViewLut, atmSampler, vec2<f32>(uvX, uvY), 0.0).rgb, cos(theta));",
            "      row += atmSkyShapeW(textureSampleLevel(atmSkyViewLut, atmSampler, vec2<f32>(uvX, uvY), 0.0).rgb, cos(theta), atmosphere.rampAmbient);",1)
s=s.replace("      acc += atmSkyShape(textureSampleLevel(atmSkyViewLut, atmSampler, vec2<f32>(uvX, uvY), 0.0).rgb, cos(theta)) * w;",
            "      acc += atmSkyShapeW(textureSampleLevel(atmSkyViewLut, atmSampler, vec2<f32>(uvX, uvY), 0.0).rgb, cos(theta), atmosphere.rampAmbient) * w;",1)
# the haze: atmSkyRadianceToward reads the LUT without the ramp
old="""  return atmSkyRadiance(max(mu, horizon), cosPhi) * atmosphere.luminanceScale * atmosphere.sunColor;
}
// Premultiplied cloud radiance in"""
new="""  let dims = vec2<f32>(textureDimensions(atmSkyViewLut, 0));
  let lut = textureSampleLevel(atmSkyViewLut, atmSampler, atmSkyViewUv(max(mu, horizon), cosPhi, dims), 0.0).rgb;
  return atmSkyShapeW(lut, mu, 0.0) * atmosphere.luminanceScale * atmosphere.sunColor;   // D1 round 11: the haze colour is the physical sky's
}
// Premultiplied cloud radiance in"""
assert old in s; s=s.replace(old,new,1)
s=s.replace("/** Floats in the Atmosphere uniform (224 bytes). Offsets match the WGSL struct. */\nexport const ATMOSPHERE_UNIFORM_FLOATS = 56;",
            "/** Floats in the Atmosphere uniform (304 bytes). Offsets match the WGSL struct. */\nexport const ATMOSPHERE_UNIFORM_FLOATS = 76;",1)
old="  skyRamp?: { strength: number; stops: { at: number; color: ArrayLike<number> }[] } | null;\n}"
new="  skyRamp?: { strength: number; stops: { at: number; color: ArrayLike<number> }[]; ambient?: number } | null;\n}"
assert old in s; s=s.replace(old,new,1)
old="""  for (let i = 0; i < 4; i++) {
    const st = stops[Math.min(i, stops.length - 1)];
    out[40 + 4 * i] = st ? st.color[0] : 0; out[41 + 4 * i] = st ? st.color[1] : 0; out[42 + 4 * i] = st ? st.color[2] : 0; out[43 + 4 * i] = st ? st.at : 0;
  }
  return out;"""
new="""  for (let i = 0; i < 8; i++) {
    const st = stops[Math.min(i, stops.length - 1)];
    out[40 + 4 * i] = st ? st.color[0] : 0; out[41 + 4 * i] = st ? st.color[1] : 0; out[42 + 4 * i] = st ? st.color[2] : 0; out[43 + 4 * i] = st ? st.at : 0;
  }
  out[72] = v.skyRamp && v.skyRamp.stops.length > 0 ? (v.skyRamp.ambient ?? v.skyRamp.strength) : 0; out[73] = 0; out[74] = 0; out[75] = 0;
  return out;"""
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)
for p in ('packages/three/src/sky-bridge.ts','examples/lab/flagship/sky-bridge.ts'):
    s=open(p).read()
    old="  skyRamp: { strength: number; stops: { at: number; color: [number, number, number] }[] } | null;"
    new="  skyRamp: { strength: number; stops: { at: number; color: [number, number, number] }[]; ambient?: number } | null;"
    assert old in s, p; s=s.replace(old,new,1)
    old="values.skyRamp = ramp ? { strength: ramp.strength, stops:"
    new="values.skyRamp = ramp ? { strength: ramp.strength, ambient: ramp.ambient, stops:"
    assert old in s, p; s=s.replace(old,new,1)
    open(p,'w').write(s)
p='examples/lab/decima/main.ts'; s=open(p).read()
old="""    // ramp:0 = the physical LUT; 1 = painted sky, the clouds' ambient integrates it; 2 (round 11) = painted sky only, the ambient from the LUT.
    const rampMode = v.has('ramp') ? Number(v.get('ramp')![0]) : (ref.skyRamp ? 1 : 0);
    const rampOn = rampMode > 0;
    const rampKey = rampOn && ref.skyRamp ? JSON.stringify(ref.skyRamp) + skyf.join() + rampMode : '';"""
new="""    // ramp:0 = the physical LUT; 1 = painted sky, the clouds' ambient integrates it; 2 (round 11) = painted sky only, the ambient from the LUT;
    // ramp:1:a = painted sky with the ambient's ramp weight a (0..1). The look's stops ease smoothly (round 11: linear stops printed a stepped band).
    const rampArgs = v.has('ramp') ? v.get('ramp')!.map(Number) : [];
    const rampMode = rampArgs.length ? rampArgs[0] : (ref.skyRamp ? 1 : 0);
    const rampAmbient = rampMode === 2 ? 0 : rampArgs.length > 1 ? rampArgs[1] : (ref.skyRampAmbient ?? 1);
    const rampOn = rampMode > 0;
    const rampKey = rampOn && ref.skyRamp ? JSON.stringify(ref.skyRamp) + skyf.join() + rampMode + ':' + rampAmbient : '';"""
assert old in s; s=s.replace(old,new,1)
old="""        const stops = ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0] / skyf[0], st.color[1] / skyf[1], st.color[2] / skyf[2]] }));
        sky.setLook(resolveLook({ stops, chroma: 1, value: 1, intensity: 1 }));
        skyBridge.skyRamp = rampMode === 2 ? null : { strength: 1, stops: ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0], st.color[1], st.color[2]] })) };"""
new="""        const stops = ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0] / skyf[0], st.color[1] / skyf[1], st.color[2] / skyf[2]], ease: 'smooth' as const }));
        sky.setLook(resolveLook({ stops, chroma: 1, value: 1, intensity: 1 }));
        skyBridge.skyRamp = { strength: 1, ambient: rampAmbient, stops: ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0], st.color[1], st.color[2]] })) };"""
assert old in s; s=s.replace(old,new,1)
s=s.replace("@ramp:0|1|2  @skytint","@ramp:0|1|2[:ambientWeight]  @skytint",1)
open(p,'w').write(s)
p='examples/lab/decima/refs.ts'; s=open(p).read()
old="  skyRamp?: { at: number; color: [number, number, number] }[];"
new=old+"\n  /** D1 round 11: the ramp's weight in the clouds' ambient (0 = the LUT's hemisphere means, 1 = the painted sky's). Default 1. */\n  skyRampAmbient?: number;"
assert old in s; s=s.replace(old,new,1); open(p,'w').write(s)
print('ramp patch applied')
