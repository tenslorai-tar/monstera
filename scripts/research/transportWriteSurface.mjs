// @ts-check
/**
 * Does the SHIPPED write path carry frames, hold its bound, and tear down?
 *
 * ## Why this exists beside `transportWrite.mjs`
 *
 * They ask different questions and neither answers the other's.
 * `transportWrite.mjs` asks what **Win32** does — whether an overlapped write
 * returns before the peer reads, whether completions preserve issue order,
 * whether a cancelled write becomes collectable. Those are facts about the
 * platform, measured with the calls written out in that file.
 *
 * This asks whether **our code** uses them correctly. It drives
 * `createWin32WriteSurface` and `createHostWriteQueue` from the built output —
 * the shipped modules, not a copy of them — for the reason `lowboxSpike.mjs`
 * drives the shipped pipe factory: a measurement of a copy is a measurement of
 * the copy.
 *
 * It is also the half that makes the adapter more than typed. A native module
 * nothing runs is the *configured is not run* shape this project has paid for,
 * and the compiler cannot see a `WriteFile` whose arguments are in the wrong
 * order.
 *
 * ## What separates the cases
 *
 * The reassuring answer here is *every write was accepted*, and a queue that
 * dropped frames on the floor produces it too. So the peer reads the bytes back
 * and the stream is compared against the exact concatenation issued, frames
 * naming their own index — a byte count cannot see a reorder, which is the
 * defect that would sink the design.
 *
 * The bound has its own trap and it is the sharper one: a limit that counted
 * TOTAL writes passes every assertion about an overrun into a silent peer,
 * because nothing completes there. The control writes past the limit into a
 * peer that IS draining.
 *
 * Usage: node scripts/research/transportWriteSurface.mjs [--require-transport]
 */

import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();

/** Frames written into a peer that never reads. */
const FRAMES = 32;
/** Each frame's size. */
const FRAME_BYTES = 4096;
/** The queue's limit for the phases that are not about the bound. */
const ROOMY = FRAMES * 4;
/** The queue's limit for the phase that is. */
const BOUND = 8;
/** Frames the draining peer takes, past the bound, in the control. */
const PAST_BOUND = 16;
/** How long a single accepted write may take before main is considered blocked. */
const NON_BLOCKING_MS = 250;
/** How long the whole teardown may take. Measured at 0ms for 63 writes. */
const TEARDOWN_BUDGET_MS = 500;
/** How long a draining peer has to receive everything. */
const DRAIN_BUDGET_MS = 10000;

/** Passed by the jobs that provision. See `scripts/lib/unverifiable.mjs`. */
const REQUIRE = process.argv.includes('--require-transport');
/** @param {string} why @returns {never} */
const unverifiable = (why) =>
  exitUnverifiable({
    required: REQUIRE,
    subject: "the shipped write path",
    why,
    flag: '--require-transport',
  });

if (process.platform !== 'win32') {
  unverifiable(`this drives Win32 overlapped writes, which do not exist on ${process.platform}.`);
}

const BUILT = {
  pipeSurface: join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js'),
  pipeFactory: join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js'),
  writeQueue: join(ROOT, 'apps', 'desktop', 'dist', 'hostWriteQueue.js'),
};
for (const built of Object.values(BUILT)) {
  if (!existsSync(built)) {
    unverifiable(
      `${built} is not built. This drives the SHIPPED modules rather than a copy, so without ` +
        'the build there is nothing to measure. Run `npm run build`.',
    );
  }
}

const { createWin32PipeSurface, createWin32WriteSurface, currentUserSid, hostContainerSid } =
  await import(pathToFileURL(BUILT.pipeSurface).href);
const { createHostPipe } = await import(pathToFileURL(BUILT.pipeFactory).href);
const { createHostWriteQueue } = await import(pathToFileURL(BUILT.writeQueue).href);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 14 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {number} ms @returns {Promise<void>} */
const rest = (ms) => new Promise((done) => setTimeout(done, ms).unref?.() ?? undefined);

const CONTAINER = 'monstera-write-surface-probe';
const pipes = createWin32PipeSurface();
const user = currentUserSid();
const container = hostContainerSid(CONTAINER);
if (!user.ok || !container.ok) {
  process.stderr.write(
    `the SIDs could not be resolved, so no pipe can be built: ` +
      `${user.ok ? '' : user.error}${container.ok ? '' : container.error}\n`,
  );
  process.exit(1);
}

/**
 * Frame `index` filled with `index % 256`, carrying `index` as a little-endian
 * uint32 at offset 0.
 *
 * Naming the index is what lets a reorder be seen: frames of identical bytes
 * sum to the same total in any order, so a byte count reports the reassuring
 * answer for the one failure that matters. The uint32 as well as the fill,
 * because above 256 frames two would share a fill value.
 *
 * @param {number} index @returns {Buffer}
 */
function frameOf(index) {
  const frame = Buffer.alloc(FRAME_BYTES, index % 256);
  frame.writeUInt32LE(index, 0);
  return frame;
}

/**
 * A pipe of our own with a client attached that is not reading.
 *
 * One per phase, because a drained pipe and a full one are different states and
 * a phase that inherited the previous one's would be measuring that instead.
 *
 * @param {string} suffix
 */
async function attachedPipe(suffix) {
  const name = '\\\\.\\pipe\\' + `${CONTAINER}-${String(process.pid)}-${suffix}`;
  const built = createHostPipe(pipes, name, user.value, container.value, 1);
  if (!built.ok) {
    process.stderr.write(
      `the shipped factory refused '${suffix}' at stage '${built.error.stage}': ` +
        `${built.error.detail}\n`,
    );
    process.exit(1);
  }
  const client = connect(name);
  client.pause();
  client.on('error', (error) =>
    process.stderr.write(`  the '${suffix}' client could not connect: ${error.message}\n`),
  );
  await new Promise((ready) => client.once('connect', () => ready(undefined)));
  return { built, client, pipe: built.value.instances[0] };
}

/** @param {{ built: { value: { instances: unknown[] } }, client: import('node:net').Socket }} phase */
function closePhase(phase) {
  phase.client.destroy();
  for (const instance of phase.built.value.instances) pipes.close(instance);
}

// ---------------------------------------------------------------------------
// PHASE 1 — frames go out through the shipped queue, and arrive in order.
// ---------------------------------------------------------------------------
const carrying = await attachedPipe('carry');
const carrySurface = createWin32WriteSurface(carrying.pipe);
const carryQueue = createHostWriteQueue(carrySurface, ROOMY);

const frames = Array.from({ length: FRAMES }, (_, index) => frameOf(index));
const expected = Buffer.concat(frames);

/** @type {number[]} */
const durations = [];
/** @type {string[]} */
const refusals = [];
for (const frame of frames) {
  const started = Date.now();
  const outcome = carryQueue.write(frame);
  durations.push(Date.now() - started);
  if (!outcome.ok) refusals.push(`${outcome.refusal.reason}: ${outcome.refusal.detail}`);
}
const slowest = durations.length === 0 ? -1 : Math.max(...durations);

check(
  'the shipped queue accepts every frame into a peer that is not reading',
  refusals.length === 0,
  `${String(refusals.length)} refusal(s), first: ${refusals[0] ?? '(none)'}. A peer that is not ` +
    `reading is the ordinary case this design exists for — main writes when it has something to ` +
    `say, not when the host is ready.`,
);

check(
  `and no single write took longer than ${String(NON_BLOCKING_MS)}ms, reaping included`,
  slowest >= 0 && slowest < NON_BLOCKING_MS,
  `slowest ${String(slowest)}ms across ${String(durations.length)} writes. This is a longer ` +
    `measurement than transportWrite.mjs's: every write here also collects the completions of ` +
    `the writes before it, which is what main actually pays.`,
);

check(
  'CONTROL: the writes really were outstanding rather than absorbed',
  carryQueue.outstanding() > FRAMES / 2,
  `${String(carryQueue.outstanding())} of ${String(FRAMES)} outstanding. If they had all ` +
    `completed inline the kernel absorbed everything, and "nothing blocked" would be true for a ` +
    `reason that says nothing about a full pipe — the case that makes the timing above evidence.`,
);

// THE SOURCE BUFFERS ARE OVERWRITTEN BEFORE THE PEER READS ANY OF IT — AND THIS
// DOES NOT SEPARATE A COPY FROM A VIEW. Measured, and written down as a
// non-result rather than left reading like a proof of the adapter's copy.
//
// The intent was the classic overlapped-I/O defect: the kernel reads from the
// buffer after `WriteFile` returns, so an adapter passing the caller's array
// through would send whatever that memory says at completion. With the
// adapter's `Buffer.from(frame)` replaced by a view over the same memory, every
// case here still passed — the named-pipe file system takes the bytes at request
// time, so what the caller's memory says later never reaches the wire.
//
// It is kept because it costs nothing and would catch a driver that read late,
// and because a fixture whose name claims more than it separates is the shape
// this checklist exists to find. `expected` was concatenated above, which
// copies, so it still holds what was issued.
for (const frame of frames) frame.fill(0xff);

/** @type {Buffer[]} */
const received = [];
carrying.client.on('data', (chunk) => received.push(chunk));
carrying.client.resume();

const drainStarted = Date.now();
while (
  received.reduce((sum, chunk) => sum + chunk.length, 0) < expected.length &&
  Date.now() - drainStarted < DRAIN_BUDGET_MS
) {
  await rest(20);
}

const stream = Buffer.concat(received);
const firstDifference = (() => {
  const shared = Math.min(stream.length, expected.length);
  for (let at = 0; at < shared; at += 1) {
    if (stream[at] !== expected[at]) return at;
  }
  return stream.length === expected.length ? -1 : shared;
})();

check(
  'THE WHOLE PATH: the peer receives exactly what was issued, in issue order',
  firstDifference === -1,
  stream.length !== expected.length
    ? `received ${String(stream.length)} of ${String(expected.length)} bytes. "Every write was ` +
      `accepted" is also what a queue that dropped frames reports.`
    : `first difference at byte ${String(firstDifference)}, inside frame ` +
      `${String(Math.floor(firstDifference / FRAME_BYTES))}. A byte count cannot see this, and a ` +
      `reorder desynchronises the length-prefixed framing from our own side.`,
);

carryQueue.close();
check(
  'closing a drained queue strands nothing',
  carrySurface.stranded() === 0,
  `${String(carrySurface.stranded())} write(s) stranded. A stranded write is an OVERLAPPED and a ` +
    `buffer this process holds while the kernel may still own them — bounded, but not nothing.`,
);
closePhase(carrying);

// ---------------------------------------------------------------------------
// PHASE 2 — the bound, and the control that says what it counts.
// ---------------------------------------------------------------------------
const bounded = await attachedPipe('bound');
const boundQueue = createHostWriteQueue(createWin32WriteSurface(bounded.pipe), BOUND);

/** @type {string[]} */
const boundReasons = [];
for (let index = 0; index < BOUND + 4; index += 1) {
  const outcome = boundQueue.write(frameOf(index));
  if (!outcome.ok) boundReasons.push(outcome.refusal.reason);
}

check(
  `the bound refuses the frame past ${String(BOUND)} outstanding, and closes rather than dropping it`,
  boundReasons.length >= 2 &&
    boundReasons[0] === 'overrun' &&
    boundReasons.slice(1).every((reason) => reason === 'closed'),
  `reasons ${JSON.stringify(boundReasons)}. The first past the limit must be 'overrun' and every ` +
    `one after it 'closed': an unbounded queue is the peer deciding how much memory main holds, ` +
    `and a queue that resumed after an overrun would let it decide again. The COUNT is not ` +
    `asserted, and that is not laziness — the kernel takes the first frame or two into the pipe's ` +
    `own buffer, the reap at the next write frees those slots, and how many depends on a buffer ` +
    `size nothing here owns. Measured: 3 refusals where the arithmetic says 4.`,
);
closePhase(bounded);

const draining = await attachedPipe('draining');
const drainQueue = createHostWriteQueue(createWin32WriteSurface(draining.pipe), BOUND);
draining.client.on('data', () => undefined);
draining.client.resume();

/** @type {string[]} */
const drainingReasons = [];
for (let index = 0; index < PAST_BOUND; index += 1) {
  const outcome = drainQueue.write(frameOf(index));
  if (!outcome.ok) drainingReasons.push(outcome.refusal.reason);
  await rest(10);
}

check(
  `CONTROL: ${String(PAST_BOUND)} frames pass a limit of ${String(BOUND)} when the peer IS reading`,
  drainingReasons.length === 0,
  `${String(drainingReasons.length)} refusal(s): ${JSON.stringify(drainingReasons)}. A limit that ` +
    `counted TOTAL writes passes the case above, because nothing completes into a silent peer — ` +
    `this is the fixture that defect does not also handle correctly.`,
);
drainQueue.close();
closePhase(draining);

// ---------------------------------------------------------------------------
// PHASE 3 — tearing down with writes the kernel still owns.
// ---------------------------------------------------------------------------
const torn = await attachedPipe('teardown');
const tornSurface = createWin32WriteSurface(torn.pipe);
const tornQueue = createHostWriteQueue(tornSurface, ROOMY);
for (const frame of frames) tornQueue.write(frame);

const outstandingAtClose = tornQueue.outstanding();
check(
  'CONTROL: writes were outstanding at the moment of the teardown',
  outstandingAtClose > FRAMES / 2,
  `${String(outstandingAtClose)} of ${String(FRAMES)}. Abandoning an empty set succeeds, returns ` +
    `instantly and frees nothing — indistinguishable from the mechanism working.`,
);

const teardownStarted = Date.now();
tornQueue.close();
const teardownMs = Date.now() - teardownStarted;

check(
  `the teardown frees every outstanding write within ${String(TEARDOWN_BUDGET_MS)}ms`,
  tornSurface.stranded() === 0 && teardownMs < TEARDOWN_BUDGET_MS,
  `${String(tornSurface.stranded())} stranded after ${String(teardownMs)}ms. The rejected shape ` +
    `here is waiting on the completions: with the cancel removed, a probe doing that ran to an ` +
    `external timeout and exited 124 — the hang the read side was redesigned to avoid, arriving ` +
    `in the process that must stay responsive.`,
);
closePhase(torn);

// ---------------------------------------------------------------------------
// PHASE 4 — A TEARDOWN WHOSE CANCEL FAILS (finding DDDD-8).
//
// `abandon` has two paths and only one had a case. When `CancelIoEx` fails for
// a reason other than `ERROR_NOT_FOUND`, the writes are still the kernel's, so
// nothing is freed and nothing is waited for — because the wait after a cancel
// that did not happen is the one measured never to return. That branch is what
// decides whether main hangs, and it was reached by nothing: the mutation that
// removed the cancel exercised the POLL TIMEOUT instead, which is the other
// path entirely.
//
// The fixture is one the absent guard would let through: close the pipe handle
// first, so `CancelIoEx` is called on a handle that no longer exists and fails
// with `ERROR_INVALID_HANDLE` rather than `ERROR_NOT_FOUND`. That is a real
// shape — a composer that closes the pipe before tearing the queue down — and
// not a hypothetical.
// ---------------------------------------------------------------------------
const orphaned = await attachedPipe('orphaned');
const orphanedSurface = createWin32WriteSurface(orphaned.pipe);
const orphanedQueue = createHostWriteQueue(orphanedSurface, ROOMY);
for (const frame of frames) orphanedQueue.write(frame);

const orphanedOutstanding = orphanedQueue.outstanding();
check(
  'CONTROL: writes were outstanding when the handle went away',
  orphanedOutstanding > FRAMES / 2,
  `${String(orphanedOutstanding)} of ${String(FRAMES)}. Abandoning an empty set takes the same ` +
    `path in the same time, so without something outstanding this phase observes nothing.`,
);

// The handle goes FIRST. Everything after this point is the branch under test.
for (const instance of orphaned.built.value.instances) pipes.close(instance);

const orphanedStarted = Date.now();
orphanedQueue.close();
const orphanedMs = Date.now() - orphanedStarted;

check(
  'a teardown whose cancel FAILS strands rather than waiting, and says how many',
  orphanedSurface.stranded() === orphanedOutstanding && orphanedMs < TEARDOWN_BUDGET_MS / 2,
  `${String(orphanedSurface.stranded())} stranded of ${String(orphanedOutstanding)} outstanding, ` +
    `in ${String(orphanedMs)}ms. THE TIME IS THE HALF THAT SEPARATES, and the count is not: ` +
    `measured by inverting the branch, the polling path strands all of them TOO, having spent ` +
    `the full budget first — because a request whose handle has gone away keeps answering ` +
    `ERROR_IO_INCOMPLETE and the poll can never settle it. A cancel that SUCCEEDED is the case ` +
    `that strands none; this one must strand everything and not wait.`,
);

orphaned.client.destroy();

// ---------------------------------------------------------------------------
// PHASE 5 — A FRAME SMALL ENOUGH TO BE POOLED, which every phase above avoided.
//
// The adapter copies with `Buffer.from(frame)`, and Node pools that copy for
// anything under `Buffer.poolSize / 2` — so the payload usually starts at a
// non-zero offset inside a buffer shared with other allocations. If koffi passed
// the underlying buffer's base rather than the view's start, such a frame would
// write bytes belonging to something else entirely.
//
// `Buffer.poolSize` DIFFERS BY MACHINE — 8192 on the developing machine and
// 65536 on the CI runners, both read 2026-08-25 from this probe's own output —
// so whether the phases above exercised that path was an accident of where they
// ran. At 8192 a 4096-byte frame is not pooled and they did not; at 65536 it is,
// and they did.
//
// This phase removes the accident by using a size that is pool-eligible under
// both, and the control says so rather than assuming it.
//
// A real transport's frames are whatever a message serialises to, which is
// mostly small.
// ---------------------------------------------------------------------------
const POOLED_BYTES = 512;
const POOLED_FRAMES = 8;

// SAMPLED RATHER THAN TAKEN ONCE, and the reason is a red board.
//
// The first version asserted that ONE `Buffer.from` of this size lands at a
// non-zero byteOffset. It does not, reliably: the pool refills, and the first
// allocation out of a fresh 8192-byte pool is at offset 0. Measured after CI
// went red on both Windows jobs — 40 successive 512-byte copies gave
// `byteOffset === 0` twice, at exactly the refills.
//
// So the control depended on where the pool cursor happened to sit when it ran,
// which every earlier allocation in this file moves — including the socket
// chunks, whose boundaries differ between machines. A premise resting on ambient
// state, in the commit whose whole subject was a fixture that excluded the
// defect it was written for.
//
// Two things are asserted instead, and both are deterministic. The SIZES are
// pool-eligible or not by arithmetic against `Buffer.poolSize`, which is a
// property rather than a sample. And at least one of two successive copies has a
// non-zero offset, which holds even from a fresh pool: the first is at 0 and the
// second is at `POOLED_BYTES`.
const samples = [
  Buffer.from(new Uint8Array(POOLED_BYTES)).byteOffset,
  Buffer.from(new Uint8Array(POOLED_BYTES)).byteOffset,
];
// AND IT ASSERTS NOTHING ABOUT `FRAME_BYTES`, which is the second red.
//
// The first version also required a 4096-byte copy to land at offset 0 — true
// here and FALSE on the runners, where `Buffer.poolSize` is **65536** against
// **8192** on this machine. At 65536 the threshold is 32768, so 4096 is pooled
// too and that copy landed at 21504.
//
// That number is the finding rather than the flake. `Buffer.poolSize` is not a
// constant across machines, so *4096 is the size that is not pooled* was this
// machine's accident stated as a property — which means the phases above were
// ALREADY writing offset payloads on the runners and were blind to the class
// only here.
//
// So the control asserts only what this phase needs: that `POOLED_BYTES` is
// pool-eligible wherever it runs, which holds under both readings, and that a
// non-zero offset actually occurs.
check(
  'CONTROL: a frame this size IS pool-eligible, so payloads start at a non-zero offset',
  POOLED_BYTES < Buffer.poolSize / 2 && samples.some((offset) => offset !== 0),
  `poolSize ${String(Buffer.poolSize)}; ${String(POOLED_BYTES)}-byte copies landed at ` +
    `${JSON.stringify(samples)}. If this size stopped being pooled the phase below would test ` +
    `nothing the phases above did not — the threshold is an implementation detail that DIFFERS ` +
    `BY MACHINE, which is what this reports rather than assumes.`,
);

const small = await attachedPipe('pooled');
const smallSurface = createWin32WriteSurface(small.pipe);
const smallQueue = createHostWriteQueue(smallSurface, ROOMY);

const smallFrames = Array.from({ length: POOLED_FRAMES }, (_, index) => {
  const frame = Buffer.alloc(POOLED_BYTES, (index + 1) % 256);
  frame.writeUInt32LE(index, 0);
  return frame;
});
const smallExpected = Buffer.concat(smallFrames);

/** @type {string[]} */
const smallRefusals = [];
for (const frame of smallFrames) {
  const outcome = smallQueue.write(frame);
  if (!outcome.ok) smallRefusals.push(outcome.refusal.reason);
}

/** @type {Buffer[]} */
const smallReceived = [];
small.client.on('data', (chunk) => smallReceived.push(chunk));
small.client.resume();

const smallStarted = Date.now();
while (
  smallReceived.reduce((sum, chunk) => sum + chunk.length, 0) < smallExpected.length &&
  Date.now() - smallStarted < DRAIN_BUDGET_MS
) {
  await rest(20);
}
const smallStream = Buffer.concat(smallReceived);

check(
  'a pooled payload is accepted by the shipped queue',
  smallRefusals.length === 0,
  `${String(smallRefusals.length)} refusal(s): ${JSON.stringify(smallRefusals)}.`,
);

check(
  'AND ITS BYTES ARRIVE UNCHANGED, so the offset inside the pool is respected',
  smallStream.equals(smallExpected),
  `received ${String(smallStream.length)} of ${String(smallExpected.length)} bytes` +
    `${smallStream.length === smallExpected.length ? ', differing in content' : ''}. A payload ` +
    `whose start is ${String(Buffer.from(new Uint8Array(POOLED_BYTES)).byteOffset)} bytes into a ` +
    `shared pool writes whatever sits at the pool's base if the offset is dropped — bytes from ` +
    `another allocation entirely, which is the one corruption a byte COUNT cannot see either.`,
);

smallQueue.close();
closePhase(small);

process.stdout.write(
  `\n  ${String(durations.length)} frame(s) through the shipped queue, slowest ` +
    `${String(slowest)}ms\n` +
    `  ${String(stream.length)} byte(s) delivered, ` +
    `${firstDifference === -1 ? 'in issue order' : `first difference at ${String(firstDifference)}`}\n` +
    `  bound refused at ${String(BOUND)} outstanding; ${String(PAST_BOUND)} passed the same ` +
    `bound while draining\n` +
    `  teardown freed ${String(outstandingAtClose)} outstanding write(s) in ` +
    `${String(teardownMs)}ms, ${String(tornSurface.stranded())} stranded\n\n`,
);

if (failures.length > 0) {
  process.stderr.write(
    `\nShipped write path — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`${roster.format('write-surface case')}`);
