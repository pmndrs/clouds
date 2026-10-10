// D0: camera, sun and framing of every Decima frame of the pack clouds we reconstruct (work/reports/D0.md). The deck images
// themselves are third party and stay local (artifacts/research/extracted/n3/pptx/media, artifacts/research/d0-parity/ref).
// Positions are metres relative to the cloud's placement: the volume is centred on x = z = 0 with its base at y = 0 here (the page
// adds the base height). Cameras come from scripts/d0/d0.py fit (silhouette search over a splatted up-rez proxy). Suns, turbidity, exposure
// and sun colour are D1's fits under the 'decima' look (work/reports/D1.md: D0's suns were fitted under an ambient-dominated model and
// were 90-170 degrees off; s78 is lit from in front and high, s181 from behind-right and high). D1 round 6: suns re-derived from the frames'
// shading (scripts/d1/sunsweep.py: lobe corr + lit/shade map IoU over 84 directions, then a fine grid): s78 35/210, s191 20/100; the s191 and
// s181 cameras refined on the matte silhouette with the renderer itself (scripts/d1/camfit.py; D0 fitted them on a thin proxy). vfov is vertical, degrees, for a 16:9 frame.
// The deck frames have different skies: a clear blue gradient on s78 (turbidity 3), a mid-blue one on the pack renders (6) and a near-white
// hazy one on s181 (20, sky B/R 1.24). The turntable keeps s181's sun fixed to the camera (30 degrees left of the view, elevation 45).
export interface DecimaRef {
  /** Which pack cloud (assets/clouds/<cloud>). */
  cloud: 'parkouring' | 'stormbird';
  /** Deck slide and image (or video and time) it reproduces. */
  source: string;
  eye: [number, number, number];
  target: [number, number, number];
  vfov: number;
  /** Sun elevation and compass azimuth (degrees; north = -Z, east = +X). */
  sun: { elevation: number; azimuth: number };
  /** Sky haze (@pmndrs/sky turbidity, 1 = earth default) reconstructed for this frame. */
  turbidity?: number;
  /** Optional exposure for this frame (the page's default otherwise). */
  exposure?: number;
  /** D1: per-channel sky tint (@pmndrs/sky SkyLuminanceFactor) reconstructed for this frame; 1,1,1 otherwise. */
  skyFactor?: [number, number, number];
  /** D1: sun colour (linear) reconstructed for this frame; 1,1,1 otherwise. */
  sunColor?: [number, number, number];
  /** D1 round 2: the haze's forward-scatter phase (@pmndrs/sky miePhaseG, default 0.8); lower for the hazy frames so the sun halo spreads. */
  miePhaseG?: number;
  /** D1 round 3: mirror the sky below the horizon (the deck frames have no ground; their sky gradient continues below the horizon). */
  mirrorBelowHorizon?: boolean;
  /**
   * D1 round 7: scene settings of this frame applied after the look (what the scene around the cloud is, not how the cloud is lit): e.g.
   * `ambientBelowMirror` (the environment below the cloud: land under the s78 / s191 Parkouring frames, sky under the s181 turntable).
   */
  settings?: Record<string, number | string>;
}

export const DECIMA_REFS: Record<string, DecimaRef> = {
  // s78 image101 (up-rezzed; image102 is the same camera with the cheap profile), also s59/s77 image92 on black, s80 NVDF channel views.
  p101: { cloud: 'parkouring', source: 's78 image101', eye: [-297.7, 0, -628.5], target: [-95.6, 201.6, -6.8], vfov: 38.97, sun: { elevation: 35, azimuth: 210 }, turbidity: 3, exposure: 0.17, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [0.8, 0.95, 0.87], miePhaseG: 0.3 },
  // s101 image125-127 (wispy only / billowy only / blended) and s107 image133-136 (build steps): the same camera as s78, a little wider.
  p125: { cloud: 'parkouring', source: 's101 image125', eye: [-297.7, 0, -628.5], target: [-89.3, 197.5, -7.6], vfov: 40.69, sun: { elevation: 35, azimuth: 210 }, turbidity: 3, exposure: 0.135, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [0.8, 0.95, 0.87], miePhaseG: 0.3 },
  // s129 image161 (ambient without directionality) / image162 (with, N3 s128): Parkouring from the west-south-west, looking up.
  // D1: front-lit from behind the camera (el 30, az 240; the sweep's best corr 0.62), under a hazier, brighter sky than s78 (B/R 1.64).
  p161: { cloud: 'parkouring', source: 's129 image161/162', eye: [-1028.5, -244.6, -207.3], target: [-138.5, 209.0, 26.7], vfov: 34.55, sun: { elevation: 30, azimuth: 240 }, turbidity: 10, exposure: 0.19, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [2.0, 1.8, 1.3], miePhaseG: 0.3 },
  // s191 image213: the pack's own render of Parkouring (close to the s78 view).
  p213: { cloud: 'parkouring', source: 's191 image213', eye: [-261.5, 29.2, -654.2], target: [-52.4, 210.4, 27.7], vfov: 42.87, sun: { elevation: 20, azimuth: 100 }, turbidity: 6, exposure: 0.2, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [1.19, 1.46, 1.09], miePhaseG: 0.3 },
  // Stormbird: s181 image206 (the final model's still, also the media33 turntable), s191 image214 (the pack's render, from the other side).
  s206: { cloud: 'stormbird', source: 's181 image206', eye: [-695.3, -160.5, 23.4], target: [-13.6, 212.3, 37.9], vfov: 50.54, sun: { elevation: 45, azimuth: 60 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.096, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyFactor: [1.3, 1.46, 1.41] },
  // s181 media33 (37.6 s turntable, the cloud turns about -90 degrees every 3 s under a fixed camera and sun; t0 = s206). The sun keeps its
  // place relative to the camera, so here it turns with the camera around the cloud (D1: 30 degrees left of the view bearing, elevation 45).
  s33t3: { cloud: 'stormbird', source: 's181 media33 t=3 s', eye: [-12.1, -180.5, -658.3], target: [-12.1, 221.6, -32.3], vfov: 51.42, sun: { elevation: 45, azimuth: 150 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.096, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyFactor: [1.32, 1.47, 1.42] },
  s33t6: { cloud: 'stormbird', source: 's181 media33 t=6 s', eye: [952.8, -366.5, -70.2], target: [17.2, 240.7, -30.2], vfov: 35.76, sun: { elevation: 45, azimuth: 240 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.096, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyFactor: [1.32, 1.47, 1.42] },
  s33t9: { cloud: 'stormbird', source: 's181 media33 t=9 s', eye: [62.7, -180.5, 626.0], target: [51.4, 240.7, 12.7], vfov: 52.15, sun: { elevation: 45, azimuth: 330 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.096, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyFactor: [1.32, 1.47, 1.42] },
  s214: { cloud: 'stormbird', source: 's191 image214', eye: [627.9, -180.5, 60.8], target: [-3.4, 210.4, 13.2], vfov: 43.45, sun: { elevation: 40, azimuth: 220 }, turbidity: 6, exposure: 0.18, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [0.9, 1.13, 1.06], miePhaseG: 0.3 },
};

export const DECIMA_REF_NAMES = Object.keys(DECIMA_REFS);
