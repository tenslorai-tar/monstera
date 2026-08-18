// @ts-check
/**
 * Peak resident set size of a process, taken from the kernel rather than sampled.
 *
 * ## Why not a sampler
 *
 * The obvious instrument is a `setInterval` inside the measured process reading
 * `process.memoryUsage().rss`. This project has already shipped that one and it
 * was confidently wrong: a timer cannot fire while a synchronous FFI call holds
 * the event loop, and it reported **63 MB for a walk that cost 526 MB** —
 * reproducibly, which is what made it convincing.
 *
 * `process.resourceUsage().maxRSS` is the high-water mark the KERNEL maintains
 * for the process (`PeakWorkingSetSize` on Windows, `ru_maxrss` elsewhere).
 * Nothing in user space has to get a turn for it to be correct, so a blocked
 * loop cannot hide from it. Measured: an identical allocation with the loop
 * spun for 400 ms reports the same figure to within noise.
 *
 * It is reported in **kilobytes**, which is the one detail most likely to be got
 * wrong silently — a 1024× error in a budget check looks like an enormous
 * headroom rather than like a bug. `peakRssBytes` converts once, here.
 *
 * ## What RSS can and cannot tell you
 *
 * It is the allocator's high-water mark, not live bytes, so it cannot separate
 * "the engine retains this" from "the allocator is sitting on it". That is a
 * real limit and it is why RSS is not the whole story — but it IS the right
 * quantity for a containment budget, because the thing a containment limit
 * protects is the machine, and the machine sees RSS. Where the question is
 * instead "what does the engine hold", the shim's own allocator counters answer
 * it, and `nativeStoreMeasure.mjs` reads those.
 *
 * The same property explains a result that otherwise reads as a bug: RSS after
 * a save can sit BELOW RSS after the open, because the heap grown to absorb the
 * open spike is reused rather than returned.
 *
 * ## The contract
 *
 * A measured script ends by calling `reportPeak`. A script that does not is a
 * measurement failure, not a zero — `measurePeak` throws rather than returning
 * a number nobody produced, for the same reason nothing else in this path has a
 * default.
 */

import { spawnSync } from 'node:child_process';

/** Marker for the line carrying the measurement, so ordinary output cannot be mistaken for it. */
const MARKER = '__MONSTERA_PEAK__';

/** @returns {number} This process's peak RSS in bytes, from the kernel. */
export function peakRssBytes() {
  // maxRSS is kilobytes. Converting at the single point of use rather than at
  // each caller keeps the 1024 in one place; a missed conversion here reads as
  // three orders of magnitude of headroom, which is exactly the kind of wrong
  // number that passes a budget check quietly.
  return process.resourceUsage().maxRSS * 1024;
}

/**
 * Ends a measured run. Call once, last.
 *
 * @param {Record<string, unknown>} [detail] Anything the caller wants returned alongside.
 */
export function reportPeak(detail = {}) {
  process.stdout.write(`\n${MARKER}${JSON.stringify({ peakRssBytes: peakRssBytes(), detail })}\n`);
}

/**
 * @typedef {{ peakRssBytes: number, detail: Record<string, unknown>, output: string }} Measurement
 */

/**
 * Runs a script in its own process and returns the peak RSS it reported.
 *
 * A separate process is not incidental. Measuring in-process would fold the
 * harness's own allocations — the fixture it may have just written, the JSON it
 * parsed — into the figure being compared against a budget, and those have
 * nothing to do with the role under test.
 *
 * @param {string} scriptPath
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {Measurement}
 */
export function measurePeak(scriptPath, args = [], options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 15 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0) {
    throw new Error(
      `Measured run failed (exit ${String(result.status)}): ${scriptPath} ${args.join(' ')}\n${output.slice(-4000)}`,
    );
  }

  const line = `${result.stdout ?? ''}`.split('\n').find((candidate) => candidate.startsWith(MARKER));
  if (line === undefined) {
    throw new Error(
      `${scriptPath} produced no measurement. It must end by calling reportPeak().\n` +
        `A missing measurement is not zero and must not be treated as one: a budget check that ` +
        `reads 0 bytes passes every limit.\n${output.slice(-2000)}`,
    );
  }

  /** @type {{ peakRssBytes: number, detail: Record<string, unknown> }} */
  const parsed = JSON.parse(line.slice(MARKER.length));
  if (!Number.isFinite(parsed.peakRssBytes) || parsed.peakRssBytes <= 0) {
    throw new Error(`${scriptPath} reported a non-positive peak: ${String(parsed.peakRssBytes)}`);
  }

  return { peakRssBytes: parsed.peakRssBytes, detail: parsed.detail, output };
}

/** @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
