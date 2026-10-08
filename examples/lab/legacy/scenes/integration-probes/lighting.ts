import { SkyAtmosphereBaker } from '@pmndrs/sky';
import { Scene, PerspectiveCamera, Mesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, PlaneGeometry, SphereGeometry, BoxGeometry, DirectionalLight, Vector3, Color, type WebGPURenderer } from 'three/webgpu';
/** P0 integration fixture. The colored cube is an environment contribution, not a cloud. */
export function createLightingProbe(renderer: WebGPURenderer) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(48, 1, 0.1, 200);
  camera.position.set(8, 5, 10); camera.lookAt(0, 1, 0);
  const baker = new SkyAtmosphereBaker(renderer, { cubeSize: 64, enableAerialPerspective: false });
  baker.setSun({ elevation: 35, azimuth: 130 });
  const light = new DirectionalLight(0xfff2da, 3);
  light.position.set(5, 8, 3); light.castShadow = true;
  light.shadow.mapSize.set(512,512); light.shadow.camera.left=-10; light.shadow.camera.right=10;
  light.shadow.camera.top=10; light.shadow.camera.bottom=-10; light.shadow.camera.far=30;
  light.shadow.normalBias=0.04;
  scene.add(light, light.target);
  const floor = new Mesh(new PlaneGeometry(30,30), new MeshStandardNodeMaterial({ color: 0x87979c, roughness: 0.8 }));
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
  const diffuse = new Mesh(new SphereGeometry(1,32,24), new MeshStandardNodeMaterial({color:0xdfdfcf,roughness:0.7}));
  diffuse.position.set(-1.8,1,0); diffuse.castShadow=true; diffuse.receiveShadow=true; scene.add(diffuse);
  const mirror = new Mesh(new SphereGeometry(1,32,24), new MeshStandardNodeMaterial({color:0xffffff,metalness:1,roughness:0.14}));
  mirror.position.set(1.8,1,0); mirror.castShadow=true; mirror.receiveShadow=true; scene.add(mirror);
  const marker = new Mesh(new BoxGeometry(18,14,12), new MeshBasicNodeMaterial({color:new Color(0x3ccfc7).multiplyScalar(2)}));
  marker.position.set(0,12,20); marker.renderOrder=10; baker.skyScene.add(marker);
  let enabled = true;
  function refresh() {
    baker.setCamera(camera); baker.update();
    scene.background = baker.texture; scene.environment = baker.environmentTexture;
  }
  refresh();
  return {
    scene, camera, light,
    setContribution(value: boolean) { enabled = value; marker.visible=value; baker.markCubeDirty(); refresh(); },
    get contributionEnabled() { return enabled; },
    get evidence() { return { skyVersion:'0.3.0', contribution:enabled, environmentReady: !!scene.environment, shadowTextureReady: !!light.shadow.map?.depthTexture }; },
    setSun(elevation: number) {
      const a=elevation*Math.PI/180; light.position.copy(new Vector3(Math.cos(a)*8,Math.sin(a)*8,3));
      baker.setSun({elevation,azimuth:130}); refresh();
    },
    dispose() {
      scene.background=null; scene.environment=null;
      for (const mesh of [floor,diffuse,mirror,marker]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      light.shadow.dispose(); baker.dispose(); scene.clear();
    },
  };
}
