import { expect, it } from 'vitest';
import { createLabScheduler } from './scheduler';
it('runs production before presentation and detaches all jobs', () => {
  const events: string[] = [];
  const scheduler = createLabScheduler(() => events.push('produce'), () => events.push('present'));
  scheduler.step(0); scheduler.step(16);
  expect(events).toEqual(['produce','present','produce','present']);
  scheduler.dispose(); scheduler.step(32);
  expect(events).toHaveLength(4);
});
