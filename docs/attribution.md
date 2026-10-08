# Preview attribution and provenance

Repository code and the original cube fixture use the root MIT license. Each
local package archive includes that license. The fixture's authoring recipe,
Blender version, export axes and conversion parameters are recorded in
[its README](../fixtures/authored/README.md).

## Dependencies

- Three.js 0.186.0 — MIT; external peer of rendering packages.
- React / React DOM 19.2.3 and React Three Fiber 10.0.0-alpha.5 — MIT;
  required only by the React binding.
- pmndrs/sky and pmndrs/scheduler — MIT; pinned workspace integration dependencies.
- The optional upscaler adapter uses the author's supplied 0.2.0 snapshot;
  exact provenance is in [vendor/README](../vendor/README.md). Its package notices
  remain in the supplied archive. The similarly versioned registry package is
  not interchangeable with this snapshot.
- Blender 5.1.1 is used externally to author the fixture and is not included in
  the packages. No Blender program code is embedded in the exported mesh.

The preview's dependency versions and integrity data are pinned in the lockfile;
local release archive hashes are generated into `artifacts/release/manifest.json`.

## Rendering research

The [quality research note](research/cloud-quality-bench.md) links Hillaire,
Nubis, Bowles/Zimmermann and other primary sources. Its shaders implement cited
concepts locally. No noncommercial Shadertoy shader was copied into the package;
linked examples retain their own licenses and are research references.

No OpenVDB/PicoVDB parser or writer is bundled or advertised by this preview.
