// @ts-check
/**
 * What the renderer's longest task in a Chromium timeline trace spent its time on: each event inside it by its own
 * (self) time, summed by name, so layout, style, paint and script stand side by side.
 *
 *   node scripts/research/traceTop.mjs <round-n.trace.json> --expect <ms> [--top <n>]
 *
 * Written for `editOpenCost.mjs --trace`, whose trace covers the first press on a block, the long task that holds the
 * 300 ms first-press goal. A sampled CPU profile of the same press accounted for about 250 of its 420 ms
 * (`cpuProfileTop.mjs` refused it, 2026-11-14): it samples script, and layout and style run outside script.
 *
 * ## Its controls
 *
 * - It must find a thread named `CrRendererMain` and a top-level task on it, or it says the trace does not hold the
 *   renderer and prints nothing as an answer (a search: "found nothing" must not read as "nothing was slow").
 * - `--expect` is the worst long task `editOpenCost.mjs` printed for the same round, on the page's own clock. The task
 *   found here must be within 10% of it, or this is reading some other task and says so.
 *
 * Only complete (`X`) events are nested. A begin/end pair inside the task is not split out; its time stays in the event
 * that holds it, so the ranking can only be coarser than the truth, never invent a cost.
 */
import { readFileSync } from 'node:fs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const path = process.argv[2];
const expect = Number(option('--expect'));
const top = Number(option('--top') ?? '25');
if (path === undefined || path.startsWith('--') || !Number.isFinite(expect) || expect <= 0) {
  throw new Error('usage: node scripts/research/traceTop.mjs <trace.json> --expect <worst long task in ms> [--top <n>]');
}

/** @typedef {{ name: string, cat?: string, ph: string, ts: number, dur?: number, pid: number, tid: number, args?: any }} TraceEvent */
const parsed = JSON.parse(readFileSync(path, 'utf8'));
/** @type {TraceEvent[]} */
const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;

const mains = new Set(
  events
    .filter((event) => event.ph === 'M' && event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
    .map((event) => `${String(event.pid)}:${String(event.tid)}`),
);
if (mains.size === 0) throw new Error('the trace names no CrRendererMain thread, so it does not hold the renderer');

const onMain = events.filter((event) => event.ph === 'X' && typeof event.dur === 'number' && mains.has(`${String(event.pid)}:${String(event.tid)}`));
const tasks = onMain.filter((event) => event.name === 'RunTask' || event.name === 'ThreadControllerImpl::RunTask');
if (tasks.length === 0) throw new Error('the renderer threads hold no top-level task, so there is nothing to split');
const task = tasks.reduce((longest, each) => ((each.dur ?? 0) > (longest.dur ?? 0) ? each : longest));
const taskMs = (task.dur ?? 0) / 1000;
if (Math.abs(taskMs - expect) > expect * 0.1) {
  throw new Error(`the longest renderer task here is ${taskMs.toFixed(0)} ms, not the ${String(expect)} ms long task expected, so this would split some other task`);
}

/** How an event is named in the ranking: a script call by its function and file, anything else by its own name. */
const label = (/** @type {TraceEvent} */ event) => {
  const data = event.args?.data;
  if (event.name === 'FunctionCall' && data !== undefined) {
    const file = typeof data.url === 'string' ? data.url.slice(data.url.lastIndexOf('/') + 1) : '';
    return `FunctionCall ${String(data.functionName ?? '') || '(anonymous)'} ${file}:${String(data.lineNumber ?? '')}`;
  }
  return event.name;
};

// THE TASK'S EVENTS, nested by time on its own thread: a stack of open events, each closed when the next begins past it.
const end = task.ts + (task.dur ?? 0);
const inside = onMain
  .filter((event) => event.pid === task.pid && event.tid === task.tid && event.ts >= task.ts && event.ts + (event.dur ?? 0) <= end)
  .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
/** @type {Map<string, number>} */
const self = new Map();
/** @type {{ event: TraceEvent, children: number }[]} */
const stack = [];
const close = (/** @type {{ event: TraceEvent, children: number }} */ open) => {
  const own = ((open.event.dur ?? 0) - open.children) / 1000;
  self.set(label(open.event), (self.get(label(open.event)) ?? 0) + own);
};
for (const event of inside) {
  while (stack.length > 0 && event.ts >= (stack.at(-1)?.event.ts ?? 0) + (stack.at(-1)?.event.dur ?? 0)) {
    const done = stack.pop();
    if (done !== undefined) close(done);
  }
  const parent = stack.at(-1);
  if (parent !== undefined) parent.children += event.dur ?? 0;
  stack.push({ event, children: 0 });
}
while (stack.length > 0) {
  const done = stack.pop();
  if (done !== undefined) close(done);
}

const ranked = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
process.stdout.write(
  [
    `the longest renderer task: ${taskMs.toFixed(1)} ms (expected ${String(expect)} ms), ${String(inside.length)} events inside it`,
    ...ranked.map(([name, ms]) => `  ${ms.toFixed(1).padStart(8)} ms  ${name}`),
  ].join('\n') + '\n',
);
