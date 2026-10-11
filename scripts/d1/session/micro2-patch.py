# D1 round 11: a second micro-occlusion scale (microDist2 m, weight microShadow2): the tap from microDist to microDist2 toward the sun,
# residual (up-rez over profile) like the first; d4 = (microDist2, microShadow2, 0, 0); FRAME_UNIFORM_BYTES 480 -> 496.
p='packages/runtime/src/shaders/frame.wgsl.ts'; s=open(p).read()
old="  d3: vec4<f32>,\n}"
new="  d3: vec4<f32>,\n  // D1 round 11: x = microDist2 (m, a second micro sun tap from microDist to microDist2; 0 = off), y = microShadow2 (its occlusion weight), zw = 0.\n  d4: vec4<f32>,\n}"
assert old in s; s=s.replace(old,new,1)
assert "FRAME_UNIFORM_BYTES = 480" in s; s=s.replace("FRAME_UNIFORM_BYTES = 480","FRAME_UNIFORM_BYTES = 496",1)
open(p,'w').write(s)
p='packages/runtime/src/shaders/march.wgsl.ts'; s=open(p).read()
old="""              var microOcc = exp(-frame.microShadow * (tauMicro + tauNear));
              if (frame.d3.w > 0.5) { microOcc = exp(-frame.microShadow * min(max(tauMicro - tauMicroP, 0.0), 4.0)); }"""
new="""              var microOcc = exp(-frame.microShadow * (tauMicro + tauNear));
              if (frame.d3.w > 0.5) { microOcc = exp(-frame.microShadow * min(max(tauMicro - tauMicroP, 0.0), 4.0)); }
              // D1 round 11 (microDist2 / microShadow2): a second, longer tap (microDist..microDist2 m) with its own weight, so the glow's
              // occlusion carries two floret scales (the frames tile 10-30 px domes plus grain; one tap gave one bubble size).
              if (frame.d4.x > frame.microDist && microOn && sdf > -MICRO_DEPTH) {
                let len2 = frame.d4.x - frame.microDist;
                let s2 = ${density}(ps + frame.sunDir * (frame.microDist + 0.5 * len2), ts, inputs);
                let res2 = select((s2.x + tauNear * 0.0) * len2 * microExt, max(s2.x - s2.y, 0.0) * len2 * microExt, frame.d3.w > 0.5);
                microOcc *= exp(-frame.d4.y * min(res2, 4.0));
              }"""
assert old in s; s=s.replace(old,new,1); open(p,'w').write(s)
p='packages/runtime/src/runtime.ts'; s=open(p).read()
old="  microShadowMode: number;\n"
new="""  microShadowMode: number;
  /** D1 round 11: a second micro sun tap from `microDist` to this distance (m; 0 = off) with its own occlusion weight `microShadow2`: two floret scales. */
  microDist2: number;
  microShadow2: number;
"""
assert old in s; s=s.replace(old,new,1)
old="microLightScale: 0, microShadowMode: 0, noiseScale: 0.01,"
new="microLightScale: 0, microShadowMode: 0, microDist2: 0, microShadow2: 0, noiseScale: 0.01,"
assert old in s; s=s.replace(old,new,1)
old="f[119] = settings.microShadowMode;"
new="f[119] = settings.microShadowMode; f[120] = Math.max(0, settings.microDist2); f[121] = Math.max(0, settings.microShadow2); f[122] = 0; f[123] = 0;"
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s)
# the Stormbird suns back to round 9's (the sheets did not show a win)
import re
p='examples/lab/decima/refs.ts'; s=open(p).read()
for ref,old,new in (('s206','sun: { elevation: 35, azimuth: 40 }','sun: { elevation: 45, azimuth: 60 }'),('s33t3','sun: { elevation: 35, azimuth: 130 }','sun: { elevation: 45, azimuth: 150 }'),('s33t6','sun: { elevation: 35, azimuth: 220 }','sun: { elevation: 45, azimuth: 240 }'),('s33t9','sun: { elevation: 35, azimuth: 330 }','sun: { elevation: 45, azimuth: 330 }')):
    m=re.search(r"\n  %s: \{[^\n]*\n"%ref, s); line=m.group(0); assert old in line, ref; s=s.replace(line, line.replace(old,new,1),1)
open(p,'w').write(s)
print('micro2 patch + suns reverted')
