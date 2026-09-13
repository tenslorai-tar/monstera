// @ts-check
/**
 * Proves that importing `DocumentService` loads **neither** native engine.
 *
 * ## It was MuPDF's until 2026-09-09, and the widening is the point
 *
 * The class this guards is *the barrel binds no native library*, and while
 * there was one adapter the class and the module were the same thing. The first
 * PDFium-routed command put a second adapter behind the seam, and a proof still
 * naming one module would have read as watching a class it covered half of —
 * the enumeration failure this project has already paid for, where naming one
 * omitted set reads exactly like naming all of them. Each engine gets its own
 * anchor, its own four questions and its own failure text, because the remedy
 * differs: `@monstera/kernel/engine`'s discipline for one and
 * `@monstera/kernel/pdfium`'s for the other.
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

/**
 * The second adapter that binds a native library, from 2026-09-09.
 *
 * A separate constant rather than a list the cases loop over, and that is a
 * choice about the failure messages: what a reader needs when this goes red is
 * *which engine reached where*, and the two have different causes and different
 * remedies — one is `@monstera/kernel/engine`'s discipline and the other is
 * `@monstera/kernel/pdfium`'s. A loop would produce one message shape for two
 * problems.
 */
const PDFIUM_FORBIDDEN = 'pdfiumFfi.js';

/**
 * The Markdown composer, from 2026-09-13 (ADR-0060).
 *
 * Its own constant for `PDFIUM_FORBIDDEN`'s reason: the remedy differs. It is not
 * a native library — it loads `markdown-it`, a parser of files a person picked,
 * which threat model §2 keeps out of `main` — and `@monstera/kernel/compose` is the
 * discipline that keeps it off the barrel.
 */
const COMPOSE_FORBIDDEN = 'markdownCompose.js';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 16 });

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
      `before this held and +7.5 to +8.0 MB after across five sweeps, against +39.3 MB for the ` +
      `adapter itself. The single +9.6 MB reading first recorded here sat outside that range, ` +
      `and under the pinned Electron runtime the same delta is +10.3 MB (SSSS-2): a marginal ` +
      `cost is not runtime-independent, so a figure without its runtime cannot be subtracted ` +
      `from one taken under another.\n` +
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
    'both modules are PRESENT, so "not reachable" is a claim about reachability and not absence',
    existsSync(join(DIST, FORBIDDEN)) && existsSync(join(DIST, 'rotatePages.js')),
    `${FORBIDDEN} or rotatePages.js is missing from ${DIST}. The reachability question is only ` +
      `meaningful while both exist; without them "not reachable" is true and means nothing.`,
  );

  // THE SECOND ENGINE, added 2026-09-09 with the first PDFium-routed command.
  //
  // Every case above names `mupdfWriter.js` because it was the only adapter
  // that bound a native library. `pdfiumFfi.js` is the second, and the class
  // this proof guards is *the barrel does not bind a native library* rather
  // than *the barrel does not bind MuPDF* — so leaving it at one module would
  // be a check that reads as watched over half the class it names. That is the
  // enumeration failure this project has already paid for once, in a finding
  // that named one of two omitted sets.
  //
  // The control is the same shape and its anchor is the PDFium entry point,
  // which exists for the sole purpose of exporting the adapter — so a walk that
  // cannot see it is blind rather than reassuring.
  const pdfiumFromEntry = reaches('pdfium.js', PDFIUM_FORBIDDEN);
  const pdfiumFromIndex = reaches('index.js', PDFIUM_FORBIDDEN);
  const pdfiumFromBus = reaches('commandBus.js', PDFIUM_FORBIDDEN);
  const pdfiumFromService = reaches('documentService.js', PDFIUM_FORBIDDEN);

  check(
    `CONTROL: ${PDFIUM_FORBIDDEN} IS reachable from pdfium.js, so the walk can see it`,
    pdfiumFromEntry.reached,
    `the walk could not reach ${PDFIUM_FORBIDDEN} from pdfium.js, which exists for the sole ` +
      `purpose of exporting the PDFium adapter. So it cannot see the module the cases below ` +
      `claim something avoids, and each of them is satisfied by blindness.`,
  );

  check(
    `importing the kernel's public surface does not load ${PDFIUM_FORBIDDEN}`,
    !pdfiumFromIndex.reached,
    `reachable via ${pdfiumFromIndex.path.join(' -> ')}.\n` +
      `      ADR-0026 clause 2, on the second engine. \`pdfiumFfi.js\` imports koffi and binds ` +
      `\`pdfium.dll\` when told to; a barrel edge would put both in \`main\`, which invariant ` +
      `20 forbids and \`@monstera/kernel/pdfium\` exists to keep out. Read the emit for the ` +
      `module named in the path above — the cause is almost always ` +
      `\`import { type X } from\`, which keeps the specifier and RUNS.`,
  );

  check(
    `importing CommandBus does not load ${PDFIUM_FORBIDDEN}`,
    !pdfiumFromBus.reached,
    `reachable via ${pdfiumFromBus.path.join(' -> ')}.\n` +
      `      The bus takes its routing from commandDeclarations.js and calls nothing directly, ` +
      `so an edge to a spec table is an edge to every writer's implementation — which now ` +
      `includes a second native binding rather than one.`,
  );

  check(
    `importing DocumentService does not load ${PDFIUM_FORBIDDEN}`,
    !pdfiumFromService.reached,
    `reachable via ${pdfiumFromService.path.join(' -> ')}.\n` +
      `      The module whose entire argument is that it holds bytes and never parses them ` +
      `(ARCHITECTURE §2) must not reach either engine.`,
  );

  check(
    `${PDFIUM_FORBIDDEN} is PRESENT, so its four answers above are about reachability`,
    existsSync(join(DIST, PDFIUM_FORBIDDEN)),
    `${PDFIUM_FORBIDDEN} is missing from ${DIST}, so "not reachable" is true and means nothing.`,
  );
  // THE MARKDOWN PARSER, added 2026-09-13 with the compose host (ADR-0060).
  //
  // Not a native library, and the class still reaches it: this proof guards
  // what `main`'s module graph loads, and threat model §2 keeps document parsing
  // of any kind out of `main`. A file picked for import is parsed in the compose
  // host, so a barrel edge to `markdownCompose.js` would put `markdown-it` in the
  // process that holds every open document with nothing about the import looking
  // wrong.
  //
  // The control is the same shape, anchored on `compose.js`, which exists to
  // export the composer — so a walk that cannot see it is blind rather than
  // reassuring.
  const composeFromEntry = reaches('compose.js', COMPOSE_FORBIDDEN);
  const composeFromIndex = reaches('index.js', COMPOSE_FORBIDDEN);
  const composeFromBus = reaches('commandBus.js', COMPOSE_FORBIDDEN);
  const composeFromService = reaches('documentService.js', COMPOSE_FORBIDDEN);

  check(
    `CONTROL: ${COMPOSE_FORBIDDEN} IS reachable from compose.js, so the walk can see it`,
    composeFromEntry.reached,
    `the walk could not reach ${COMPOSE_FORBIDDEN} from compose.js, which exists to export the ` +
      `composer. So it cannot see the module the cases below claim something avoids, and each of ` +
      `them is satisfied by blindness.`,
  );

  check(
    `importing the kernel's public surface does not load ${COMPOSE_FORBIDDEN}`,
    !composeFromIndex.reached,
    `reachable via ${composeFromIndex.path.join(' -> ')}.\n` +
      `      ADR-0060: a file picked for import is parsed in the compose host and never in ` +
      `\`main\`, and \`@monstera/kernel/compose\` exists to keep \`markdown-it\` out of the barrel. ` +
      `Read the emit for the module named in the path above — the cause is almost always ` +
      `\`import { type X } from\`, which keeps the specifier and RUNS.`,
  );

  check(
    `importing CommandBus does not load ${COMPOSE_FORBIDDEN}`,
    !composeFromBus.reached,
    `reachable via ${composeFromBus.path.join(' -> ')}.\n` +
      `      The bus routes commands to writers and composes nothing; an edge to the composer ` +
      `would load a parser of hostile input into every process that routes a command.`,
  );

  check(
    `importing DocumentService does not load ${COMPOSE_FORBIDDEN}`,
    !composeFromService.reached,
    `reachable via ${composeFromService.path.join(' -> ')}.\n` +
      `      The module whose entire argument is that it holds bytes and never parses them ` +
      `(ARCHITECTURE §2) must not reach a Markdown parser either.`,
  );

  check(
    `${COMPOSE_FORBIDDEN} is PRESENT, so its four answers above are about reachability`,
    existsSync(join(DIST, COMPOSE_FORBIDDEN)),
    `${COMPOSE_FORBIDDEN} is missing from ${DIST}, so "not reachable" is true and means nothing.`,
  );

  // WHAT THIS CASE USED TO SAY, and why it no longer does (finding KKKK-3).
  //
  // Its title was *"the emit still names the module it type-imports"* and it
  // opened with `importsOf(join(DIST, 'commandLog.js')).length >= 0` — a
  // tautology twice over. `>= 0` cannot be false, and `importsOf` matches only
  // `./`-relative specifiers while `commandLog.js`'s emit contains none, so the
  // call returns `[]` on every run regardless of what it is asked.
  //
  // The title was the worse half. After the fix `commandLog.js`'s emit does NOT
  // name `rotatePages.js` — `import type` is erased entirely, which is the
  // property this proof exists to defend — so the title described the DEFECT
  // state and a reader would have believed the proof watched something it never
  // did, in the file whose header is this trap's canonical write-up.
  //
  // What survives is real and is what the title now says: both modules exist,
  // so every "not reachable" above is about reachability rather than about a
  // module that is simply not there.

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
