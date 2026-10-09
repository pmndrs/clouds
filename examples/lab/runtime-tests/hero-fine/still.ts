// P13-H1 A/B: the flagship scene (same cloud placement, bookmarks, tier and sky) rendered deterministically for `?frames=` frames
// (default 64), then frozen, so a capture of this page is comparable byte for byte between two source trees (with and without H1).
//   ?bookmark=ground|edge|inside|...  ?cloud=parkouring  ?quality=high
import { loadCloudNoise, loadCloudVolume, type CloudQuality } from '@clouds/runtime';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector } from '../../flagship/bookmarks';
import { createStage } from './stage';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
try {
  const bookmark = query.get('bookmark') ?? 'ground';
  if (!isBookmarkName(bookmark)) throw new Error(`unknown bookmark ${bookmark}`);
  const stage = await createStage({ quality: (query.get('quality') ?? 'high') as CloudQuality, timeOfDay: bookmarkTime(bookmark), deterministic: true });
  const [volume, noise] = await Promise.all([loadCloudVolume(`/clouds/${query.get('cloud') ?? 'parkouring'}/`), loadCloudNoise('/clouds/noise/')]);
  await stage.runtime.setVolume(volume, { position: placeCloud(volume) });
  await stage.runtime.setNoise(noise);
  const b = resolveBookmark(bookmark, sunVector(stage.sky.sunAzimuth, stage.sky.sunElevation));
  stage.rig.set(b.position, b.target);
  stage.stopAfter = Number(query.get('frames') ?? 64);
  stage.start(() => harness.frame());
  harness.ready({ report: () => ({ gpuMs: stage.gpuMedian(), frameMs: stage.frameMs(), renderSize: [innerWidth, innerHeight], bookmark, framesRendered: stage.frame }) });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
