/**
 * WHICH PROCESS LOADS MUPDF — observed from a run, not read off the imports.
 *
 * Invariant 25 contains the engine host because a document parser is where a
 * hostile file meets us. Invariant 20 keeps native code out of `main`. Both are
 * about *where the parse happens*, and neither can be settled by reading the
 * module graph: `packages/kernel/src/index.ts` is written to keep the engine
 * out of its importers — `export type` rather than `export {}`, deliberately,
 * with ADR-0026 behind it — and whether that holds today is a fact about a
 * running process, not about the intent in the barrel's comments.
 *
 * **And WASM is the gap.** Invariant 20's letter names native code. The engine
 * every `packages/kernel` module imports is the npm package's **WASM** build,
 * so a rule that says *no native code in main* does not, by its letter, refuse
 * it — which is the shape that let content generation through in Stage 2.
 *
 * ## The instrument
 *
 * One child process per subject, because an engine instantiates once per world
 * and a second subject in the same process would read the first one's answer.
 * Each child reports two independent observables (see `engineReachProbe.mjs`).
 *
 * ## Its controls, and why it refuses rather than reports without them
 *
 * The reassuring answer here is **"main does not load the engine"**, and every
 * way this instrument can break produces it: a loader hook that never
 * registered, a `WebAssembly` patch installed after the fact, a specifier that
 * failed to resolve, a `dist/` that was never built. So two subjects are
 * controls rather than measurements:
 *
 * - `engine` imports `mupdf` itself and **must** report both observables true.
 *   That is 4b: the instrument locates something known present, on every run.
 * - `inert` imports `@monstera/shared`, which depends on nothing, and **must**
 *   report both false. That is 4a: two inputs differing by the smallest amount
 *   that changes the verdict, reported as different.
 *
 * A control that disagrees with its expectation makes the whole run
 * UNVERIFIABLE and prints no verdict about the subjects, because an instrument
 * that cannot separate its own two controls has not measured anything.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const probe = join(here, 'engineReachProbe.mjs');

/**
 * @typedef {object} Subject
 * @property {string} name
 * @property {string} specifier
 * @property {string} asks
 * @property {boolean | null} expected `null` where the answer is the finding.
 */

/**
 * One probe's report. Declared rather than left as an index signature, so a
 * field this file reads that the probe stopped printing is a type error here
 * instead of an `undefined` that formats as the word "undefined" in a column.
 *
 * @typedef {object} Reading
 * @property {number} modulesLoaded
 * @property {string[]} engineModules
 * @property {boolean} graphReachedEngine
 * @property {number[]} wasmInstantiations
 * @property {boolean} instantiatedEngine
 * @property {number} rssDeltaMb
 * @property {string} threw
 */

const hostEntry = join(repoRoot, 'packages', 'kernel', 'dist', 'host', 'hostEntry.js');
const kernelDist = join(repoRoot, 'packages', 'kernel', 'dist', 'index.js');

/** @type {Subject[]} */
const SUBJECTS = [
  {
    name: 'engine',
    specifier: 'mupdf',
    asks: 'CONTROL: can this instrument see an engine that is certainly there?',
    expected: true,
  },
  {
    name: 'inert',
    specifier: '@monstera/shared',
    asks: 'CONTROL: does it report a package with no engine as having none?',
    expected: false,
  },
  {
    name: 'main',
    specifier: pathToFileURL(kernelDist).href,
    asks: "SUBJECT: the specifier apps/desktop imports — '@monstera/kernel'.",
    expected: null,
  },
  {
    name: 'host',
    specifier: pathToFileURL(hostEntry).href,
    asks: 'SUBJECT: the contained hostentry point the factory starts.',
    expected: null,
  },
];

/**
 * @param {Subject} subject
 * @returns {Promise<Reading>}
 */
async function run(subject) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [probe], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      // NOT argv. `hostEntry.js` reads `argv[2]` as its pipe name, so a subject
      // named on the command line is a subject the harness has spoken to.
      env: { ...process.env, MONSTERA_REACH_SUBJECT: subject.specifier },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (err += String(chunk)));
    child.on('error', fail);
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      if (line === '') {
        fail(
          new Error(
            'the probe printed nothing for ' +
              subject.name +
              ' (exit ' +
              String(code) +
              '). stderr: ' +
              err.slice(0, 400),
          ),
        );
        return;
      }
      settle(/** @type {Reading} */ (JSON.parse(line)));
    });
  });
}

for (const path of [kernelDist, hostEntry]) {
  if (!existsSync(path)) {
    throw new Error(
      'BUILD FIRST. ' +
        path +
        ' does not exist, and a subject that cannot be imported reports "no engine" — ' +
        'which is the answer this instrument exists to be suspicious of.',
    );
  }
}

console.log('# WHICH PROCESS LOADS MUPDF');
console.log('# ' + new Date().toISOString().slice(0, 10) + ', node ' + process.version);
console.log('');

/** @type {{ subject: Subject; reading: Reading }[]} */
const readings = [];
for (const subject of SUBJECTS) {
  readings.push({ subject, reading: await run(subject) });
}

console.log('  subject   graph-reached-engine   wasm-instantiated   modules   rss delta');
console.log('  -------   --------------------   -----------------   -------   ---------');
for (const { subject, reading } of readings) {
  console.log(
    '  ' +
      subject.name.padEnd(9) +
      String(reading.graphReachedEngine).padEnd(22) +
      String(reading.instantiatedEngine).padEnd(20) +
      String(reading.modulesLoaded).padEnd(10) +
      String(reading.rssDeltaMb) +
      ' MB',
  );
}

console.log('');
for (const { subject, reading } of readings) {
  console.log('  ' + subject.name + ': ' + subject.asks);
  console.log('    engine modules loaded: ' + JSON.stringify(reading.engineModules));
  console.log('    WebAssembly.instantiate sizes: ' + JSON.stringify(reading.wasmInstantiations));
  if (reading.threw !== '') console.log('    the module body threw: ' + String(reading.threw));
  console.log('');
}

const broken = readings.filter(
  ({ subject, reading }) =>
    subject.expected !== null &&
    (reading.graphReachedEngine !== subject.expected ||
      reading.instantiatedEngine !== subject.expected),
);

if (broken.length > 0) {
  console.log('UNVERIFIABLE. A control did not answer as it must:');
  for (const { subject, reading } of broken) {
    console.log(
      '  ' +
        subject.name +
        ' expected ' +
        String(subject.expected) +
        ', read graph=' +
        String(reading.graphReachedEngine) +
        ' wasm=' +
        String(reading.instantiatedEngine),
    );
  }
  console.log('No verdict about the subjects is printed: this instrument has not separated');
  console.log('its own two controls, so it cannot separate anything.');
  process.exitCode = 1;
} else {
  console.log('Both controls separated: an engine that is there reads true, one that is not');
  console.log('reads false. The subject rows above are therefore readings.');
  for (const { subject, reading } of readings) {
    if (subject.expected !== null) continue;
    const graph = reading.graphReachedEngine;
    const wasm = reading.instantiatedEngine;
    if (graph !== wasm) {
      console.log(
        '  ' +
          subject.name +
          ': THE TWO OBSERVABLES DISAGREE (graph=' +
          String(graph) +
          ', wasm=' +
          String(wasm) +
          '). That is the finding, not a reading.',
      );
      continue;
    }
    console.log(
      '  ' +
        subject.name +
        ': ' +
        (graph
          ? 'LOADS THE ENGINE. A document parsed by this process is parsed here.'
          : 'does not load the engine.'),
    );
  }
}
