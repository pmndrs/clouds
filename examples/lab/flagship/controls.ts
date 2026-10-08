import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraMode = 'orbit' | 'fly';

/** Orbit (OrbitControls) plus WASD free-fly with a wheel-scaled speed (1 m/s .. 100 km/s), so it works from metres to tens of km. */
export class CameraRig {
  mode: CameraMode = 'orbit';
  speed = 200; // m/s
  readonly orbit: OrbitControls;
  private yaw = 0; private pitch = 0;
  private readonly keys = new Set<string>();
  private readonly tmp = new Vector3();
  private readonly euler = new Euler();
  private dragging = false;

  constructor(readonly camera: PerspectiveCamera, dom: HTMLElement) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.minDistance = 1; this.orbit.maxDistance = 200000; this.orbit.enableDamping = false;
    dom.addEventListener('pointerdown', e => { if (this.mode === 'fly') { this.dragging = true; dom.setPointerCapture(e.pointerId); } });
    dom.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('pointermove', e => {
      if (this.mode !== 'fly' || !this.dragging) return;
      this.yaw -= e.movementX * 0.003;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.003));
    });
    dom.addEventListener('wheel', e => { if (this.mode === 'fly') this.speed = Math.max(1, Math.min(100000, this.speed * Math.exp(-e.deltaY * 0.001))); }, { passive: true });
    window.addEventListener('keydown', e => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'fly') {
      const d = this.camera.getWorldDirection(this.tmp);
      this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(d.y);
    } else {
      const dist = Math.max(10, this.speed);
      this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(this.tmp), dist);
      this.orbit.update();
    }
  }

  /** Place the camera and aim it; works in either mode. */
  set(position: readonly number[], target: readonly number[]): void {
    this.camera.position.set(position[0], position[1], position[2]);
    this.orbit.target.set(target[0], target[1], target[2]);
    this.camera.lookAt(this.orbit.target);
    const d = this.camera.getWorldDirection(this.tmp);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(d.y);
    this.orbit.update();
  }

  update(dt: number): void {
    if (this.mode === 'orbit') { this.orbit.update(); return; }
    const c = this.camera;
    c.quaternion.setFromEuler(this.euler.set(this.pitch, this.yaw, 0, 'YXZ'));
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const f = k('KeyW') - k('KeyS'), r = k('KeyD') - k('KeyA'), u = k('KeyE') - k('KeyQ');
    if (f || r || u) {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5 : 1;
      this.tmp.set(r, 0, -f).applyQuaternion(c.quaternion).addScaledVector(new Vector3(0, 1, 0), u);
      if (this.tmp.lengthSq() > 0) c.position.addScaledVector(this.tmp.normalize(), this.speed * boost * dt);
    }
    this.orbit.target.copy(c.position).addScaledVector(c.getWorldDirection(this.tmp), 100);
  }
}
