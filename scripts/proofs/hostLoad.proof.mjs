// @ts-check
/**
 * Proves that no engine host loads the renderer's side of the contract, and that the
 * MuPDF host loads no other writer's library.
 *
 * ## The defect, measured
 *
 * CI at `55216b4` (2026-09-18) failed §9.17's gate on one line: the contained MuPDF host's
 * fixed cost read **129.0 MB** against `base 128 MB`. On 2026-09-01 the same cell read
 * 85.44–90.03 MB over 114 runs on `windows-latest` (docs/FEATURES.md, the deferred
 * `base 128 MB` row). Nothing in the failing commit touched code; the host had grown by
 * ~35 MB across three weeks of channels, and the gate caught it the first time a runner's
 * reading crossed.
 *
 * Two routes, each loading code no host runs (fresh Node process per module, forced
 * collection, 2026-09-19):
 *
 * - **the contract's package root.** Every host imported `@monstera/contract`, which
 *   builds the renderer's whole channel map at load: `channels.js` +33.2 MB against
 *   `commands.js` +19.1 MB. `@monstera/contract/host` is the contract without it.
 * - **every writer's specs.** The MuPDF host took `localMupdfExecution` from
 *   `commandSpecs.js`, which spreads pdf-lib's, PDFium's and the signing writer's tables
 *   and so loads their libraries: `commandSpecs.js` +72.6 MB against `mupdfWriter.js`
 *   +52.7 MB.
 *
 * ## Why this reads the EMITTED JavaScript
 *
 * `kernelLoad.proof.mjs`' reason: `import { type X } from '@monstera/contract'` keeps the
 * statement in the emit and LOADS the root, while `import type { X }` is erased. They look
 * equally type-only in source; only the emit tells them apart.
 *
 * ## The controls, because a graph walk is a search
 *
 * "Names no forbidden module" is what a broken walk reports too, so each question has an
 * entry KNOWN to reach the thing: the kernel's own root names the contract root, the
 * contract's root reaches `channels.js`, and `commandSpecs.js` reaches `pdfLibWriter.js`.
 * A walk that cannot see those cannot vouch for the hosts.
 *
 * Usage: node scripts/proofs/hostLoad.proof.mjs [--list]
 *   --list prints every host-graph module that names the contract root, and stops.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KERNEL_DIST = join(REPO_ROOT, 'packages', 'kernel', 'dist');
const CONTRACT_DIST = join(REPO_ROOT, 'packages', 'contract', 'dist');

/** The contract's package root: the specifier no host module may name. */
const CONTRACT_ROOT = '@monstera/contract';

/** Every engine host's entry, relative to the kernel's dist. */
const HOSTS = ['host/hostEntry.js', 'host/pdfiumHostEntry.js', 'host/composeHostEntry.js'];

/**
 * The other writers' modules, which the MuPDF host must not reach — and `documentSign.js`, the signer's KEY half,
 * which it must never reach at all: it parses the certificate, and a host is hostile (ADR-0148).
 */
const OTHER_WRITERS = ['pdfLibWriter.js', 'signpdfWriter.js', 'pdfiumSpecs.js', 'signaturePlaceholder.js', 'documentSign.js'];

/**
 * What the MuPDF host runs of other writers, on demand: pdf-lib's commands (ADR-0121 Decision 3) and the signature's
 * placeholder (ADR-0148). Never at start.
 */
const HOSTED_WRITERS = ['pdfLibWriter.js', 'signaturePlaceholder.js'];

/** The parser the signature's placeholder is written with, which `main`'s signer must not reach (ADR-0148). */
const PDF_LIB = '@cantoo/pdf-lib';

/** The text shaper, which the MuPDF host loads only when an operator edit needs a face (ADR-0177). */
const HARFBUZZ = 'harfbuzzjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 23 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * Every specifier one emitted module names: static imports and re-exports of either kind,
 * bare side-effect imports, and literal dynamic imports.
 *
 * @param {string} file
 * @param {{ dynamic?: boolean }} [options] `dynamic: false` leaves the literal `import()`s out
 * @returns {string[]}
 */
function specifiersOf(file, { dynamic = true } = {}) {
  const source = readFileSync(file, 'utf8');
  return [
    ...[...source.matchAll(/\bfrom\s*'([^']+)'/gu)].map((m) => m[1] ?? ''),
    ...[...source.matchAll(/\bimport\s*'([^']+)'/gu)].map((m) => m[1] ?? ''),
    ...(dynamic ? [...source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/gu)].map((m) => m[1] ?? '') : []),
  ];
}

/**
 * Walks the relative edges from `entry` inside `dist`, recording which modules name which
 * bare specifiers and the trail to every module reached.
 *
 * `dynamic: false` walks what the process loads AT START: a literal `import()` is loaded when
 * that line runs, not when the module is, so it is the one edge a host's fixed cost does not
 * pay (ADR-0121 Decision 3 loads pdf-lib that way).
 *
 * @param {string} dist
 * @param {string} entry
 * @param {{ dynamic?: boolean }} [options]
 */
function walk(dist, entry, options = {}) {
  /** @type {Map<string, string[]>} module -> trail from the entry */
  const reached = new Map([[entry, [entry]]]);
  /** @type {Map<string, string[]>} bare specifier -> modules naming it */
  const bare = new Map();
  const queue = [entry];
  let edges = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const absolute = join(dist, current);
    if (!existsSync(absolute)) continue;
    for (const specifier of specifiersOf(absolute, options)) {
      edges += 1;
      if (!specifier.startsWith('.')) {
        bare.set(specifier, [...(bare.get(specifier) ?? []), current]);
        continue;
      }
      const next = posix.normalize(posix.join(posix.dirname(current), specifier));
      if (reached.has(next)) continue;
      reached.set(next, [...(reached.get(current) ?? []), next]);
      queue.push(next);
    }
  }
  return { reached, bare, edges };
}

try {
  /** @type {ReadonlyArray<readonly [string, string]>} */
  const builtProbes = [
    [KERNEL_DIST, 'host/hostEntry.js'],
    [CONTRACT_DIST, 'host.js'],
  ];
  for (const [dist, probe] of builtProbes) {
    if (!existsSync(join(dist, probe))) {
      throw new Error(
        `${join(dist, probe)} does not exist. This proof reads the EMITTED JavaScript, because ` +
          `the source cannot tell \`import { type X }\` from \`import type { X }\`. Run ` +
          `\`npm run build\` first.`,
      );
    }
  }

  if (process.argv.includes('--list')) {
    for (const host of HOSTS) {
      const { bare } = walk(KERNEL_DIST, host);
      process.stdout.write(`${host}\n  ${(bare.get(CONTRACT_ROOT) ?? []).join('\n  ') || '(none)'}\n`);
    }
    process.exit(0);
  }

  // THE CONTROLS FIRST: each proves the walk can see what the host cases claim is absent.
  const kernelRoot = walk(KERNEL_DIST, 'index.js');
  check(
    `CONTROL: the kernel's own root names ${CONTRACT_ROOT}, so the walk sees a bare root specifier`,
    (kernelRoot.bare.get(CONTRACT_ROOT) ?? []).length > 0,
    `no module reached from packages/kernel/dist/index.js names ${CONTRACT_ROOT}. The kernel's ` +
      `root serves main, which takes the whole contract, so this cannot be a clean result — the ` +
      `matcher or the walk is blind, and every "names no root" below means nothing.`,
  );

  const contractRoot = walk(CONTRACT_DIST, 'index.js');
  check(
    'CONTROL: the contract root reaches channels.js, so the walk sees the renderer map',
    contractRoot.reached.has('channels.js'),
    `packages/contract/dist/index.js does not reach channels.js, which it exports. The walk ` +
      `cannot see the module the next case claims the host entry avoids.`,
  );

  const contractHost = walk(CONTRACT_DIST, 'host.js');
  check(
    `${CONTRACT_ROOT}/host does not reach channels.js or events.js`,
    !contractHost.reached.has('channels.js') && !contractHost.reached.has('events.js'),
    `reachable via ${(contractHost.reached.get('channels.js') ?? contractHost.reached.get('events.js') ?? []).join(' -> ')}. ` +
      `The host entry exists to be the contract WITHOUT the renderer's surfaces: channels.js ` +
      `builds every renderer channel's schemas at load (+14 MB measured 2026-09-19). A module ` +
      `the entry re-exports has started importing one of them — move what it needs down into ` +
      `schemas.ts or commands.ts, which is where ocrLanguageSchema went.`,
  );

  const specTable = walk(KERNEL_DIST, 'commandSpecs.js');
  check(
    'CONTROL: commandSpecs.js reaches pdfLibWriter.js, so the walk sees another writer',
    specTable.reached.has('pdfLibWriter.js'),
    `commandSpecs.js spreads pdf-lib's table and the walk did not find it. It cannot see the ` +
      `module the MuPDF host's case claims to avoid.`,
  );

  for (const host of HOSTS) {
    const graph = walk(KERNEL_DIST, host);
    check(
      `${host}: the walk found import edges`,
      graph.edges > 0 && graph.reached.size > 1,
      `${graph.edges} edges, ${graph.reached.size} modules. An empty graph names nothing, which ` +
        `is this proof's passing answer produced by a broken parse (audit item 4b).`,
    );
    const naming = graph.bare.get(CONTRACT_ROOT) ?? [];
    check(
      `${host}: no module it loads names ${CONTRACT_ROOT} bare`,
      naming.length === 0,
      `named by ${naming.map((module) => (graph.reached.get(module) ?? [module]).join(' -> ')).join('\n        and ')}.\n` +
        `      Take the values from '${CONTRACT_ROOT}/host'. The root builds the renderer's channel ` +
        `map at load and no host serves it; a type-only need is \`import type\`, which is erased — ` +
        `\`import { type X }\` is NOT, it keeps the statement and loads the root.`,
    );
  }

  // AT START, the MuPDF host loads no other writer; over its whole life it loads pdf-lib alone,
  // because ADR-0121 Decision 3 runs pdf-lib's commands beside the session they rewrite.
  const mupdfAtStart = walk(KERNEL_DIST, 'host/hostEntry.js', { dynamic: false });
  const mupdfEver = walk(KERNEL_DIST, 'host/hostEntry.js');
  for (const writer of OTHER_WRITERS) {
    const hosted = HOSTED_WRITERS.includes(writer);
    const ever = hosted ? mupdfAtStart : mupdfEver;
    check(
      `host/hostEntry.js does not reach ${writer}${hosted ? ' at start' : ''}`,
      !ever.reached.has(writer),
      `reachable via ${(ever.reached.get(writer) ?? []).join(' -> ')}.\n` +
        `      The MuPDF host executes MuPDF's commands and, since ADR-0121 Decision 3, pdf-lib's — ` +
        `loaded on the first one, by a literal import(). A route to another writer's table, or a ` +
        `static one to pdf-lib's, loads a library into every contained process whether it is called ` +
        `or not. Take MuPDF's execution from mupdfSpecs.js, as the PDFium host takes pdfiumSpecs.js.`,
    );
  }
  // CONTROL for each start-only case above: the whole-life walk DOES reach the hosted module, so
  // "not at start" is the dynamic edge being excluded, not a walk that cannot see the module.
  for (const writer of HOSTED_WRITERS) {
    check(
      `CONTROL: host/hostEntry.js reaches ${writer} through its dynamic import`,
      mupdfEver.reached.has(writer),
      `the whole-life walk does not reach ${writer}, so the start-only case proves nothing.`,
    );
  }

  // HARFBUZZ ON FIRST NEED (ADR-0177): the operator edit's face writer is a literal import(), so the MuPDF host's
  // fixed cost does not carry the shaper (+6.4 MB at import, measured 2026-10-06) for documents that never need a face.
  const shaperAtStart = mupdfAtStart.bare.get(HARFBUZZ) ?? [];
  check(
    `host/hostEntry.js does not load ${HARFBUZZ} at start`,
    shaperAtStart.length === 0,
    `named by ${shaperAtStart.map((module) => (mupdfAtStart.reached.get(module) ?? [module]).join(' -> ')).join('\n        and ')}.\n` +
      `      The face writer (operatorFaces.js) is loaded by textOperatorEdit.js only when an edit needs a face; a ` +
      `static import of it, or of a module that shapes text, puts HarfBuzz into every MuPDF host at start.`,
  );
  // CONTROL: over its whole life the host DOES reach the shaper, through that import(), so "not at start" is the
  // dynamic edge being excluded, not a walk that cannot see the specifier.
  check(
    `CONTROL: host/hostEntry.js reaches ${HARFBUZZ} through the face writer's dynamic import`,
    (mupdfEver.bare.get(HARFBUZZ) ?? []).length > 0,
    `the whole-life walk names no ${HARFBUZZ}, so the start-only case above proves nothing.`,
  );

  // PDF-LIB ON FIRST NEED, BY ITS NAME AND NOT BY A MODULE'S (ADR-0121 Decision 3): the cases above name pdfLibWriter.js
  // and the placeholder, and a route that reaches the library through any OTHER module passed them. `host/hostRefusals.ts`
  // took `FieldEditRefusedError` from `formFieldEdit.ts`, which imports pdf-lib at load: +17.7 MB in every MuPDF host
  // (fresh Node process, forced collection, 2026-10-08), the growth that put the host at 100 MB against a 100 MB base.
  const pdfLibAtStart = mupdfAtStart.bare.get(PDF_LIB) ?? [];
  check(
    `host/hostEntry.js does not load ${PDF_LIB} at start`,
    pdfLibAtStart.length === 0,
    `named by ${pdfLibAtStart.map((module) => (mupdfAtStart.reached.get(module) ?? [module]).join(' -> ')).join('\n        and ')}.\n` +
      `      pdf-lib is loaded by pdfLibWriter.js on the first pdf-lib command, through a literal import(). A static route ` +
      `to any module that imports it — a refusal class, a type that became a value — puts the library into every MuPDF ` +
      `host at start. Keep what the host's pipe names (classes, tables) in modules that import no library.`,
  );
  // CONTROL: over its whole life the host DOES reach pdf-lib, through that import(), so "not at start" is the dynamic
  // edge being excluded, not a walk that cannot see the specifier.
  check(
    `CONTROL: host/hostEntry.js reaches ${PDF_LIB} through the pdf-lib writer's dynamic import`,
    (mupdfEver.bare.get(PDF_LIB) ?? []).length > 0,
    `the whole-life walk names no ${PDF_LIB}, so the start-only case above proves nothing.`,
  );

  // `main`'s SIGNER PARSES NOTHING (ADR-0148): the module that holds the key half reaches neither the placeholder
  // writer nor the parser it is written with, over its whole life, so a signing in `main` cannot load the document.
  const signer = walk(KERNEL_DIST, 'documentSign.js');
  const signerParses = signer.reached.has('signaturePlaceholder.js') || (signer.bare.get(PDF_LIB) ?? []).length > 0;
  check(
    `documentSign.js, main's signer, reaches neither signaturePlaceholder.js nor ${PDF_LIB}`,
    signer.edges > 0 && !signerParses,
    `${String(signer.edges)} edges; ${PDF_LIB} named by ${(signer.bare.get(PDF_LIB) ?? []).join(', ') || 'nothing'}; ` +
      `placeholder reachable via ${(signer.reached.get('signaturePlaceholder.js') ?? []).join(' -> ') || 'nothing'}.\n` +
      `      Writing the placeholder parses the whole document, and that runs in the MuPDF host beside the session; ` +
      `main signs over four numbers it checked against the hole.`,
  );
  // CONTROL: the placeholder writer DOES name the parser, so the case above can see the specifier it claims absent.
  const placeholder = walk(KERNEL_DIST, 'signaturePlaceholder.js');
  check(
    `CONTROL: signaturePlaceholder.js names ${PDF_LIB}, so the walk sees the parser`,
    (placeholder.bare.get(PDF_LIB) ?? []).length > 0,
    `no module reached from signaturePlaceholder.js names ${PDF_LIB}; the case above cannot be trusted.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} host-load failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('host-load case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
