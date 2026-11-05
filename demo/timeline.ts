export type Frame = {
  t: number; position: number[]; quaternion: number[]; velocity: number[];
  grounded: boolean; energy: number; action: string; completed: number;
  completedIds?: string[]; target: string; throttle: number | null; thrusts: number[] | null;
};
export type Trace = {
  runId: string; seed?: number; frames: Frame[];
  plans: { t: number; targets: string[]; model?: string }[];
  summary: { outcome: string; planner: string; decisionModel: string };
  disclosure: string;
};

/** Find neighboring measurements; replay never advances or controls physics. */
export function frameAt(frames: readonly Frame[], time: number) {
  let lo = 0, hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= time) lo = mid; else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  return { a, b, fraction: Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t || 1))) };
}

export function readTrace(value: unknown): Trace {
  const trace = value as Trace;
  if (!trace || typeof trace.runId !== 'string' || !Array.isArray(trace.frames) || trace.frames.length < 2 || !Array.isArray(trace.plans) || !trace.summary) {
    throw new Error('Choose an exported VECTOR replay trace, not a raw run log or summary.');
  }
  let lastTime = -Infinity;
  for (const frame of trace.frames) {
    if (!Number.isFinite(frame.t) || frame.t < lastTime ||
        ![frame.position, frame.velocity, frame.quaternion].every((v, i) => Array.isArray(v) && v.length === (i === 2 ? 4 : 3) && v.every(Number.isFinite))) {
      throw new Error('Replay measurements are malformed or out of order.');
    }
    lastTime = frame.t;
  }
  return trace;
}
