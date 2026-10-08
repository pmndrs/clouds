import './style.css';
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { createCloudLayer } from '../../packages/legacy/three/src/layers';

const app = document.querySelector<HTMLElement>('#app')!;
const errorElement = document.querySelector<HTMLDivElement>('#error')!;
const coverage = document.querySelector<HTMLInputElement>('#coverage')!;
const density = document.querySelector<HTMLInputElement>('#density')!;
const coverageValue = document.querySelector<HTMLOutputElement>('#coverage-value')!;
const densityValue = document.querySelector<HTMLOutputElement>('#density-value')!;

async function start(): Promise<void> {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open this example in a WebGPU-enabled desktop browser.');

  const renderer = new WebGPURenderer({ antialias: true, alpha: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x789bc6);

  const camera = new PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(18, 8, 24);
  camera.lookAt(0, 22, -28);

  const sun = new DirectionalLight(0xffe6bd, 3.1);
  sun.position.set(-30, 70, 18);
  sun.target.position.set(0, 0, -30);
  scene.add(sun, sun.target);

  const ground = new Mesh(
    new PlaneGeometry(700, 700),
    new MeshStandardNodeMaterial({ color: 0x526f62, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.receiveShadow = true;
  scene.add(ground);

  const marker = new Mesh(
    new SphereGeometry(4, 32, 20),
    new MeshStandardNodeMaterial({ color: 0xd8d5c0, roughness: 0.7 }),
  );
  marker.position.set(0, 2, -30);
  marker.castShadow = true;
  marker.receiveShadow = true;
  scene.add(marker);

  const layer = createCloudLayer({
    radius: 240,
    height: 90,
    cloudScale: 0.018,
    wind: [0.75, 0.12],
    coverage: Number(coverage.value),
    density: Number(density.value),
    sunDirection: new Vector3(-0.34, 0.88, 0.25),
  });
  scene.add(layer.mesh);

  let yaw = 0;
  let pitch = -0.18;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener('pointerdown', event => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.004;
    pitch = Math.max(-0.75, Math.min(0.45, pitch + (event.clientY - lastY) * 0.003));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  renderer.domElement.addEventListener('pointerup', event => {
    dragging = false;
    renderer.domElement.releasePointerCapture(event.pointerId);
  });

  function updateCamera(): void {
    const distance = 30;
    camera.position.set(Math.sin(yaw) * distance, 9 + pitch * 8, Math.cos(yaw) * distance);
    camera.lookAt(0, 21, -30);
  }
  updateCamera();

  coverage.addEventListener('input', () => {
    const value = Number(coverage.value);
    layer.setCoverage(value);
    coverageValue.value = `${Math.round(value * 100)}%`;
  });
  density.addEventListener('input', () => {
    const value = Number(density.value);
    layer.setDensity(value);
    densityValue.value = `${Math.round(value * 100)}%`;
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(time => {
    updateCamera();
    layer.update(time / 1000);
    renderer.render(scene, camera);
  });
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    layer.dispose();
    ground.geometry.dispose();
    (ground.material as MeshStandardNodeMaterial).dispose();
    marker.geometry.dispose();
    (marker.material as MeshStandardNodeMaterial).dispose();
    renderer.dispose();
  }, { once: true });
}

void start().catch(error => {
  errorElement.hidden = false;
  errorElement.textContent = error instanceof Error ? error.message : String(error);
});

