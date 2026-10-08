# @clouds/react

Unpublished WebGPU preview for React 19.2.3 and React Three Fiber 10.0.0-alpha.5.

```tsx
import { Canvas } from '@react-three/fiber/webgpu';
import { Cloudscape } from '@clouds/react';
import { CloudLayer } from '@clouds/react/layers';

<Canvas camera={{ position: [0, 1200, 2800], near: 1, far: 20000 }}>
  <Cloudscape />
  <CloudLayer height={5000} radius={60000} />
</Canvas>
```

The binding owns a volume runtime and its render-phase job on the caller's
WebGPU renderer. It renders the scene and clouds once; do not install a second
presentation job for that view. The independent layer uses the host scene.
Mount/unmount and camera/resize changes are demonstrated in the React lab.

Source banding, distant-cloud continuity, physical atmosphere, performance
presets and Windows/RTX validation remain open. This is not a stable API or
a WebGL fallback. See repository docs/react.md and docs/release-preview.md.
