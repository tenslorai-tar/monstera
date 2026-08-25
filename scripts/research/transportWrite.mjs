// @ts-check
/**
 * Can main write to the transport without ever blocking, and reap the
 * completions later?
 *
 * ## Why this is measured, and why it is not a choice being made
 *
 * The reader thread cannot be told anything while it waits — measured by
 * `transportTeardown.mjs`: a message sent to a thread inside
 * `WaitForMultipleObjects` is not delivered until the wait returns. So writes
 * cannot travel to it by `postMessage`, and three mechanisms remain:
 *
 *   a third handle the reader also waits on, with the frame in shared memory;
 *   a second thread for writes;
 *   main issuing overlapped writes itself, reaping when it next has business.
 *
 * The third is by far the smallest — no shared buffer, no second thread, and
 * nothing to tear down, which is the property that decided the read side. It is
 * also the one that rests on an unmeasured claim: **that main never blocks.**
 * This measures that claim. It does not pick a design; it removes the option
 * from the list or leaves it on it.
 *
 * ## The claim, stated so it can fail
 *
 * An overlapped `WriteFile` returns immediately whether or not the peer is
 * reading, and its completion can be collected later without waiting. If either
 * half is false — a call that blocks when the pipe's buffer fills, or a
 * completion that can only be had by waiting — then main issuing writes puts a
 * stall in the process that must stay responsive, which is the reason
 * overlapped-polled-from-main was rejected for reads.
 *
 * ## What separates the cases
 *
 * The reassuring answer is *nothing blocked*, and a write that never reached the
 * pipe produces it too. So the client reads the bytes back and the stream is
 * compared against the exact concatenation main issued — a control on the whole
 * path, not just on the timings.
 *
 * ## And ordering, which is a second property and the one the design rests on
 *
 * The pipe is created in BYTE mode (`CreateNamedPipeW`'s pipe mode is 0), and
 * ADR-0023 §4 puts length-prefixed framing on top of that stream. With N
 * overlapped writes outstanding on one handle, whether completions preserve
 * issue order decides whether that framing holds: a reorder desynchronises the
 * length field from our OWN side, which is the hazard that ADR reasoned about
 * arriving from the peer.
 *
 * A byte-count comparison cannot see it. 64 frames of 4096 identical bytes sum
 * to 262144 in any order, so the defect that would sink the design produces the
 * reassuring answer — CLAUDE.md item 4's *never build a fixture the bug also
 * handles correctly*, sitting inside the control added to be the whole-path
 * control. Each frame therefore names its own index, and the received stream is
 * compared byte for byte.
 *
 * ## What ordering here is measured over, and what is reasoned about
 *
 * MEASURED: up to 63 writes outstanding at once on one handle, issued into a
 * peer that is not reading, drained afterwards. That is the state the third
 * design puts main in.
 *
 * NOT MEASURED, and the reasoning is recorded rather than the case built: a
 * batch issued while the peer is actively draining, so that inline completions
 * and pending ones interleave. A write completes inline only when the pipe has
 * room, and room exists only once the bytes ahead of it have been consumed — so
 * an inline completion cannot be issued while an earlier write of this handle's
 * is still holding bytes in the buffer, and the interleaving the case would
 * construct does not arise. Building it would mean starving a reader at a rate
 * tuned to make some writes pend and others not, which is a case that passes or
 * fails on the runner's speed. This paragraph is an ARGUMENT; the cases below
 * are the measurement, and the two are not to be read as one.
 *
 * The blocking case is built from a client that CONNECTS AND NEVER READS, and
 * the volume is many times the pipe's buffer. A write that would block has to
 * have somewhere to block: with a draining reader there is no backpressure to
 * measure and the timings would be reassuring for the wrong reason.
 *
 * Usage: node scripts/research/transportWrite.mjs
 */

import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import koffi from 'koffi';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();

/**
 * The most a single `WriteFile` may take before main is considered blocked.
 *
 * Not a performance budget. An overlapped call that returns `ERROR_IO_PENDING`
 * costs microseconds; one that waited for a reader would cost as long as the
 * reader took, which here is forever. Any threshold between those separates
 * them, and this one is generous enough that a scheduling hiccup on a loaded
 * runner is not read as a stall.
 */
const NON_BLOCKING_MS = 250;
/** Frames written into a peer that never reads. */
const FRAMES = 64;
/** Each frame's size. 64 × 4096 is sixteen times the pipe's own buffer. */
const FRAME_BYTES = 4096;
/** How long the draining client has to receive everything main wrote. */
const DRAIN_BUDGET_MS = 10000;

/** Passed by the jobs that provision. See `scripts/lib/unverifiable.mjs`. */
const REQUIRE = process.argv.includes('--require-transport');
/** @param {string} why @returns {never} */
const unverifiable = (why) =>
  exitUnverifiable({
    required: REQUIRE,
    subject: "the transport's write path",
    why,
    flag: '--require-transport',
  });

if (process.platform !== 'win32') {
  unverifiable(`this measures Win32 overlapped writes, which do not exist on ${process.platform}.`);
}

const BUILT_PIPE_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js');
const BUILT_PIPE_FACTORY = join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js');
for (const built of [BUILT_PIPE_SURFACE, BUILT_PIPE_FACTORY]) {
  if (!existsSync(built)) {
    unverifiable(
      `${built} is not built. This drives the SHIPPED pipe rather than a copy, so without the ` +
        'build there is nothing to measure. Run `npm run build`.',
    );
  }
}

const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
  pathToFileURL(BUILT_PIPE_SURFACE).href
);
const { createHostPipe } = await import(pathToFileURL(BUILT_PIPE_FACTORY).href);

const kernel = koffi.load('kernel32.dll');
const ConnectNamedPipe = kernel.func('bool ConnectNamedPipe(void *pipe, void *overlapped)');
const WriteFile = kernel.func(
  'bool WriteFile(void *file, void *buffer, uint32 toWrite, _Out_ uint32 *written, void *overlapped)',
);
const GetOverlappedResult = kernel.func(
  'bool GetOverlappedResult(void *file, void *overlapped, _Out_ uint32 *transferred, bool wait)',
);
const CreateEventW = kernel.func(
  'void *CreateEventW(void *attrs, bool manualReset, bool initial, const char16_t *name)',
);
const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
const GetLastError = kernel.func('uint32 GetLastError()');
/**
 * Cancels every outstanding I/O on a handle, whichever thread issued it.
 *
 * `CancelIo` — no `Ex` — cancels only the calling thread's, which is the wrong
 * one here: main issues the writes and the teardown may be reached from
 * anywhere. The second parameter is the `OVERLAPPED` to cancel, or NULL for all
 * of them.
 */
const CancelIoEx = kernel.func('bool CancelIoEx(void *file, void *overlapped)');

const ERROR_IO_PENDING = 997;
const ERROR_IO_INCOMPLETE = 996;
const ERROR_OPERATION_ABORTED = 995;
const ERROR_PIPE_CONNECTED = 535;
const POINTER = koffi.sizeof('void *');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 14 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const CONTAINER = 'monstera-transport-write-probe';
const surface = createWin32PipeSurface();
const user = currentUserSid();
const container = hostContainerSid(CONTAINER);
if (!user.ok || !container.ok) {
  process.stderr.write(
    `the SIDs could not be resolved, so no pipe can be built: ` +
      `${user.ok ? '' : user.error}${container.ok ? '' : container.error}\n`,
  );
  process.exit(1);
}

const pipeName = '\\\\.\\pipe\\' + `${CONTAINER}-${String(process.pid)}`;
const built = createHostPipe(surface, pipeName, user.value, container.value, 1);
if (!built.ok) {
  process.stderr.write(
    `the shipped factory refused at stage '${built.error.stage}': ${built.error.detail}\n`,
  );
  process.exit(1);
}
const pipe = built.value.instances[0];

/**
 * One OVERLAPPED with its own event, and the buffer it refers to.
 *
 * BOTH ARE HELD until the completion is reaped. The kernel writes into the
 * OVERLAPPED and reads from the buffer after the call returns, so letting either
 * be collected is the classic overlapped-I/O defect — and in JavaScript it would
 * be collected silently, at a time nothing here controls.
 *
 * @param {Buffer} payload @returns {{ overlapped: Buffer, payload: Buffer, event: unknown }}
 */
function pending(payload) {
  const event = CreateEventW(null, true, false, null);
  // Four pointer-sized fields; `hEvent` is the fourth, at offset 3.
  const overlapped = Buffer.alloc(POINTER * 4);
  koffi.encode(overlapped, POINTER * 3, 'void *', event);
  return { overlapped, payload, event };
}

/** @param {number} ms @returns {Promise<void>} */
const rest = (ms) => new Promise((done) => setTimeout(done, ms).unref?.() ?? undefined);

// ---------------------------------------------------------------------------
// A CLIENT THAT NEVER READS. The whole point: a write that would block needs
// somewhere to block, and a draining peer removes the backpressure this is
// about.
// ---------------------------------------------------------------------------
const silent = connect(pipeName);
silent.pause();
silent.on('error', (error) =>
  process.stderr.write(`  the silent client could not connect: ${error.message}\n`),
);
await new Promise((ready) => silent.once('connect', () => ready(undefined)));

const connected = ConnectNamedPipe(pipe, null);
const whyConnected = GetLastError();
check(
  'SETUP: the server side has a client attached and nothing is draining it',
  Boolean(connected) || whyConnected === ERROR_PIPE_CONNECTED,
  `ConnectNamedPipe said ${String(connected)} with GetLastError ${String(whyConnected)}. Every ` +
    `timing below is about writing into a peer that is not reading; without one attached, a ` +
    `write fails for a different reason entirely and the numbers would mean nothing.`,
);

/**
 * Frame `i` is filled with byte `i % 256` and carries `i` as a little-endian
 * uint32 at offset 0.
 *
 * The uint32 rather than the fill alone: above 256 frames two would share a fill
 * value, and a swap between exactly those two would be invisible again — a
 * fixture that discriminates only while a constant stays small is one that stops
 * discriminating without saying so.
 */
const frames = Array.from({ length: FRAMES }, (_, index) => {
  const frame = Buffer.alloc(FRAME_BYTES, index % 256);
  frame.writeUInt32LE(index, 0);
  return frame;
});
const expectedStream = Buffer.concat(frames);

check(
  'CONTROL: no two frames carry the same bytes, so a swap between any pair is visible',
  new Set(frames.map((frame) => frame.toString('base64'))).size === FRAMES,
  `${String(new Set(frames.map((frame) => frame.toString('base64'))).size)} distinct frames out ` +
    `of ${String(FRAMES)}. Two frames with identical bytes exchange places without changing the ` +
    `stream, so the ordering case below would report agreement for a reorder it cannot see — the ` +
    `same blindness a byte-count comparison has, one layer further in.`,
);

/** @type {Array<ReturnType<typeof pending>>} */
const outstanding = [];
/** @type {number[]} */
const durations = [];
let refusedAt = -1;

for (const [index, frame] of frames.entries()) {
  const slot = pending(frame);
  const written = [0];
  const started = Date.now();
  const ok = WriteFile(pipe, slot.payload, slot.payload.length, written, slot.overlapped);
  durations.push(Date.now() - started);
  const why = GetLastError();
  if (!ok && why !== ERROR_IO_PENDING) {
    refusedAt = index;
    break;
  }
  outstanding.push(slot);
}

const slowest = durations.length === 0 ? -1 : Math.max(...durations);
const total = durations.reduce((sum, each) => sum + each, 0);

check(
  `no single write took longer than ${String(NON_BLOCKING_MS)}ms into a peer that never reads`,
  refusedAt === -1 && slowest >= 0 && slowest < NON_BLOCKING_MS,
  refusedAt !== -1
    ? `write ${String(refusedAt)} was refused with GetLastError ${String(GetLastError())} rather ` +
      `than accepted or pending, so this measured a refusal and not a stall.`
    : `slowest ${String(slowest)}ms across ${String(durations.length)} writes totalling ` +
      `${String(total)}ms. If a write blocks when the pipe's buffer fills, main issuing writes ` +
      `puts a stall in the process that must stay responsive — which is the reason ` +
      `overlapped-polled-from-main was rejected for reads, arriving on the other side.`,
);

check(
  `${String(FRAMES)} × ${String(FRAME_BYTES)} bytes is far more than the pipe's own buffer`,
  FRAMES * FRAME_BYTES > 4096 * 8,
  `wrote ${String(FRAMES * FRAME_BYTES)} bytes against a 4096-byte pipe buffer. A volume that ` +
    `fits would never reach backpressure, and the timings above would be reassuring for a reason ` +
    `that has nothing to do with the mechanism.`,
);

// ---------------------------------------------------------------------------
// REAPING, WITHOUT WAITING. `GetOverlappedResult` with `wait` FALSE is the whole
// question for the third design: main collects completions when it next has
// business rather than on a timer.
// ---------------------------------------------------------------------------
const reapedBeforeDraining = outstanding.filter((slot) => {
  const transferred = [0];
  return Boolean(GetOverlappedResult(pipe, slot.overlapped, transferred, false));
}).length;

check(
  'BACKPRESSURE WAS REACHED: most writes were still outstanding before the peer drained',
  reapedBeforeDraining < FRAMES / 2,
  `${String(reapedBeforeDraining)} of ${String(FRAMES)} had already completed. If they all ` +
    `complete inline then the kernel absorbed everything and nothing was ever queued — and ` +
    `"no write blocked" would be true for a reason that says nothing about a full pipe. This is ` +
    `the case that makes the timing above evidence rather than a coincidence of buffer sizes.`,
);

check(
  'a completion can be collected without waiting, and an incomplete one says so',
  outstanding.every((slot) => {
    const transferred = [0];
    if (GetOverlappedResult(pipe, slot.overlapped, transferred, false)) return true;
    return GetLastError() === ERROR_IO_INCOMPLETE;
  }),
  `at least one outstanding write reported neither completion nor ERROR_IO_INCOMPLETE. Reaping ` +
    `has to be able to say "not yet" without blocking, or main's only way to learn a write ` +
    `finished is to wait for it.`,
);

// Now let the client drain, which is what lets the rest complete.
/** @type {Buffer[]} */
const received = [];
silent.on('data', (chunk) => received.push(chunk));
silent.resume();

const drainStarted = Date.now();
while (
  received.reduce((sum, chunk) => sum + chunk.length, 0) < FRAMES * FRAME_BYTES &&
  Date.now() - drainStarted < DRAIN_BUDGET_MS
) {
  await rest(20);
}

const stream = Buffer.concat(received);
const delivered = stream.length;
check(
  'THE CONTROL: every byte main wrote arrives at the peer',
  delivered === expectedStream.length,
  `the client received ${String(delivered)} of ${String(expectedStream.length)} bytes. Without ` +
    `this, "nothing blocked" is also what a write that never reached the pipe reports — the ` +
    `timings alone cannot tell a fast path from an absent one.`,
);

/**
 * The first offset at which the received stream differs from what main issued,
 * or -1 for identical. A short stream differs at its own end, so a truncation
 * is reported as a position rather than being read as agreement over the part
 * that arrived.
 */
const firstDifference = (() => {
  const shared = Math.min(stream.length, expectedStream.length);
  for (let at = 0; at < shared; at += 1) {
    if (stream[at] !== expectedStream[at]) return at;
  }
  return stream.length === expectedStream.length ? -1 : shared;
})();

check(
  'AND IN THE ORDER MAIN ISSUED THEM: outstanding writes do not reorder the byte stream',
  firstDifference === -1,
  firstDifference >= expectedStream.length || firstDifference >= stream.length
    ? `the streams agree for ${String(firstDifference)} bytes and then one of them ends. A ` +
      `truncation is the byte-count case's finding; this one is here to say the prefix was in ` +
      `order, so the two failures are not confused.`
    : `first difference at byte ${String(firstDifference)}, inside frame ` +
      `${String(Math.floor(firstDifference / FRAME_BYTES))}: expected ` +
      `${String(expectedStream[firstDifference])}, received ${String(stream[firstDifference])}. ` +
      `The frames were issued in index order with ${String(FRAMES)} writes outstanding on one ` +
      `byte-mode handle. If completions do not preserve issue order, the length-prefixed framing ` +
      `ADR-0023 §4 puts on this stream desynchronises from OUR side — and every byte still ` +
      `arrives, so nothing else in this file can see it.`,
);

check(
  'and the completions are all collectable once the peer has drained',
  outstanding.every((slot) => {
    const transferred = [0];
    return (
      Boolean(GetOverlappedResult(pipe, slot.overlapped, transferred, false)) &&
      Number(transferred[0]) === FRAME_BYTES
    );
  }),
  `at least one write did not report ${String(FRAME_BYTES)} bytes transferred after the peer ` +
    `drained. A completion that never arrives is a buffer main can never release.`,
);

process.stdout.write(
  `\n  ${String(durations.length)} write(s) of ${String(FRAME_BYTES)} bytes into a peer that ` +
    `was not reading\n` +
    `  slowest ${String(slowest)}ms, total ${String(total)}ms\n` +
    `  ${String(reapedBeforeDraining)} of ${String(outstanding.length)} had completed before the ` +
    `peer drained\n` +
    `  ${String(delivered)} byte(s) delivered, ` +
    `${firstDifference === -1 ? 'in issue order' : `first difference at byte ${String(firstDifference)}`}\n\n`,
);

silent.destroy();
for (const slot of outstanding) CloseHandle(slot.event);
for (const instance of built.value.instances) surface.close(instance);

// ---------------------------------------------------------------------------
// TEARING DOWN WITH WRITES STILL OUTSTANDING.
//
// The queue in `apps/desktop/src/hostWriteQueue.ts` hands every remaining write
// back in one `abandon` call, and its contract says why: releasing an
// `OVERLAPPED` the kernel may still be writing into is the classic overlapped-IO
// defect. What it does NOT say is how the adapter makes that safe, because
// nothing had measured it.
//
// The candidate is `CancelIoEx` then `GetOverlappedResult` with `wait` TRUE.
// Two things have to hold or the adapter cannot use it, and each is the kind of
// claim this project has been wrong about before:
//
//   the wait must RETURN — a wait on a write into a peer that never reads is
//   the hang the read side was redesigned to avoid, arriving on the write side;
//   the result must say the write did NOT happen, so a caller cannot mistake an
//   abandoned frame for a delivered one.
//
// A second pipe, because phase 1's is drained and cancelling nothing looks
// exactly like cancelling successfully.
// ---------------------------------------------------------------------------

/** The whole cancel-and-collect loop, not one call. */
const CANCEL_BUDGET_MS = 250;

const cancelName = `${pipeName}-cancel`;
const cancelBuilt = createHostPipe(surface, cancelName, user.value, container.value, 1);
if (!cancelBuilt.ok) {
  process.stderr.write(
    `the shipped factory refused the teardown pipe at stage '${cancelBuilt.error.stage}': ` +
      `${cancelBuilt.error.detail}\n`,
  );
  process.exit(1);
}
const cancelPipe = cancelBuilt.value.instances[0];

const stubborn = connect(cancelName);
stubborn.pause();
stubborn.on('error', (error) =>
  process.stderr.write(`  the stubborn client could not connect: ${error.message}\n`),
);
await new Promise((ready) => stubborn.once('connect', () => ready(undefined)));

const stubbornConnected = ConnectNamedPipe(cancelPipe, null);
const whyStubborn = GetLastError();
check(
  'SETUP: the teardown pipe has a client attached and nothing is draining it either',
  Boolean(stubbornConnected) || whyStubborn === ERROR_PIPE_CONNECTED,
  `ConnectNamedPipe said ${String(stubbornConnected)} with GetLastError ${String(whyStubborn)}. ` +
    `A cancel with nothing outstanding succeeds and returns instantly, which is the reassuring ` +
    `answer this whole phase would otherwise report.`,
);

/** @type {Array<ReturnType<typeof pending>>} */
const stranded = [];
for (const frame of frames) {
  const slot = pending(frame);
  const written = [0];
  const ok = WriteFile(cancelPipe, slot.payload, slot.payload.length, written, slot.overlapped);
  if (!ok && GetLastError() !== ERROR_IO_PENDING) break;
  stranded.push(slot);
}

const strandedPending = stranded.filter((slot) => {
  const transferred = [0];
  return !GetOverlappedResult(cancelPipe, slot.overlapped, transferred, false);
}).length;

check(
  'CONTROL: writes really were outstanding at the moment of the cancel',
  strandedPending > FRAMES / 2,
  `${String(strandedPending)} of ${String(stranded.length)} were still pending. Cancelling an ` +
    `empty queue succeeds, returns immediately and aborts nothing — which is indistinguishable ` +
    `from the mechanism working, and is the state this phase would drift into if the pipe's ` +
    `buffer ever grew.`,
);

// NOTHING BETWEEN THE COUNT ABOVE AND THIS CALL, deliberately: no await, no
// read of the client. The control asserts what was outstanding *at the cancel*,
// and any statement between them would make that label a guess. Measured by
// putting a drain there: the control still passed on a figure taken before it,
// and the two cases below were what caught the drift.
const cancelled = CancelIoEx(cancelPipe, null);
const whyCancel = GetLastError();
check(
  'CancelIoEx accepts a handle with writes outstanding',
  Boolean(cancelled),
  `CancelIoEx returned false with GetLastError ${String(whyCancel)}. Windows answers ` +
    `ERROR_NOT_FOUND (1168) when there is nothing outstanding to cancel — measured — so a false ` +
    `here is either that, or a handle the call cannot reach. Without this the adapter's abandon ` +
    `has no way to reach a write the kernel is holding, and its only remaining option is closing ` +
    `the handle underneath the I/O, which is the teardown the read side rejected.`,
);

// POLLED WITH `wait` FALSE, NOT WAITED ON, and that is a decision about this
// INSTRUMENT rather than about the adapter.
//
// `GetOverlappedResult(…, true)` is what the adapter will call, and measured
// against a cancelled write it returns in 0ms. Measured against an UNCANCELLED
// one it never returns at all: with the `CancelIoEx` call replaced by `true`,
// this probe ran to an external `timeout 25` and exited 124 — so the failure
// mode of the case below is a HANG, and a probe that hangs in CI is a job
// timeout rather than a named failure, which is worse than no probe (CCCC-3).
//
// The property the adapter needs is that the completions become AVAILABLE
// promptly after a cancel, and a wait on an available completion returns by
// definition. Polling measures that and cannot hang. What it gives up is
// exercising `wait` true itself, which is stated here rather than assumed away.
const collectStarted = Date.now();
/** @type {number[]} */
const abortCodes = [];
let resolvedAll = true;
let unresolved = 0;
for (const slot of stranded) {
  const transferred = [0];
  let settled = false;
  while (!settled && Date.now() - collectStarted < CANCEL_BUDGET_MS) {
    if (GetOverlappedResult(cancelPipe, slot.overlapped, transferred, false)) {
      settled = true;
      break;
    }
    const why = GetLastError();
    if (why === ERROR_IO_INCOMPLETE) continue;
    abortCodes.push(why);
    if (why !== ERROR_OPERATION_ABORTED) resolvedAll = false;
    settled = true;
  }
  if (!settled) unresolved += 1;
}
const collectMs = Date.now() - collectStarted;

check(
  `every cancelled write becomes collectable within ${String(CANCEL_BUDGET_MS)}ms rather than waiting for a reader`,
  unresolved === 0 && collectMs < CANCEL_BUDGET_MS,
  `${String(unresolved)} of ${String(stranded.length)} were still incomplete after ` +
    `${String(collectMs)}ms. A completion that does not arrive is one the adapter would wait for, ` +
    `and that wait is the hang the read side was redesigned to avoid arriving on the write side — ` +
    `in the process that must stay responsive.`,
);

check(
  'and each says the write did NOT happen, so an abandoned frame cannot read as a delivered one',
  resolvedAll && abortCodes.length > 0,
  abortCodes.length === 0
    ? `no write reported an abort, so every one of them had completed before the cancel and this ` +
      `case observed nothing. That is the CONTROL above failing one step later.`
    : `codes ${JSON.stringify([...new Set(abortCodes)])}; ` +
      `${String(ERROR_OPERATION_ABORTED)} is the one the caller can act on. A cancelled write ` +
      `reporting anything else leaves the adapter unable to tell a frame it abandoned from one ` +
      `the peer received.`,
);

process.stdout.write(
  `  ${String(strandedPending)} of ${String(stranded.length)} outstanding at the cancel, ` +
    `collected in ${String(collectMs)}ms, ` +
    `${String(abortCodes.length)} aborted\n\n`,
);

stubborn.destroy();
for (const slot of stranded) CloseHandle(slot.event);
for (const instance of cancelBuilt.value.instances) surface.close(instance);

if (failures.length > 0) {
  process.stderr.write(
    `\nTransport write — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`${roster.format('write case')}`);
