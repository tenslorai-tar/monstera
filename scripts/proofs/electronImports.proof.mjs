// @ts-check
/**
 * Proves that no plain-Node code in this repository can trigger Electron's lazy
 * download, and that an unpinned runtime arriving by any other route is
 * detectable.
 *
 * ## Two mechanisms, and the proof has to cover the SEAM
 *
 * `no-restricted-imports` owns the four static shapes; `scriptsLoadingAtRuntime`
 * owns `import()` and the `require` family. Neither is a second opinion about
 * the other — measured against ESLint 10.8.1, `ImportExpression` appears zero
 * times in `no-restricted-imports.js`, and its visitor object holds no
 * `CallExpression`. B3a: the authority answers what it defines, and the residue
 * is implemented once, here.
 *
 * A split rule needs its seam proven, not just its halves. So the lint half is
 * exercised by linting a real probe file, and the walk half by a fixture root
 * carrying each shape — because a rule that covers everything except the shape
 * nobody tested reads exactly like a rule that covers everything.
 *
 * ## Why this is a separate file from `provision/electron.proof.mjs`
 *
 * **Split by what a case NEEDS, not by what it is about.** The eight cases
 * there read tracked files and nothing else, so they run in the Guards job,
 * which performs no `npm ci`. Every case here needs `node_modules` — the
 * TypeScript compiler, or ESLint itself. They shipped inside the Guards-run
 * file once and turned both platforms red, skipping nineteen later steps
 * including the full-history secret scan.
 *
 * ## Which cases are load-bearing
 *
 * The CONTROLS, and there is one for every reassuring answer available here. A
 * scan, a lint run and a filesystem probe each have a single output for every
 * way they can break — "found nothing", "no error", "not present" — and all
 * three are the answer this file hopes for.
 *
 * The negative control is not decoration either: this repository's proofs pass
 * `'electron'` as an ordinary string argument in several places, so a
 * callee-blind walk would flag the files enforcing the rule.
 *
 * Usage: node scripts/proofs/electronImports.proof.mjs
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { ELECTRON_SPECIFIERS } from '../../eslint.config.js';
import { createRoster } from '../lib/passRoster.mjs';
import { PLAIN_NODE_EXTENSIONS } from '../lib/plainNodeScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { scriptsLoadingAtRuntime, unpinnedRuntimeExists } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Ignored by `.gitignore`, so a run killed before cleanup cannot redden a later
 * `eslint .` or reach a commit. It must live UNDER `scripts/` to match the
 * config block being tested — `.probe/` would match no rule at all, which is
 * the failure this case exists to detect.
 */
const PROBE = join(REPO_ROOT, 'scripts', '__import_probe__.mjs');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * `ignore: false` so the proof sees a file `.gitignore` hides from `eslint .`.
 *
 * @param {string} source
 * @returns {Promise<string[]>} rule ids reported
 */
async function lintProbe(source) {
  await writeFile(PROBE, source, 'utf8');
  const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false, warnIgnored: false });
  const [result] = await eslint.lintFiles([PROBE]);
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'fatal');
}

try {
  // ---------------------------------------------------------------------------
  // THE STATIC HALF — ESLint's. The rule is registered against `scripts/`, and
  // the only way to know a lint rule holds is to violate it and watch it go red:
  // a config block whose glob matches no files lints perfectly clean while
  // permitting every import it claims to forbid.
  // ---------------------------------------------------------------------------
  try {
    check(
      'a static `import` of electron under scripts/ is REFUSED by lint',
      (await lintProbe("import { app } from 'electron';\nexport default app;\n")).includes(
        'no-restricted-imports',
      ),
      `eslint reported no no-restricted-imports violation for a file importing electron at ` +
        `${PROBE}. Either the plain-Node config block's glob stopped matching, or the rule ` +
        `stopped being registered on it — both of which leave \`eslint .\` green.`,
    );

    check(
      'CONTROL: a permitted import under scripts/ lints clean',
      (await lintProbe("import { join } from 'node:path';\nexport default join;\n")).length === 0,
      `the probe file reports a violation even when it imports nothing restricted, so the case ` +
        `above is satisfied by a probe that cannot lint clean for ANY content — a parse error, ` +
        `a stray rule. Without this, "the rule fires" and "everything fires" are the same ` +
        `observation (item 4's fixture rule).`,
    );

    check(
      'the subpath form is refused too, not just the bare specifier',
      (await lintProbe("import { app } from 'electron/main';\nexport default app;\n")).includes(
        'no-restricted-imports',
      ),
      `\`electron/main\` linted clean, so the rule stops at the bare specifier while every ` +
        `real Electron import names a subpath. Restricted list, read from eslint.config.js ` +
        `rather than restated: ${ELECTRON_SPECIFIERS.join(', ')}.\n      ` +
        `This case asserts a PROPERTY, not the list's second entry. Measured: under ` +
        `patterns.group ESLint matches gitignore-style, so 'electron' alone already covers ` +
        `'electron/main' — the first version of this case claimed otherwise and survived the ` +
        `mutation that narrowed the list to one element, while its neighbours would have ` +
        `fallen. A case whose only variable changes nothing separates nothing.`,
    );
  } finally {
    await rm(PROBE, { force: true });
  }

  // ---------------------------------------------------------------------------
  // THE RUNTIME HALF — the residue ESLint does not claim.
  // ---------------------------------------------------------------------------
  const nodeSide = await scriptsLoadingAtRuntime('electron', REPO_ROOT);
  check(
    'no plain-Node file loads `electron` at runtime',
    nodeSide.matched.length === 0,
    `${nodeSide.matched.join(', ')} reach(es) electron through import() or require(). That resolves to ` +
      `index.js, whose module.exports IS getElectronPath() — so it downloads an unpinned ` +
      `binary through install.js, which reads electron_use_remote_checksums. Spawn ` +
      `electronBinaryPath() instead. apps/desktop/src/ is out of scope: it runs inside the ` +
      `Electron runtime, where the specifier is the API surface.`,
  );

  check(
    'CONTROL: the walk finds a real runtime load in the REAL tree',
    (await scriptsLoadingAtRuntime('node:fs/promises', REPO_ROOT)).matched.length > 0,
    `the walk reported no plain-Node file loading "node:fs/promises" at runtime, which ` +
      `provision/mupdf.mjs and two proofs do with \`await import(…)\`. This anchor is a ` +
      `CallExpression on purpose: the previous control used node:path, a STATIC import, which ` +
      `the narrowed walk no longer looks at — a control has to exercise the node type the ` +
      `check depends on, or it proves the compiler loaded and nothing more (item 4b).`,
  );

  // Every computed specifier in the real tree, named and justified. The one
  // sanctioned suppression channel for this scan, and it is a tracked list in
  // the proof rather than a flag on the scan — the same shape .gitleaks.toml's
  // [allowlist] has, and for the same reason: a suppression that never appears
  // in a diff is a suppression nobody reviews.
  const ACCOUNTED_COMPUTED = new Map([
    [
      'scripts/lib/loadTypeScript.mjs',
      'loads the TypeScript compiler by absolute path through a file:// URL. It cannot be a ' +
        'literal — the path is resolved at run time and needs Windows backslash conversion — ' +
        'and it is the module this very scan loads its compiler with.',
    ],
    [
      'scripts/proofs/nativeAddon.proof.mjs',
      'require.resolve of `@koromix/koffi-${platform}-${arch}/package.json` — the specifier ' +
        'names the running platform, so it cannot be a literal. Found by this case on its ' +
        'first run: the site became visible only once require.resolve and createRequire ' +
        'aliases were covered, which is what a widened check is supposed to do.',
    ],
  ]);
  const unaccounted = nodeSide.unreadable.filter(
    (site) => !ACCOUNTED_COMPUTED.has(site.slice(0, site.lastIndexOf(':'))),
  );
  check(
    'every computed specifier in the real tree is individually accounted for',
    unaccounted.length === 0,
    `${unaccounted.join(', ')} load(s) a module through a specifier this scan cannot read, and ` +
      `is not in ACCOUNTED_COMPUTED. A computed specifier is not a violation — it is a site ` +
      `where the rule cannot answer, so someone has to. Read it, and either add it with a ` +
      `reason or make the specifier a literal. Currently accounted: ` +
      `${[...ACCOUNTED_COMPUTED.keys()].join(', ')}.`,
  );

  const fixture = await mkdtemp(join(tmpdir(), 'monstera-loadshapes-'));
  try {
    const shapes = join(fixture, 'scripts', 'shapes');
    await mkdir(shapes, { recursive: true });
    await Promise.all([
      writeFile(join(shapes, 'dynamic.mjs'), "export const a = await import('target');\n", 'utf8'),
      writeFile(
        join(shapes, 'immediate.mjs'),
        "import { createRequire } from 'node:module';\n" +
          "export const b = createRequire(import.meta.url)('target');\n",
        'utf8',
      ),
      writeFile(
        join(shapes, 'aliased.mjs'),
        "import { createRequire } from 'node:module';\n" +
          'const load = createRequire(import.meta.url);\n' +
          "export function c() { return load('target'); }\n",
        'utf8',
      ),
      writeFile(
        join(shapes, 'nested.cjs'),
        "function d() { if (globalThis.x) { return require('target'); } return null; }\n" +
          'module.exports = d;\n',
        'utf8',
      ),
      // Backticks. `isStringLiteral` rejects a NoSubstitutionTemplateLiteral, so
      // this read as "no specifier here" — and the form is in use in this
      // repository, at loadTypeScript.mjs:47, inside the module this scan loads
      // the compiler with.
      writeFile(
        join(shapes, 'backtick.mjs'),
        'import { createRequire } from \'node:module\';\nconst r = createRequire(import.meta.url);\nexport const e = r(`target`);\n',
        'utf8',
      ),
    ]);

    const detected = await scriptsLoadingAtRuntime('target', fixture);
    check(
      'the five READABLE load shapes: import(), createRequire()(), an alias, nested, backtick',
      detected.matched.length === 5,
      `detected ${detected.matched.length} of 5: ${detected.matched.join(', ') || 'none'}. The ` +
        `name lists what is covered rather than saying "every shape": this case cannot know ` +
        `about a shape nobody has thought of, and "every" is the word that stops the next ` +
        `person adding the sixth. \`nested.cjs\` carries two properties at once — a call inside ` +
        `a function body, which a statements-only visit misses, and a .cjs extension, which ` +
        `the walk globbed past while it looked for .mjs alone.`,
    );

    check(
      'CONTROL: no readable shape was miscounted as unreadable',
      detected.unreadable.length === 0,
      `${detected.unreadable.join(', ')} was reported as an unreadable specifier in a fixture ` +
        `where every argument is a literal. Without this, the count above can be satisfied ` +
        `while shapes quietly migrate into the third state — and the third state is the one ` +
        `nobody reads.`,
    );

    await writeFile(
      join(shapes, 'innocent.mjs'),
      "export function e(check) { return check('target', { root: 'target' }); }\n",
      'utf8',
    );
    const afterInnocent = await scriptsLoadingAtRuntime('target', fixture);
    check(
      'CONTROL: the specifier as an ordinary argument is NOT flagged',
      afterInnocent.matched.length === 5,
      `adding a file that merely PASSES "target" to an unrelated function took the count from ` +
        `5 to ${afterInnocent.matched.length}. A callee-blind walk flags this repository's own proofs, ` +
        `which pass 'electron' as an argument in several places — and a scan that cries wolf ` +
        `gets relaxed until it flags nothing. That is item 4b's window axis arriving as a ` +
        `FALSE POSITIVE, which is the more dangerous direction because the fix feels like ` +
        `tuning.`,
    );

    await writeFile(
      join(shapes, 'computed.mjs'),
      'export async function g(name) { return import(name); }\n',
      'utf8',
    );
    const afterComputed = await scriptsLoadingAtRuntime('target', fixture);
    check(
      'a COMPUTED specifier is reported as unreadable, not counted as absent',
      afterComputed.unreadable.length === 1 &&
        afterComputed.unreadable[0]?.endsWith('computed.mjs:1') === true &&
        afterComputed.matched.length === 5,
      `unreadable: [${afterComputed.unreadable.join(', ')}], matched: ` +
        `${afterComputed.matched.length}. \`import(name)\` cannot be resolved by a parse, and ` +
        `returning false for it merges "looked and it was something else" with "could not ` +
        `look" — the distinction this entire file exists to keep. The line number is asserted ` +
        `because a report nobody can act on is the same as no report.`,
    );

    await writeFile(join(shapes, 'mystery.mts'), 'export const f = 1;\n', 'utf8');
    check(
      'an unrecognised extension is REFUSED, not skipped',
      await (async () => {
        try {
          await scriptsLoadingAtRuntime('target', fixture);
          return false;
        } catch (error) {
          return error instanceof Error && error.message.includes('does not classify');
        }
      })(),
      `a .mts file under scripts/ was silently skipped. Skipping is how both mechanisms came ` +
        `to glob .mjs alone — invisible to the walk AND to ESLint, each reporting the ` +
        `reassuring answer with no way to say it had not looked. Recognised extensions are ` +
        `${PLAIN_NODE_EXTENSIONS.join(', ')}.`,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // Prevention above, detection here, neither substituting for the other: the
  // two rules cover the routes this repository controls, this covers the rest —
  // a contributor's plain `npm install`, or a download that already fired.
  // ---------------------------------------------------------------------------
  check(
    'no unpinned runtime is present in THIS checkout',
    (await unpinnedRuntimeExists(REPO_ROOT)) === false,
    `node_modules/electron/dist exists at ${REPO_ROOT}. Either a plain \`npm install\` ran the ` +
      `install script, or a load triggered the lazy download. Remove it and install with ` +
      `--ignore-scripts; the pinned runtime lives under .tools/.`,
  );

  const runtimeRoot = await mkdtemp(join(tmpdir(), 'monstera-unpinned-'));
  try {
    await mkdir(join(runtimeRoot, 'node_modules', 'electron', 'dist'), { recursive: true });
    check(
      'CONTROL: a root that HAS an unpinned runtime is reported as having one',
      (await unpinnedRuntimeExists(runtimeRoot)) === true,
      `unpinnedRuntimeExists said false for a root where node_modules/electron/dist was just ` +
        `created. Without this the case above asserts false in all three worlds that run it — ` +
        `this machine, Guards (no node_modules at all) and ci.yml (--ignore-scripts never runs ` +
        `the script that creates dist) — so a wrong join, a typo, or a predicate that cannot ` +
        `see a directory would every one of them pass. It caught exactly that: the first ` +
        `version was built on fileExists, which ends in .isFile().`,
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} electron-import failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('electron-import case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
