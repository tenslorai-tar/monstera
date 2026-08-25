// @ts-check
/**
 * Does the SHIPPED reader thread carry bytes, and stop when it is told?
 *
 * ## What this closes
 *
 * CCCC-2: `transportTeardown.mjs` measures termination and nothing about bytes
 * crossing — its worker's read-completed branch is reached by no cell. This
 * drives the shipped `packages/nodemode/dist/readerWorker.js` over a real pipe
 * created by the shipped factory, so a frame goes end to end through the code
 * that will carry it.
 *
 * It sits beside `transportTeardown.mjs` rather than replacing it: that one asks
 * what a two-handle wait does and what the rejected one-handle design does, with
 * the waits written out where they can be mutated. This asks whether our reader
 * uses them correctly.
 *
 * ## What separates the cases
 *
 * The reassuring answer is *the reader ended cleanly*, and a reader that never
 * read anything produces it too — which is exactly the gap CCCC-2 names. So the
 * bytes are compared against what was written, and the frames name their own
 * index: a byte count cannot see a reorder, and a reader that dropped a chunk
 * and read the next one twice would sum the same.
 *
 * The stop is measured with the reader in the state it will actually be in —
 * waiting for bytes, having already delivered some — rather than at the connect
 * wait, which `transportTeardown.mjs` already covers.
 *
 * Usage: node scripts/research/readerWorker.mjs [--require-transport]
 */

import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();

/** Frames the client sends to the reader. */
const FRAMES = 16;
/** Each frame's size. Smaller than the pipe's 4096-byte buffer, so several coalesce. */
const FRAME_BYTES = 512;
/** How long the reader has to deliver everything. */
const DELIVERY_BUDGET_MS = 10000;
/** How long the reader has to end after the stop event is signalled. */
const STOP_BUDGET_MS = 2000;
/** The reader's own read buffer. */
const READ_BYTES = 64 * 1024;

/** Passed by the jobs that provision. See `scripts/lib/unverifiable.mjs`. */
const REQUIRE = process.argv.includes('--require-transport');
/** @param {string} why @returns {never} */
const unverifiable = (why) =>
  exitUnverifiable({
    required: REQUIRE,
    subject: "the shipped reader thread",
    why,
    flag: '--require-transport',
  });

if (process.platform !== 'win32') {
  unverifiable(`this drives a Win32 named pipe, which does not exist on ${process.platform}.`);
}

const BUILT = {
  pipeSurface: join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js'),
  pipeFactory: join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js'),
  reader: join(ROOT, 'packages', 'nodemode', 'dist', 'readerWorker.js'),
};
for (const built of Object.values(BUILT)) {
  if (!existsSync(built)) {
    unverifiable(
      `${built} is not built. This drives the SHIPPED reader rather than a copy, so without the ` +
        'build there is nothing to measure. Run `npm run build`.',
    );
  }
}

const { createWin32PipeSurface, createWin32ReaderControl, currentUserSid, hostContainerSid } =
  await import(pathToFileURL(BUILT.pipeSurface).href);
const { createHostPipe } = await import(pathToFileURL(BUILT.pipeFactory).href);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {number} ms @returns {Promise<void>} */
const rest = (ms) => new Promise((done) => setTimeout(done, ms).unref?.() ?? undefined);

const CONTAINER = 'monstera-reader-worker-probe';
const pipes = createWin32PipeSurface();
const control = createWin32ReaderControl();
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
const built = createHostPipe(pipes, pipeName, user.value, container.value, 1);
if (!built.ok) {
  process.stderr.write(
    `the shipped factory refused at stage '${built.error.stage}': ${built.error.detail}\n`,
  );
  process.exit(1);
}
const pipe = built.value.instances[0];

const stopEvent = control.createStopEvent();
check(
  'SETUP: the shipped control creates a stop event',
  stopEvent !== null,
  `createStopEvent returned null, GetLastError ${String(control.lastError())}. Without it there ` +
    `is no way to tell the reader anything, which is the whole reason the wait has two handles.`,
);
if (stopEvent === null) process.exit(1);

/**
 * Frame `index` filled with `index % 256`, carrying `index` as a little-endian
 * uint32 at offset 0.
 *
 * The index is what lets a reorder or a repeat be seen. Identical frames sum to
 * the same total however they arrive, so a byte count reports the reassuring
 * answer for a reader that dropped one chunk and delivered another twice.
 */
const frames = Array.from({ length: FRAMES }, (_, index) => {
  const frame = Buffer.alloc(FRAME_BYTES, index % 256);
  frame.writeUInt32LE(index, 0);
  return frame;
});
const expected = Buffer.concat(frames);

// ---------------------------------------------------------------------------
// The reader, started the way the shipped factory will start it: addresses over
// workerData, nothing sent to it afterwards.
// ---------------------------------------------------------------------------
/** @type {Buffer[]} */
const received = [];
/**
 * How much each chunk's UNDERLYING buffer weighed, against how much it carried.
 *
 * Structured clone copies a TypedArray's entire `ArrayBuffer`, not the view's
 * range — measured — so a reader posting `buffer.subarray(0, n)` sends its whole
 * read buffer across the boundary on every chunk. `byteLength` alone cannot see
 * that: the view and the copy both arrive carrying `n` bytes.
 */
/** @type {Array<{ carried: number, weighed: number }>} */
const chunkWeights = [];
/** @type {string[]} */
const endings = [];
let exited = false;

const worker = new Worker(BUILT.reader, {
  workerData: {
    pipeAddress: control.addressOf(pipe),
    stopAddress: control.addressOf(stopEvent),
    readBytes: READ_BYTES,
  },
});
worker.on('message', (message) => {
  if (message.kind === 'chunk') {
    // Read BEFORE the copy below, which would give it a right-sized buffer of
    // its own and erase the thing being measured.
    chunkWeights.push({ carried: message.bytes.byteLength, weighed: message.bytes.buffer.byteLength });
    received.push(Buffer.from(message.bytes));
  } else endings.push(String(message.detail));
});
worker.on('error', (error) => endings.push(`THREW: ${error.message}`));
worker.on('exit', () => {
  exited = true;
});

const client = connect(pipeName);
client.on('error', (error) =>
  process.stderr.write(`  the client could not connect: ${error.message}\n`),
);
await new Promise((ready) => client.once('connect', () => ready(undefined)));

/** @param {number} bytes @param {number} started @returns {Promise<void>} */
async function waitForBytes(bytes, started) {
  while (
    received.reduce((sum, chunk) => sum + chunk.length, 0) < bytes &&
    endings.length === 0 &&
    Date.now() - started < DELIVERY_BUDGET_MS
  ) {
    await rest(10);
  }
}

// WRITTEN IN TWO BATCHES, WAITING FOR THE FIRST TO ARRIVE.
//
// Written all at once first, and the control below caught it: all 16 frames
// landed in ONE read, because the client had finished writing before the
// reader's first `ReadFile` completed and a 64KB read buffer takes 8192 bytes
// without noticing. Every case passed except the one asking whether the loop
// looped — which is the branch a transport spends its life in, and it had never
// executed.
//
// Waiting for the first batch to be DELIVERED, rather than sleeping, is what
// makes the second read a certainty instead of a race: the reader cannot have
// delivered those bytes without completing a read, and it cannot complete the
// next one before the second batch exists.
const deliveryStarted = Date.now();
const half = FRAMES / 2;
for (const frame of frames.slice(0, half)) client.write(frame);
await waitForBytes(half * FRAME_BYTES, deliveryStarted);
for (const frame of frames.slice(half)) client.write(frame);
await waitForBytes(expected.length, deliveryStarted);

const stream = Buffer.concat(received);
check(
  'the reader delivers every byte the client wrote',
  stream.length === expected.length,
  `received ${String(stream.length)} of ${String(expected.length)} bytes in ` +
    `${String(Date.now() - deliveryStarted)}ms; endings so far: ${JSON.stringify(endings)}. This ` +
    `is CCCC-2's gap closed: the teardown probe measures termination and nothing about bytes, so ` +
    `a reader that ended cleanly having read nothing satisfied it.`,
);

check(
  'and in the order they were written',
  stream.equals(expected),
  `the stream differs from what was written. A byte COUNT cannot see this — a reader that ` +
    `dropped one chunk and delivered another twice sums the same — which is why each frame ` +
    `carries its own index.`,
);

check(
  'CONTROL: it arrived in more than one chunk, so the loop ran more than once',
  received.length > 1,
  `${String(received.length)} chunk(s) for ${String(FRAMES)} frames of ` +
    `${String(FRAME_BYTES)} bytes against a 4096-byte pipe buffer. One chunk would mean the read ` +
    `loop completed once and this says nothing about it looping — the branch a single read never ` +
    `reaches is the one a transport spends its life in.`,
);

check(
  'each chunk crosses the boundary carrying only what it carries',
  chunkWeights.length > 0 && chunkWeights.every((chunk) => chunk.weighed === chunk.carried),
  `weights = ${JSON.stringify(chunkWeights)}. Structured clone copies a TypedArray's ENTIRE ` +
    `underlying ArrayBuffer, so a reader posting a view into its read buffer sends all ` +
    `${String(READ_BYTES)} bytes per chunk whatever the read returned — measured, and invisible ` +
    `to byteLength, which reads the same either way. Without this case the copy in the reader is ` +
    `unproven: making it a view leaves every other case here green.`,
);

check(
  'and it is still running, not ended, with bytes delivered',
  endings.length === 0,
  `the reader ended before it was told to: ${JSON.stringify(endings)}. A reader that ends on its ` +
    `own after delivering is indistinguishable from one that was stopped, and only the second is ` +
    `something anybody asked for.`,
);

// ---------------------------------------------------------------------------
// THE STOP, with the reader in the state it will really be in: waiting for
// bytes, having already delivered some. The connect wait is the other probe's.
// ---------------------------------------------------------------------------
const signalled = control.signal(stopEvent);
const stopStarted = Date.now();
while (!exited && Date.now() - stopStarted < STOP_BUDGET_MS) await rest(10);
const stopMs = Date.now() - stopStarted;

check(
  'signalling the stop event ends a reader that is waiting for bytes',
  signalled && exited && stopMs < STOP_BUDGET_MS,
  `signal=${String(signalled)}, exited=${String(exited)} after ${String(stopMs)}ms. The rejected ` +
    `design — waiting on the read alone — wedges here with the thread alive until something ` +
    `outside kills it, measured by transportTeardown.mjs at both of its waits.`,
);

check(
  'and it says WHY it ended, once',
  endings.length === 1 && endings[0]?.includes('stopped') === true,
  `endings = ${JSON.stringify(endings)}. One message for every ending, and the transport above ` +
    `decides who caused it from which of its own calls it was in — a reader classifying its own ` +
    `ending would be a second opinion about a question the layer above already answers.`,
);

process.stdout.write(
  `\n  ${String(stream.length)} byte(s) in ${String(received.length)} chunk(s), ` +
    `${stream.equals(expected) ? 'in write order' : 'DIFFERING'}\n` +
    `  reader ended ${String(stopMs)}ms after the stop event: ${endings[0] ?? '(no ending)'}\n\n`,
);

client.destroy();
await worker.terminate();
control.closeEvent(stopEvent);
for (const instance of built.value.instances) pipes.close(instance);

if (failures.length > 0) {
  process.stderr.write(
    `\nShipped reader — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`${roster.format('reader case')}`);
