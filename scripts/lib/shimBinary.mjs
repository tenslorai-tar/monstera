// @ts-check
/**
 * The shim DLL, and a refusal to measure a stale one.
 *
 * Every script that loads `monstera_mupdf.dll` is answering a question about the
 * CODE, not about a file. When the two disagree the script still runs, still
 * prints numbers, and prints them with exactly the confidence it would have had
 * if the build had happened — which is why the failure is worth a mechanism
 * rather than a habit.
 *
 * It is not hypothetical. Batch 4 rebuilt the shim four times, and the ADR-0010
 * reproduction quoted in its journal entry was measured after finding 37 and
 * before findings 10 and 25. The numbers were byte-identical to the previous
 * run — 155,548,924 bytes and 1,547 blocks — which was the correct result,
 * because none of those changes touch that workload. But **byte-identical is
 * also exactly what a stale DLL looks like**, and nothing in the run could tell
 * the two apart. The owner asked which it was; answering needed a separate
 * script written after the fact.
 *
 * So the build records what it was built FROM, and loading asserts it still
 * matches. This is scripts/lib/verdict.mjs applied to a native artefact: the
 * measurement's truth rests on the DLL, the DLL's truth rests on the source, and
 * the dependency is now declared instead of assumed.
 *
 * Timestamps were rejected as the mechanism. `mtime` says a file was written,
 * not what it was written from: a checkout, a restored cache, or a copy between
 * machines reorders them freely, and a build that fails after touching the
 * output leaves a newer-but-wrong DLL. The source's bytes are the thing that
 * must match.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { digestInputs } from './verdict.mjs';

/** Everything the compiled DLL is a function of, relative to the repository. */
const SHIM_SOURCES = [
  'native/mupdf-shim/monstera_mupdf.c',
  'native/mupdf-shim/monstera_mupdf.vcxproj',
];

/** @param {string} [root] @returns {string} */
export function shimPath(root = repoRoot()) {
  return join(root, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
}

/** @param {string} [root] @returns {string} */
function manifestPath(root = repoRoot()) {
  return join(root, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.build.json');
}

/**
 * The inputs the DLL is built from, declared for scripts/lib/verdict.mjs.
 *
 * @param {string} root
 * @returns {import('./verdict.mjs').Input[]}
 */
function sourceInputs(root) {
  return SHIM_SOURCES.map((path) => ({ file: join(root, path), why: 'compiled into the DLL' }));
}

/**
 * Records what the DLL was built from. Called by the provisioner after a build
 * that linked and passed its export check.
 *
 * @param {{ root?: string, version: string }} options
 * @returns {void}
 */
export function recordShimBuild({ root = repoRoot(), version }) {
  const resolved = digestInputs(sourceInputs(root), { root });
  writeFileSync(
    manifestPath(root),
    `${JSON.stringify(
      { sources: resolved.digest, inputs: resolved.inputs, mupdf: version },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ current: boolean, reason: string }}
 */
export function shimBuildState(options = {}) {
  const root = options.root ?? repoRoot();

  if (!existsSync(shimPath(root))) {
    return {
      current: false,
      reason: `no DLL at ${shimPath(root)}. Run: node scripts/provision/mupdf.mjs`,
    };
  }

  const manifest = manifestPath(root);
  if (!existsSync(manifest)) {
    return {
      current: false,
      reason:
        `${manifest} is missing, so what the DLL was built from is unknown. A DLL that cannot ` +
        `say what it came from cannot be measured against the source. Rebuild: ` +
        `node scripts/provision/mupdf.mjs --skip-mupdf`,
    };
  }

  /** @type {{ sources?: string, inputs?: Array<{ name: string, digest: string }> }} */
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (error) {
    return { current: false, reason: `${manifest} is unreadable: ${String(error)}` };
  }

  const resolved = digestInputs(sourceInputs(root), { root });
  if (recorded.sources === resolved.digest) return { current: true, reason: 'built from this source' };

  const before = new Map((recorded.inputs ?? []).map((entry) => [entry.name, entry.digest]));
  const moved = resolved.inputs
    .filter((entry) => before.get(entry.name) !== entry.digest)
    .map((entry) => entry.name);

  return {
    current: false,
    reason:
      `the DLL was built from different source than is on disk now.\n  Changed: ` +
      `${moved.join(', ') || '(the recorded set itself differs)'}\n  ` +
      `Rebuild before measuring: node scripts/provision/mupdf.mjs --skip-mupdf`,
  };
}

/**
 * Throws unless the DLL was built from the source currently on disk.
 *
 * Refusing is the only honest option. A measurement taken through a stale DLL is
 * not a weaker result, it is a result about different code, and it arrives
 * looking exactly like the right answer.
 *
 * @param {{ root?: string }} [options]
 * @returns {string} The DLL path, once it is safe to load.
 */
export function requireCurrentShim(options = {}) {
  const root = options.root ?? repoRoot();
  const state = shimBuildState({ root });
  if (!state.current) {
    throw new Error(
      `Refusing to load the shim: ${state.reason}\n\n` +
        `Measuring through a stale DLL produces numbers that are indistinguishable from the ` +
        `right ones — which is how "the result reproduced exactly" can mean "the result was ` +
        `never recomputed".`,
    );
  }
  return shimPath(root);
}
