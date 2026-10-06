// @ts-check
/**
 * Preloaded into each lint unit's process by `lintcheck.mjs` (ADR-0170): at exit, writes the process's own peak
 * resident memory to file descriptor 3, the pipe the runner opens for it.
 *
 * `process.resourceUsage().maxRSS` is the operating system's high-water mark, in kilobytes on every platform Node
 * runs on, kept by the kernel and only ever raised, so it cannot miss a peak the way a sampler busy in synchronous
 * work can. A process that ends at the heap limit never reaches this handler, and the runner reports that as the unit
 * going over the budget instead.
 */

import { writeSync } from 'node:fs';

process.on('exit', () => {
  writeSync(3, JSON.stringify({ maxRssKb: process.resourceUsage().maxRSS }));
});
