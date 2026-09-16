import { Scheduler } from '@pmndrs/scheduler';
/** Optional host adapter; the cloud runtime itself never starts a hidden loop. */
export function createLabScheduler(update: () => void, render: () => void) {
  const scheduler = new Scheduler();
  const rootId = 'clouds-lab';
  const detach = scheduler.registerRoot(rootId, { frameloop: 'never' });
  const offRender = scheduler.register(render, { rootId, id: 'present', phase: 'render' });
  const offUpdate = scheduler.register(update, { rootId, id: 'produce', phase: 'update' });
  return {
    step(timestamp: number) { scheduler.step(timestamp); },
    dispose() { offUpdate(); offRender(); detach(); scheduler.stop(); },
  };
}
