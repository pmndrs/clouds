import { useFrame, useThree } from '@react-three/fiber/webgpu';
import {
  createCloudLayer,
  type CloudLayer as CloudLayerRuntime,
  type CloudLayerOptions,
} from '@clouds/three/layers';
import { useEffect, useRef } from 'react';

export interface CloudLayerProps extends CloudLayerOptions {
  enabled?: boolean;
  renderPriority?: number;
  onReady?: (layer: CloudLayerRuntime) => void;
}

/** React wrapper for the independent lightweight cloud layer. */
export function CloudLayer(props: CloudLayerProps) {
  const { enabled = true, renderPriority = 0, onReady, ...options } = props;
  const scene = useThree((state) => state.scene);
  const layerRef = useRef<CloudLayerRuntime | null>(null);
  const onReadyRef = useRef(onReady);
  const enabledRef = useRef(enabled);
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    onReadyRef.current = onReady;
    enabledRef.current = enabled;
  }, [enabled, onReady]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.mesh.visible = enabled;
  }, [enabled]);

  useEffect(() => {
    const created = createCloudLayer(options);
    const managed: CloudLayerRuntime = {
      ...created,
      dispose() {
        if (layerRef.current === managed) layerRef.current = null;
        scene.remove(managed.mesh);
        created.dispose();
      },
    };
    layerRef.current = managed;
    scene.add(managed.mesh);
    managed.mesh.visible = enabled;
    onReadyRef.current?.(managed);
    return () => {
      if (layerRef.current === managed) layerRef.current = null;
      scene.remove(managed.mesh);
      managed.dispose();
    };
  }, [scene, optionsKey]);

  useFrame((state) => {
    if (enabledRef.current) layerRef.current?.update(state.elapsed);
  }, { phase: 'update', priority: renderPriority });

  // The mesh is attached imperatively so its ownership and disposal stay in
  // one effect. This avoids R3F's primitive disposal path touching it twice.
  return null;
}

export { createCloudLayer };
export type CloudLayer = CloudLayerRuntime;
export type { CloudLayerOptions };
