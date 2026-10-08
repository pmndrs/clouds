# React bindings

`@clouds/legacy-react` is the React Three Fiber v10 WebGPU adapter for the vanilla
`@clouds/legacy-three` runtime. It uses the renderer and frame loop owned by the
caller. It does not create a renderer, device, or animation loop.

```tsx
import { Canvas } from '@react-three/fiber/webgpu'
import { Cloudscape } from '@clouds/legacy-react'
import { CloudLayer } from '@clouds/legacy-react/layers'

export function SkyView() {
  return (
    <Canvas camera={{ position: [0, 900, 2800], fov: 45, near: 1, far: 10000 }}>
      <Cloudscape>
        <directionalLight position={[-1200, 2400, 900]} intensity={3} />
        <CloudLayer coverage={0.5} density={0.65} />
      </Cloudscape>
    </Canvas>
  )
}
```

The binding is tested against React `19.2.3`, Three `0.186.0`, and
`@react-three/fiber@10.0.0-alpha.5`. Import the WebGPU entry point explicitly.
`Cloudscape` requires a perspective camera and conventional WebGPU depth.

`Cloudscape` creates one runtime per mounted view. Its render-phase job calls
the vanilla runtime's complete sequence: opaque scene MRT, cloud integration,
and final presentation. Because that job owns the render phase, R3F does not
submit a second default scene render. `CloudLayer` is an independent
transparent dome; it updates during R3F's update phase and does not import the
volumetric runtime.

`DensityCloud` and `useDensityCloud` provide the bounded dense-field runtime on
the same caller-owned renderer and render phase:

```tsx
import { DensityCloud } from '@clouds/legacy-react'
import { createDensityField } from '@clouds/legacy-three'

const field = createDensityField('cumulus', 64, 17)

<DensityCloud field={field} appearance="realistic" resolutionScale={0.67} />
```

The optional `occluder` supplies the axis-aligned scene box used by the
reference shadow path. Replacing `field` calls the runtime's `setField` and
releases the previous GPU textures; changing `appearance` or `occluder`
recreates the runtime. `onReady` receives a disposable handle, and
`readOpticalDepthCache()` is available on the realistic runtime for diagnostics.

CPU atlases and worlds are memoized when omitted. Pass a stable `source` or
`world` when sharing one between views. A `CloudWorld` is updated from the
active camera before each cloud frame; an immutable `WorldSnapshot` is used as
provided. GPU resources are released on unmount or source replacement, and
`onReady` receives a handle for diagnostics or explicit cleanup. The
`CloudLayer` `onReady` handle can likewise be disposed while mounted; that
immediately detaches its mesh and stops its update job, and the component can
be toggled off and on to create a fresh layer.

The default quality is full-resolution cloud and scene output with temporal
guides disabled. Use `quality={{ resolutionScale: 0.67 }}` for a lower cloud
integration resolution; use `sceneResolutionScale` independently when the
opaque scene target should also be reduced.

The React lab's **Run vanilla parity check** button pauses the R3F loop,
renders the same caller-owned atlas, world snapshot, settings, scene, and
camera through a separate non-presenting vanilla runtime, then compares the
optical readback. It reports the maximum L/T error against a `1e-5` threshold
and disposes the reference runtime before resuming the loop.
