import { forwardOf, type ViewState } from './shared';

/** One camera for all panes: drag to look (orbit mode: around a pivot ahead of the camera), WASD/QE to fly, wheel = speed (fly) or distance (orbit). Listens on an overlay, not on any canvas. */
export class Rig {
  mode: 'fly' | 'orbit' = 'fly';
  speed = 60; // m/s
  orbitDistance = 500;
  private readonly keys = new Set<string>();
  private dragging = false;

  constructor(private readonly view: ViewState, dom: HTMLElement) {
    dom.addEventListener('pointerdown', e => { this.dragging = true; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const f = forwardOf(this.view), d = this.orbitDistance;
      const pivot = this.mode === 'orbit' ? [view.position[0] + f[0] * d, view.position[1] + f[1] * d, view.position[2] + f[2] * d] : null;
      view.lookAz = (view.lookAz + e.movementX * (this.mode === 'orbit' ? -0.25 : 0.15) + 360) % 360;
      view.pitch = Math.max(-89, Math.min(89, view.pitch + e.movementY * (this.mode === 'orbit' ? 0.25 : -0.15)));
      if (pivot) { const g = forwardOf(view); view.position = [pivot[0] - g[0] * d, Math.max(0.5, pivot[1] - g[1] * d), pivot[2] - g[2] * d]; }
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.001);
      if (this.mode === 'fly') this.speed = Math.max(1, Math.min(50000, this.speed / k));
      else { const f = forwardOf(this.view), d0 = this.orbitDistance; this.orbitDistance = Math.max(5, Math.min(200000, d0 * k)); const dd = this.orbitDistance - d0; view.position = [view.position[0] - f[0] * dd, Math.max(0.5, view.position[1] - f[1] * dd), view.position[2] - f[2] * dd]; }
    }, { passive: false });
    addEventListener('keydown', e => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) this.keys.add(e.code); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): void {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const f = k('KeyW') - k('KeyS'), r = k('KeyD') - k('KeyA'), u = k('KeyE') - k('KeyQ');
    if (!f && !r && !u) return;
    const fw = forwardOf(this.view), az = (this.view.lookAz * Math.PI) / 180;
    const right = [Math.cos(az), 0, Math.sin(az)];
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5 : 1, s = this.speed * boost * dt;
    const p = this.view.position;
    this.view.position = [p[0] + (fw[0] * f + right[0] * r) * s, Math.max(0.5, p[1] + (fw[1] * f + u) * s), p[2] + (fw[2] * f + right[2] * r) * s];
  }
}
