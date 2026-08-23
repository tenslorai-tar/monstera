// @ts-check
/**
 * Every entry point CI enters guards its main body through {@link isMain}, or
 * not at all (finding AAAA-5).
 *
 * ## The defect, and why nothing could see it
 *
 * `electronBinaryCallers.mjs` compared `import.meta.url` against a hand-built
 * `file://` string. On Windows those never match, so its main guard never fired
 * and the first run exited 0 having scanned nothing.
 *
 * **Nothing in the pipeline could have caught that.** `annotate.mjs` re-emits
 * output only on failure, so a silent exit 0 is a green step;
 * `check:proofcoverage` proves a proof is INVOKED rather than that it ran; and
 * the scan's own proof called `report()` directly, so the CLI path — the one CI
 * actually enters — was exercised by no case. It was found because the run
 * printed nothing at all, which is luck: the same defect in a scan whose normal
 * output is one quiet line would still be green.
 *
 * ## The rule, and what it deliberately permits
 *
 * A file may run its body unconditionally — every proof here does. What it may
 * not do is *guard* the body with a hand-written comparison, because that is the
 * expression with a platform-dependent wrong answer. So: any file in the roster
 * naming `import.meta.url` must reach it through `isMain`.
 *
 * ## The roster is DERIVED
 *
 * From {@link wrappableEntryPoints}, which already owns "which script paths do
 * this repository's npm scripts invoke with node" and is what the workflows
 * enter. A hand-kept list of files-needing-a-guard would be the second wiring
 * place, and it would be one short on the day it mattered.
 *
 * This check does not prove a module wired a guard at all — only a process that
 * runs it can show that, which is why each scan also carries a case spawning it
 * against a fixture that would pass if its guard were absent.
 *
 * Usage: node scripts/lib/mainGuards.mjs [--root <dir>]
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { wrappableEntryPoints } from './annotateCoverage.mjs';
import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/**
 * A COMPARISON of the entry-point URL, which is the only shape at issue.
 *
 * Not any mention. `fileURLToPath(import.meta.url)` to locate a module's own
 * directory is an unrelated and correct use, and the first version of this scan
 * matched it — reporting 38 files, nearly all of them fine. That was this
 * instrument failing its own resolution test before it measured anything (audit
 * item 4a), and it is the shape the escape guard's false positives warn about: a
 * scan that cries wolf is a scan someone turns off.
 */
const COMPARES_META_URL = /import\.meta\.url\s*===|===\s*import\.meta\.url/u;

/** Reaching it through the one resolver. */
const VIA_IS_MAIN = /isMain\s*\(\s*import\.meta\.url\s*\)/u;

/**
 * @param {{ root?: string }} [options]
 * @returns {{ entryPoints: string[], guarded: string[], handRolled: string[] }}
 */
export function scanMainGuards(options = {}) {
  const root = options.root ?? repoRoot();
  const { paths } = wrappableEntryPoints(root);
  if (paths.length === 0) {
    throw new Error('Derived no entry points. An empty roster is a broken parse, not a clean tree.');
  }

  /** @type {string[]} */
  const guarded = [];
  /** @type {string[]} */
  const handRolled = [];
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      // A manifest naming a path that does not exist is a different check's
      // business (`check:docs` resolves every scripts/ path), and swallowing it
      // here would let this scan report a clean tree for a repository it could
      // not read.
      continue;
    }
    // This module names both patterns in its own prose and its own code.
    if (path === 'scripts/lib/mainGuards.mjs') continue;
    if (VIA_IS_MAIN.test(text)) guarded.push(path);
    else if (COMPARES_META_URL.test(text)) handRolled.push(path);
  }
  return { entryPoints: paths, guarded, handRolled };
}

/**
 * @param {{ root?: string, control?: string }} [options]
 * @returns {{ ok: boolean, output: string }}
 */
export function report(options = {}) {
  // A file this scan is KNOWN to be able to find guarding itself correctly. If
  // the roster, the read or the pattern breaks, this goes red instead of the
  // violation count quietly reaching zero.
  const control = options.control ?? 'scripts/lib/emittedTemplates.mjs';
  const { entryPoints, guarded, handRolled } = scanMainGuards(options);

  let output = '';
  for (const path of handRolled) {
    output +=
      `  FAILED  ${path} compares import.meta.url without isMain()\n` +
      `          A hand-built \`file://\` string never equals import.meta.url on Windows, so the\n` +
      `          guard does not fire and the script exits 0 having done nothing — which every\n` +
      `          check in this repository reads as a pass.\n`;
  }
  if (handRolled.length === 0) {
    output +=
      `  ok  ${String(guarded.length)} of ${String(entryPoints.length)} entry point(s) guard main ` +
      `through isMain(); the rest run unconditionally\n`;
  }
  output += guarded.includes(control)
    ? `  ok  and the scan located ${control}, so that result means something\n`
    : `  FAILED  the scan did not locate ${control}, which is known to guard main correctly.\n` +
      `          A roster that reads nothing reports every file as compliant.\n`;

  return { ok: handRolled.length === 0 && guarded.includes(control), output };
}

if (isMain(import.meta.url)) {
  const rootIndex = process.argv.indexOf('--root');
  const result = report(rootIndex === -1 ? {} : { root: resolve(process.argv[rootIndex + 1] ?? '.') });
  process.stdout.write(result.output);
  process.exitCode = result.ok ? 0 : 1;
}
