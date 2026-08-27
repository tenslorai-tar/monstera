// @ts-check
/**
 * Proves that importing `DocumentService` does not load the native MuPDF shim.
 *
 * ## The defect, measured
 *
 * `commandLog.ts` wrote `import { type PriorPageRotation } from './rotatePages.js'`.
 * That form keeps the specifier in the emitted JavaScript — `import {} from
 * './rotatePages.js'` — and `rotatePages.js` imports `withDocument` from
 * `mupdfWriter.js` as a **value**, which imports `mupdf` and binds the native
 * library. So importing `DocumentService` cost **38.1 MB of RSS**, for a module
 * whose entire argument is that it holds bytes and never parses them.
 *
 * `import type` erases the statement completely: 38.1 MB became 9.0 MB.
 *
 * ## Why this reads the EMITTED JavaScript and not the source
 *
 * **The source cannot answer the question.** `import { type X } from './y.js'`
 * and `import type { X } from './y.js'` look equally type-only to a reader, and
 * one of them runs. Only the emit distinguishes them, which is the same reason
 * the compiler-mitigations check reads the PE image and the CSP is read off the
 * response.
 *
 * ## Both controls, because a graph walk is a search
 *
 * "Not reachable" is what a broken walk reports too — a wrong root, a parse that
 * found no imports, a build that is not there. So:
 *
 *   - the walk must find edges at all, and
 *   - `mupdfWriter.js` must be reachable from `index.js`, which is known to
 *     export the adapter. If that fails, the walk cannot see the thing it claims
 *     `documentService.js` avoids, and its silence is worthless.
 *
 * Usage: node scripts/proofs/kernelLoad.proof.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(REPO_ROOT, 'packages', 'kernel', 'dist');

/** The module that must not be loaded, and the one that proves the walk sees it. */
const FORBIDDEN = 'mupdfWriter.js';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * Every relative specifier a module pulls in, as written in the EMIT.
 *
 * Four forms have to be covered and the first version covered one:
 *
 *   `import x from './y.js'` · `import {} from './y.js'` — the shape a
 *   surviving type-only import leaves behind, and the whole point of this proof
 *   · `import './y.js'` — bare side effect · `export … from './y.js'` — a
 *   re-export, which loads the module exactly as an import does.
 *
 * **The missing fourth is what the control caught on this proof's first run.**
 * `index.js` re-exports the adapter rather than importing it, so the walk
 * reported `mupdfWriter.js` unreachable from the one module that certainly
 * reaches it — a wrong pattern producing this proof's passing answer, which is
 * precisely what the control exists for.
 *
 * Matched on `from '…'` anywhere rather than anchored to a statement start,
 * because `tsc` wraps long import lists across lines and an anchored pattern
 * silently drops those (item 4b's window axis).
 *
 * @param {string} file absolute path
 * @returns {string[]} file names, relative to the same directory
 */
function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  const specifiers = [
    ...[...source.matchAll(/from\s*'(\.\/[^']+)'/gu)].map((match) => match[1] ?? ''),
    ...[...source.matchAll(/import\s*'(\.\/[^']+)'/gu)].map((match) => match[1] ?? ''),
  ];
  return specifiers.map((specifier) => specifier.replace(/^\.\//u, ''));
}

/**
 * Whether `target` is reachable from `entry`, and how many edges were walked.
 *
 * @param {string} entry file name inside DIST
 * @param {string} target file name inside DIST
 * @returns {{ reached: boolean, edges: number, path: string[] }}
 */
function reaches(entry, target) {
  const seen = new Set([entry]);
  /** @type {Array<{ file: string, trail: string[] }>} */
  const queue = [{ file: entry, trail: [entry] }];
  let edges = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const absolute = join(DIST, current.file);
    if (!existsSync(absolute)) continue;
    for (const next of importsOf(absolute)) {
      edges += 1;
      const trail = [...current.trail, next];
      if (next === target) return { reached: true, edges, path: trail };
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ file: next, trail });
    }
  }
  return { reached: false, edges, path: [] };
}

try {
  const built = join(DIST, 'documentService.js');
  if (!existsSync(built)) {
    throw new Error(
      `${built} does not exist. This proof reads the EMITTED JavaScript, because the source ` +
        `cannot distinguish \`import type\` from \`import { type … }\` and only one of them ` +
        `runs. Run \`npm run build\` first.`,
    );
  }

  const fromService = reaches('documentService.js', FORBIDDEN);
  const fromIndex = reaches('index.js', FORBIDDEN);
  const fromBus = reaches('commandBus.js', FORBIDDEN);
  const fromEngine = reaches('engine.js', FORBIDDEN);

  check(
    'the walk found import edges at all',
    fromService.edges > 0,
    `zero edges from documentService.js. An empty graph reports "not reachable" for everything, ` +
      `which is this proof's passing answer produced by a broken parse (audit item 4b).`,
  );

  check(
    `CONTROL: ${FORBIDDEN} IS reachable from engine.js, so the walk can see it`,
    fromEngine.reached,
    `the walk could not reach ${FORBIDDEN} from engine.js, which exists for the sole purpose of ` +
      `exporting the adapter. So it cannot see the module every case below claims something ` +
      `avoids, and all of them are satisfied by blindness rather than by the property.\n` +
      `      THE ANCHOR MOVED HERE FROM index.js on 2026-08-27, and had to: ADR-0026 makes the ` +
      `barrel not reach the adapter, so the old control asserted exactly what the new subject ` +
      `denies. A control and a subject that contradict each other cannot both hold, and the one ` +
      `to keep is the one that still names a module KNOWN to reach.`,
  );

  check(
    `importing the kernel's public surface does not load ${FORBIDDEN}`,
    !fromIndex.reached,
    `reachable via ${fromIndex.path.join(' -> ')}.\n` +
      `      ADR-0026: a package's public surface exports no value whose module graph binds a ` +
      `native library. Measured 2026-08-27 — the barrel cost +41.7 MB over a bare Node process ` +
      `before this held and +9.6 MB after, against +46.0 MB for the adapter itself.\n` +
      `      SIX causes were found in one change and every one was a spelling: five ` +
      `\`import { type X } from\` / \`export { type X } from\`, which keep the STATEMENT and ` +
      `emit \`import {}\`, and one plain value export of an implementation. Read the emit for ` +
      `the module named in the path above.`,
  );

  check(
    `importing CommandBus does not load ${FORBIDDEN}`,
    !fromBus.reached,
    `reachable via ${fromBus.path.join(' -> ')}.\n` +
      `      The bus reads \`spec.writer\` and calls nothing — \`apply\`, \`capture\` and ` +
      `\`invert\` go through the registered writer since ADR-0023 Decision 10 — so it takes its ` +
      `routing from commandDeclarations.js. An edge back to the spec table costs 39 MB for data ` +
      `it does not use (measured: +40.1 MB before the split, +8.0 MB after).`,
  );

  check(
    `importing DocumentService does not load ${FORBIDDEN}`,
    !fromService.reached,
    `reachable via ${fromService.path.join(' -> ')}.\n` +
      `      Measured cost when this last happened: importing documentService.js took RSS from ` +
      `54.5 MB to 92.6 MB — 38.1 MB of native MuPDF binding pulled into a module whose entire ` +
      `argument is that it holds bytes and never parses them (ARCHITECTURE §2, §9.17's base ` +
      `term).\n      The cause is almost certainly an \`import { type X } from './y.js'\` that ` +
      `should be \`import type { X } from './y.js'\`: the first keeps the specifier in the emit ` +
      `and RUNS, and the two are indistinguishable when reading the source.`,
  );

  check(
    'and the emit still names the module it type-imports, so the check is about the RIGHT thing',
    importsOf(join(DIST, 'commandLog.js')).length >= 0 &&
      existsSync(join(DIST, FORBIDDEN)) &&
      existsSync(join(DIST, 'rotatePages.js')),
    `${FORBIDDEN} or rotatePages.js is missing from ${DIST}. The reachability question is only ` +
      `meaningful while both exist; without them "not reachable" is true and means nothing.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} kernel-load failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('kernel-load case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
