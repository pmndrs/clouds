// D0: camera, sun and framing of every Decima frame of the pack clouds we reconstruct (work/reports/D0.md). The deck images
// themselves are third party and stay local (artifacts/research/extracted/n3/pptx/media, artifacts/research/d0-parity/ref).
// Positions are metres relative to the cloud's placement: the volume is centred on x = z = 0 with its base at y = 0 here (the page
// adds the base height). Cameras come from scripts/d0/d0.py fit (silhouette search over a splatted up-rez proxy). Suns, turbidity, exposure
// D1 round 8: every frame is a still, so the wind is stopped (settings.animSpeed 0): with the noise scrolling, the temporal resolve smeared
// the florets by 2-4 px at 4k. D1 round 9: the Parkouring frames have land below the cloud (ambientBelowMirror 0: the dark belly band of the
// frames; the s181 turntable keeps the mirrored sky below) and the s181 turntable, under its turbidity-20 sky, lights its shade with
// ambientStrength 1.0 at exposure 0.09 (the frames' sky is 1.3-1.5x brighter than ours at the matched cloud median and skyFactor does not
// reach the cloud's ambient; measured in round 9: shade p10 0.46 -> 0.49 against the frames' 0.52, median 0.56 -> 0.58 against 0.56). Sun, turbidity, exposure
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
  /** Camera roll in degrees about the view axis (tuning panel / @roll:deg); 0 when absent. */
  roll?: number;
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
  /** D1 round 10: the sky's haze band [Mie scale height km, multiple-scattering factor, Rayleigh multiplier] (main.ts @atm; Earth 1.2, 1, 1). */
  atmosphere?: [number, number, number];
  /**
   * D1 round 10: the frame's sky as a ramp over sin(elevation) (scratchpad skyfit.py: the frame's sky rows through the inverse of the page's post
   * chain at the ref's exposure), linear radiance in the page's units before the post. The page paints the sky with it (@pmndrs/sky look, value 1)
   * and the clouds' ambient integrates it (sky bridge skyRamp); the frames' upper sky is flat and their horizon a pale band the Earth LUT cannot shape.
   */
  skyRamp?: { at: number; color: [number, number, number] }[];
  /** D1 round 11: the ramp's weight in the clouds' ambient (0 = the LUT's hemisphere means, 1 = the painted sky's). Default 0 (round 10's 1 over-lit the bellies). */
  skyRampAmbient?: number;
  /** D1 round 11: a per-scene tint of the sky radiance the clouds see (the ambient's colour), on top of skyFactor; the sky mesh untouched. */
  ambientTint?: [number, number, number];
  /** D1 round 12: the clouds' sun colour apart from the sky's (the frames' pink lit faces under a cool sky). */
  sunTint?: [number, number, number];
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
  p101: { cloud: 'parkouring', source: 's78 image101', eye: [-297.7, 0, -628.5], target: [-95.6, 181.6, -16.8], vfov: 39.34, /* D1 round 10: camfit.py --step 20, matte IoU 0.838 -> 0.859 (the cloud sat low and large) */ sun: { elevation: 35, azimuth: 210 }, turbidity: 3, exposure: 0.17, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [0.8, 0.95, 0.87], miePhaseG: 0.3, skyRamp: [{ at: -0.1, color: [1.58, 3.18, 5.36] }, { at: 0.02, color: [1.54, 3.10, 5.22] }, { at: 0.07, color: [1.30, 2.61, 4.37] }, { at: 0.13, color: [1.07, 2.13, 3.55] }, { at: 0.2, color: [0.86, 1.71, 2.81] }, { at: 0.3, color: [0.64, 1.27, 2.06] }, { at: 0.45, color: [0.45, 0.87, 1.37] }, { at: 0.8, color: [0.27, 0.50, 0.74] }], sunTint: [1.06, 1, 0.94], settings: { animSpeed: 0, ambientBelowMirror: 0, lightDensityScale: 0.045 } },
  // s101 image125-127 (wispy only / billowy only / blended) and s107 image133-136 (build steps): the same camera as s78, a little wider.
  p125: { cloud: 'parkouring', source: 's101 image125', eye: [-297.7, 0, -628.5], target: [-89.3, 197.5, -7.6], vfov: 40.69, sun: { elevation: 35, azimuth: 210 }, turbidity: 3, exposure: 0.135, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyFactor: [0.8, 0.95, 0.87], miePhaseG: 0.3, skyRamp: [{ at: -0.1, color: [1.58, 3.18, 5.36] }, { at: 0.02, color: [1.54, 3.10, 5.22] }, { at: 0.07, color: [1.30, 2.61, 4.37] }, { at: 0.13, color: [1.07, 2.13, 3.55] }, { at: 0.2, color: [0.86, 1.71, 2.81] }, { at: 0.3, color: [0.64, 1.27, 2.06] }, { at: 0.45, color: [0.45, 0.87, 1.37] }, { at: 0.8, color: [0.27, 0.50, 0.74] }], sunTint: [1.06, 1, 0.94], settings: { animSpeed: 0, ambientBelowMirror: 0, lightDensityScale: 0.045 } },
  // s129 image161 (ambient without directionality) / image162 (with, N3 s128): Parkouring from the west-south-west, looking up.
  // D1: front-lit from behind the camera (el 30, az 240; the sweep's best corr 0.62), under a hazier, brighter sky than s78 (B/R 1.64).
  p161: { cloud: 'parkouring', source: 's129 image161/162', eye: [-1028.5, -244.6, -207.3], target: [-138.5, 209.0, 26.7], vfov: 34.55, sun: { elevation: 30, azimuth: 240 }, turbidity: 10, exposure: 0.19, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyRamp: [{ at: -0.1, color: [1.73, 3.57, 6.40] }, { at: 0.02, color: [1.73, 3.57, 6.40] }, { at: 0.07, color: [1.73, 3.57, 6.40] }, { at: 0.13, color: [1.73, 3.57, 6.40] }, { at: 0.2, color: [1.37, 2.76, 4.88] }, { at: 0.3, color: [0.87, 1.64, 2.76] }, { at: 0.45, color: [0.65, 1.16, 1.85] }, { at: 0.8, color: [0.60, 1.04, 1.62] }], sunTint: [1.06, 1, 0.94], settings: { animSpeed: 0, ambientBelowMirror: 0, lightDensityScale: 0.045 } },
  // s191 image213: the pack's own render of Parkouring (close to the s78 view).
  p213: { cloud: 'parkouring', source: 's191 image213', eye: [-261.5, 29.2, -654.2], target: [-52.4, 210.4, 27.7], vfov: 42.87, sun: { elevation: 20, azimuth: 100 }, turbidity: 6, exposure: 0.2, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyRamp: [{ at: -0.1, color: [8.65, 7.90, 8.46] }, { at: 0.02, color: [7.45, 6.90, 7.48] }, { at: 0.07, color: [4.84, 4.74, 5.33] }, { at: 0.13, color: [2.93, 3.16, 3.76] }, { at: 0.2, color: [1.69, 2.13, 2.74] }, { at: 0.3, color: [0.86, 1.44, 2.05] }, { at: 0.45, color: [0.45, 1.10, 1.71] }, { at: 0.8, color: [0.31, 0.98, 1.60] }], sunTint: [1.06, 1, 0.94], settings: { animSpeed: 0, ambientBelowMirror: 0, lightDensityScale: 0.045 } },
  // Stormbird: s181 image206 (the final model's still, also the media33 turntable), s191 image214 (the pack's render, from the other side).
  s206: { cloud: 'stormbird', source: 's181 image206', eye: [-695.3, -160.5, 23.4], target: [-13.6, 212.3, 37.9], vfov: 50.54, sun: { elevation: 45, azimuth: 60 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.09, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyRamp: [{ at: -0.1, color: [12.77, 12.00, 15.00] }, { at: 0.02, color: [12.77, 12.00, 15.00] }, { at: 0.07, color: [12.77, 12.00, 15.00] }, { at: 0.13, color: [7.29, 7.12, 9.03] }, { at: 0.2, color: [4.29, 4.46, 5.76] }, { at: 0.3, color: [2.66, 3.01, 3.99] }, { at: 0.45, color: [2.06, 2.48, 3.34] }, { at: 0.8, color: [1.94, 2.37, 3.20] }], sunTint: [1.12, 1, 0.88], settings: { animSpeed: 0, ambientStrength: 1.0 } },
  // s181 media33 (37.6 s turntable, the cloud turns about -90 degrees every 3 s under a fixed camera and sun; t0 = s206). The sun keeps its
  // place relative to the camera, so here it turns with the camera around the cloud (D1: 30 degrees left of the view bearing, elevation 45).
  s33t3: { cloud: 'stormbird', source: 's181 media33 t=3 s', eye: [-12.1, -180.5, -658.3], target: [-12.1, 221.6, -32.3], vfov: 51.42, sun: { elevation: 45, azimuth: 150 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.09, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyRamp: [{ at: -0.1, color: [12.36, 11.52, 14.09] }, { at: 0.02, color: [12.36, 11.52, 14.09] }, { at: 0.07, color: [12.36, 11.52, 14.09] }, { at: 0.13, color: [12.36, 11.52, 14.09] }, { at: 0.2, color: [6.63, 6.49, 8.13] }, { at: 0.3, color: [3.35, 3.60, 4.71] }, { at: 0.45, color: [2.14, 2.54, 3.45] }, { at: 0.8, color: [1.89, 2.32, 3.19] }], sunTint: [1.12, 1, 0.88], settings: { animSpeed: 0, ambientStrength: 1.0 } },
  s33t6: { cloud: 'stormbird', source: 's181 media33 t=6 s', eye: [952.8, -366.5, -70.2], target: [17.2, 240.7, -30.2], vfov: 35.76, sun: { elevation: 45, azimuth: 240 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.09, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyRamp: [{ at: -0.1, color: [12.36, 11.52, 14.09] }, { at: 0.02, color: [12.36, 11.52, 14.09] }, { at: 0.07, color: [12.36, 11.52, 14.09] }, { at: 0.13, color: [12.36, 11.52, 14.09] }, { at: 0.2, color: [6.63, 6.49, 8.13] }, { at: 0.3, color: [3.35, 3.60, 4.71] }, { at: 0.45, color: [2.14, 2.54, 3.45] }, { at: 0.8, color: [1.89, 2.32, 3.19] }], sunTint: [1.12, 1, 0.88], settings: { animSpeed: 0, ambientStrength: 1.0 } },
  s33t9: { cloud: 'stormbird', source: 's181 media33 t=9 s', eye: [62.7, -180.5, 626.0], target: [51.4, 240.7, 12.7], vfov: 52.15, sun: { elevation: 45, azimuth: 330 }, turbidity: 20, miePhaseG: 0.5, exposure: 0.09, mirrorBelowHorizon: true, sunColor: [1, 0.92, 0.88], skyRamp: [{ at: -0.1, color: [12.36, 11.52, 14.09] }, { at: 0.02, color: [12.36, 11.52, 14.09] }, { at: 0.07, color: [12.36, 11.52, 14.09] }, { at: 0.13, color: [12.36, 11.52, 14.09] }, { at: 0.2, color: [6.63, 6.49, 8.13] }, { at: 0.3, color: [3.35, 3.60, 4.71] }, { at: 0.45, color: [2.14, 2.54, 3.45] }, { at: 0.8, color: [1.89, 2.32, 3.19] }], sunTint: [1.12, 1, 0.88], settings: { animSpeed: 0, ambientStrength: 1.0 } },
  s214: { cloud: 'stormbird', source: 's191 image214', eye: [627.9, -180.5, 60.8], target: [-3.4, 210.4, 13.2], vfov: 43.45, sun: { elevation: 40, azimuth: 220 }, turbidity: 6, exposure: 0.18, mirrorBelowHorizon: true, sunColor: [1, 0.95, 0.93], skyRamp: [{ at: -0.1, color: [1.80, 2.78, 4.00] }, { at: 0.02, color: [1.80, 2.78, 4.00] }, { at: 0.07, color: [1.80, 2.78, 4.00] }, { at: 0.13, color: [1.80, 2.78, 4.00] }, { at: 0.2, color: [1.69, 2.63, 3.80] }, { at: 0.3, color: [1.21, 2.01, 2.96] }, { at: 0.45, color: [0.83, 1.52, 2.30] }, { at: 0.8, color: [0.56, 1.18, 1.84] }], sunTint: [1.12, 1, 0.88], settings: { animSpeed: 0 } },
};

export const DECIMA_REF_NAMES = Object.keys(DECIMA_REFS);
