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

/** The other writers' spec tables, which the MuPDF host must not reach. */
const OTHER_WRITERS = ['pdfLibWriter.js', 'signpdfWriter.js', 'pdfiumSpecs.js'];

/** The one other writer the MuPDF host runs, on demand (ADR-0121 Decision 3). */
const HOSTED_WRITER = 'pdfLibWriter.js';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 14 });

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
    const ever = writer === HOSTED_WRITER ? mupdfAtStart : mupdfEver;
    check(
      `host/hostEntry.js does not reach ${writer}${writer === HOSTED_WRITER ? ' at start' : ''}`,
      !ever.reached.has(writer),
      `reachable via ${(ever.reached.get(writer) ?? []).join(' -> ')}.\n` +
        `      The MuPDF host executes MuPDF's commands and, since ADR-0121 Decision 3, pdf-lib's — ` +
        `loaded on the first one, by a literal import(). A route to another writer's table, or a ` +
        `static one to pdf-lib's, loads a library into every contained process whether it is called ` +
        `or not. Take MuPDF's execution from mupdfSpecs.js, as the PDFium host takes pdfiumSpecs.js.`,
    );
  }
  // CONTROL for the start-only case above: the whole-life walk DOES reach pdf-lib's writer, so
  // "not at start" is the dynamic edge being excluded, not a walk that cannot see the module.
  check(
    `CONTROL: host/hostEntry.js reaches ${HOSTED_WRITER} through its dynamic import`,
    mupdfEver.reached.has(HOSTED_WRITER),
    `the whole-life walk does not reach ${HOSTED_WRITER}, so the start-only case proves nothing.`,
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
