import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt, readTrace, type Frame } from '../demo/timeline';

const sample = (t: number, x: number): Frame => ({ t, position: [x, 1, 0], velocity: [1, 0, 0], quaternion: [0, 0, 0, 1],
  grounded: true, energy: 100, action: 'drive', completed: 0, target: 'relay-1', throttle: 0, thrusts: [0, 0, 0, 0] });

test('replay interpolates irregular observations and handles repeated frozen-setup timestamps', () => {
  const frames = [sample(0, 0), sample(0, 0), sample(.1, 1), sample(.35, 3.5)];
  for (const [time, expected] of [[-.5, 0], [0, 0], [.05, .5], [.225, 2.25], [.35, 3.5], [1, 3.5]]) {
    const { a, b, fraction } = frameAt(frames, time);
    assert.ok(Math.abs(a.position[0] + (b.position[0] - a.position[0]) * fraction - expected) < 1e-9);
  }
});

test('replay rejects a summary, malformed pose or backward timestamps before playback', () => {
  const trace = { runId: 'recorded', frames: [sample(0, 0), sample(.1, 1)], plans: [],
    summary: { outcome: 'success', planner: 'recorded-planner', decisionModel: 'recorded-controller' }, disclosure: 'recorded' };
  assert.equal(readTrace(trace), trace);
  assert.throws(() => readTrace(trace.summary), /exported VECTOR/);
  assert.throws(() => readTrace({ ...trace, frames: [sample(1, 0), sample(0, 0)] }), /out of order/);
  assert.throws(() => readTrace({ ...trace, frames: [sample(0, 0), { ...sample(.1, 1), quaternion: [0, 0] }] }), /malformed/);
});
