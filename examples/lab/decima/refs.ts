// D0: camera, sun and framing of every Decima frame of the pack clouds we reconstruct (work/reports/D0.md). The deck images
// themselves are third party and stay local (artifacts/research/extracted/n3/pptx/media, artifacts/research/d0-parity/ref).
// Positions are metres relative to the cloud's placement: the volume is centred on x = z = 0 with its base at y = 0 here (the page
// adds the base height). Cameras come from scripts/d0/d0.py fit (silhouette search over a splatted up-rez proxy), suns from the
// lighting sweep in the report. vfov is vertical, degrees, for a 16:9 frame.
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
  /** Optional exposure for this frame (the page's default otherwise). */
  exposure?: number;
}

export const DECIMA_REFS: Record<string, DecimaRef> = {
  // s78 image101 (up-rezzed; image102 is the same camera with the cheap profile), also s59/s77 image92 on black, s80 NVDF channel views.
  p101: { cloud: 'parkouring', source: 's78 image101', eye: [-297.7, 0, -628.5], target: [-95.6, 201.6, -6.8], vfov: 38.97, sun: { elevation: 30, azimuth: 245 } },
  // s101 image125-127 (wispy only / billowy only / blended) and s107 image133-136 (build steps): the same camera as s78, a little wider.
  p125: { cloud: 'parkouring', source: 's101 image125', eye: [-297.7, 0, -628.5], target: [-89.3, 197.5, -7.6], vfov: 40.69, sun: { elevation: 30, azimuth: 245 } },
  // s129 image161 (ambient without directionality) / image162 (with, N3 s128): Parkouring from the west-south-west, looking up.
  p161: { cloud: 'parkouring', source: 's129 image161/162', eye: [-1028.5, -244.6, -207.3], target: [-138.5, 209.0, 26.7], vfov: 34.55, sun: { elevation: 30, azimuth: 245 } },
  // s191 image213: the pack's own render of Parkouring (close to the s78 view).
  p213: { cloud: 'parkouring', source: 's191 image213', eye: [-261.5, 29.2, -644.2], target: [-72.4, 210.4, -12.3], vfov: 42.87, sun: { elevation: 20, azimuth: 75 } },
  // Stormbird: s181 image206 (the final model's still, also the media33 turntable), s191 image214 (the pack's render, from the other side).
  s206: { cloud: 'stormbird', source: 's181 image206', eye: [-655.3, -180.5, 23.4], target: [-23.6, 212.3, 37.9], vfov: 50.54, sun: { elevation: 30, azimuth: 270 } },
  s214: { cloud: 'stormbird', source: 's191 image214', eye: [627.9, -180.5, 60.8], target: [-3.4, 210.4, 13.2], vfov: 43.45, sun: { elevation: 30, azimuth: 90 } },
};

export const DECIMA_REF_NAMES = Object.keys(DECIMA_REFS);
