# D1 round 11: directProfile (0..1): the direct term weighted by the in-scatter probability (the deck's profile P as the scattering probability of thin
# material: dark edges), so thin rims, fringes and base skirts stop lighting up white over the sky. d4.z.
p='packages/runtime/src/shaders/lighting.wgsl.ts'; s=open(p).read()
old="  let direct = sunRadiance * (exp(-tau) * phase);"
new="""  // D1 round 11 (directProfile, frame.d4.z): the direct term weighted by the in-scatter probability too (the deck's profile as the scattering
  // probability of thin material: dark edges), so a thin rim, a base skirt or a detached wisp is not lit white by the sun over the sky.
  let direct = sunRadiance * (exp(-tau) * phase) * mix(1.0, saturate(profile), frame.d4.z);"""
assert old in s; s=s.replace(old,new,1); open(p,'w').write(s)
p='packages/runtime/src/shaders/frame.wgsl.ts'; s=open(p).read()
old="y = microShadow2 (its occlusion weight), zw = 0."
new="y = microShadow2 (its occlusion weight), z = directProfile (the direct term weighted by the in-scatter probability, 0..1), w = 0."
assert old in s; s=s.replace(old,new,1); open(p,'w').write(s)
p='packages/runtime/src/runtime.ts'; s=open(p).read()
old="  microDist2: number;\n  microShadow2: number;\n"
new=old+"  /** D1 round 11: the direct term weighted by the in-scatter probability (0 = none, 1 = fully; the deck's dark edges on thin material). */\n  directProfile: number;\n"
assert old in s; s=s.replace(old,new,1)
old="microDist2: 0, microShadow2: 0, noiseScale: 0.01,"
new="microDist2: 0, microShadow2: 0, directProfile: 0, noiseScale: 0.01,"
assert old in s; s=s.replace(old,new,1)
old="f[122] = 0; f[123] = 0;"
new="f[122] = Math.min(1, Math.max(0, settings.directProfile)); f[123] = 0;"
assert old in s; s=s.replace(old,new,1)
open(p,'w').write(s); print('directProfile patch applied')
