// @ts-check
/**
 * Where a renderer CPU profile's time went, inside one window of it: the functions by their own (self) time, and the
 * call paths by the time spent under them.
 *
 *   node scripts/research/cpuProfileTop.mjs <profile.cpuprofile> [--from <ms>] [--to <ms>] [--top <n>]
 *
 * `--from` and `--to` are on the profile's own clock in milliseconds from its start, as `editOpenCost.mjs --profile`
 * prints them for the press it profiled, so the reading is of that window and not of the whole recording.
 *
 * A profile is SAMPLED: a function's time is the count of samples whose top frame it was, times the gap to the next
 * sample. A window holding few samples gives a coarse answer, so the sample count and the interval are printed with it.
 *
 * Its control: the window must hold at least one sample, and the samples must sum to within 10% of the window's length
 * minus idle; otherwise it says the profile does not cover the window and prints nothing as an answer.
 */
import { readFileSync } from 'node:fs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const path = process.argv[2];
if (path === undefined || path.startsWith('--')) throw new Error('usage: node scripts/research/cpuProfileTop.mjs <profile.cpuprofile> [--from <ms>] [--to <ms>] [--top <n>]');

/**
 * @typedef {{ functionName: string, url: string, lineNumber: number, columnNumber: number }} CallFrame
 * @typedef {{ id: number, callFrame: CallFrame, children?: number[] }} ProfileNode
 * @type {{ nodes: ProfileNode[], startTime: number, endTime: number, samples: number[], timeDeltas: number[] }}
 */
const profile = JSON.parse(readFileSync(path, 'utf8'));
const from = Number(option('--from') ?? '0');
const to = Number(option('--to') ?? String((profile.endTime - profile.startTime) / 1000));
const top = Number(option('--top') ?? '25');

const byId = new Map(profile.nodes.map((node) => [node.id, node]));
/** @type {Map<number, number>} */
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);

/** @param {CallFrame} frame */
const label = (frame) => {
  const file = frame.url === '' ? '' : frame.url.slice(frame.url.lastIndexOf('/') + 1);
  return `${frame.functionName === '' ? '(anonymous)' : frame.functionName} ${file}:${String(frame.lineNumber + 1)}`;
};

// Each sample's time on the profile's clock, and its length as the gap to the next one.
/** @type {Map<string, number>} */
const self = new Map();
/** @type {Map<string, number>} */
const under = new Map();
let at = 0;
let counted = 0;
let idle = 0;
let inside = 0;
for (let index = 0; index < profile.samples.length; index += 1) {
  at += (profile.timeDeltas[index] ?? 0) / 1000;
  const length = (profile.timeDeltas[index + 1] ?? 0) / 1000;
  if (at < from || at >= to) continue;
  inside += 1;
  const node = byId.get(profile.samples[index] ?? -1);
  if (node === undefined) continue;
  const name = node.callFrame.functionName;
  if (name === '(idle)' || name === '(program)') {
    idle += length;
    continue;
  }
  counted += length;
  self.set(label(node.callFrame), (self.get(label(node.callFrame)) ?? 0) + length);
  // Every distinct frame on the stack once, so a recursive function is not counted twice under itself.
  const seen = new Set();
  for (let id = /** @type {number | undefined} */ (node.id); id !== undefined; id = parentOf.get(id)) {
    const frame = byId.get(id)?.callFrame;
    if (frame === undefined || frame.functionName === '(root)') continue;
    const key = label(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    under.set(key, (under.get(key) ?? 0) + length);
  }
}

if (inside === 0) throw new Error(`the profile holds no sample between ${String(from)} and ${String(to)} ms, so it does not cover the window`);
const span = to - from;
if (counted + idle < span * 0.9) {
  throw new Error(`the samples in the window sum to ${counted.toFixed(0)} ms busy and ${idle.toFixed(0)} ms idle of a ${span.toFixed(0)} ms window, so the profile does not cover it`);
}

/** @param {Map<string, number>} table */
const ranked = (table) =>
  [...table.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([key, ms]) => `  ${ms.toFixed(1).padStart(8)} ms  ${key}`);
process.stdout.write(
  [
    `window ${from.toFixed(0)} to ${to.toFixed(0)} ms: ${String(inside)} samples, ${counted.toFixed(0)} ms busy, ${idle.toFixed(0)} ms idle`,
    `by own time:`,
    ...ranked(self),
    `by time under (the function and what it called):`,
    ...ranked(under),
    '',
  ].join('\n'),
);
