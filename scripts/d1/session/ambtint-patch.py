# D1 round 11: @ambtint:r:g:b (refs.ambientTint): a per-scene tint of the sky radiance the clouds see (times the sky's luminance factor), the
# sky mesh untouched: the lever for a mauve shade under a pink sun without warming the sky.
p='examples/lab/decima/main.ts'; s=open(p).read()
old="    skyBridge.skyTintToAmbient = !(v.has('skytint') && v.get('skytint')![0] === '0');   // D1 round 11 A/B: skytint:0 = the round-9 plumbing"
new="""    skyBridge.skyTintToAmbient = !(v.has('skytint') && v.get('skytint')![0] === '0');   // D1 round 11 A/B: skytint:0 = the round-9 plumbing
    // D1 round 11 (ambtint:r:g:b, refs.ambientTint): a per-scene tint of the sky radiance the clouds see (on top of the luminance factor); the sky mesh untouched.
    const ambtint = v.has('ambtint') ? v.get('ambtint')!.map(Number) : (ref.ambientTint ?? [1, 1, 1]);
    skyBridge.ambientTint = [ambtint[0], ambtint[1], ambtint[2]];"""
assert old in s; s=s.replace(old,new,1)
s=s.replace("@skytint:0|1  @matte","@skytint:0|1  @ambtint:r:g:b  @matte",1)
open(p,'w').write(s)
p='examples/lab/decima/refs.ts'; s=open(p).read()
old="  skyRampAmbient?: number;"
new=old+"\n  /** D1 round 11: a per-scene tint of the sky radiance the clouds see (the ambient's colour), on top of skyFactor; the sky mesh untouched. */\n  ambientTint?: [number, number, number];"
assert old in s; s=s.replace(old,new,1); open(p,'w').write(s)
for p in ('packages/three/src/sky-bridge.ts','examples/lab/flagship/sky-bridge.ts'):
    s=open(p).read()
    old="  skyTintToAmbient: boolean;"
    new=old+"\n  /** D1 round 11: a further per-channel tint of the sky radiance the clouds see (the ambient's colour). Default white. */\n  ambientTint: [number, number, number];"
    assert old in s, p; s=s.replace(old,new,1)
    old="      if (bridge.skyTintToAmbient) { skyTint[0] = skyf.x; skyTint[1] = skyf.y; skyTint[2] = skyf.z; } else { skyTint[0] = 1; skyTint[1] = 1; skyTint[2] = 1; }"
    new=old+"\n      skyTint[0] *= bridge.ambientTint[0]; skyTint[1] *= bridge.ambientTint[1]; skyTint[2] *= bridge.ambientTint[2];"
    assert old in s, p; s=s.replace(old,new,1)
    old="    skyTintToAmbient: true,\n"
    new="    skyTintToAmbient: true,\n    ambientTint: [1, 1, 1],\n"
    assert old in s, p; s=s.replace(old,new,1)
    open(p,'w').write(s)
print('ambtint patch applied')
