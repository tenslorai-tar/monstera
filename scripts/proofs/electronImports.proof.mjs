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

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { ELECTRON_SPECIFIERS } from '../../eslint.config.js';
import { fileExists, verifyFileDigest } from '../lib/fetchVerified.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { PLAIN_NODE_EXTENSIONS } from '../lib/plainNodeScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { BUILDS, scriptsLoadingAtRuntime, unpinnedRuntimeExists } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Ignored by `.gitignore`, so a run killed before cleanup cannot redden a later
 * `eslint .` or reach a commit. It must live UNDER `scripts/` to match the
 * config block being tested — `.probe/` would match no rule at all, which is
 * the failure this case exists to detect.
 */
const PROBE = join(REPO_ROOT, 'scripts', '__import_probe__.mjs');

/**
 * The same probe as a `.js`, which is the extension half of the shared list
 * that nothing executed.
 *
 * `PLAIN_NODE_EXTENSIONS` widened the scan and the lint glob together, and only
 * the scan gained a case — the `.cjs` fixture in the shapes test. ESLint's side
 * was asserted: there is no `.js` or `.cjs` under `scripts/` today, so no run
 * touched it, and a glob that had quietly stopped matching them would have
 * looked exactly like this one.
 */
const PROBE_JS = join(REPO_ROOT, 'scripts', '__import_probe__.js');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 18 });

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
async function lintProbe(source, path = PROBE) {
  await writeFile(path, source, 'utf8');
  const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false, warnIgnored: false });
  const [result] = await eslint.lintFiles([path]);
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
    check(
      'the rule reaches a NON-.mjs plain-Node file, not only the extension that exists today',
      (
        await lintProbe("import { app } from 'electron';\nexport default app;\n", PROBE_JS)
      ).includes('no-restricted-imports'),
      `a .js file under scripts/ did not report no-restricted-imports. PLAIN_NODE_EXTENSIONS ` +
        `widens the scan and this glob TOGETHER, and until this case only the scan half was ` +
        `executed — there is no .js or .cjs under scripts/ today, so a glob that had stopped ` +
        `matching them would look exactly like a glob that works. Measured while adding this: ` +
        `ESLint does not expand a single-element brace, so the earlier \`{mjs}\` form matched ` +
        `NOTHING — the reason the glob is now one entry per extension.\n      ` +
        `If the message is a parsing error rather than a rule id, the config block stopped ` +
        `matching this file and projectService tried to type-check it. That is the failure ` +
        `mode, and it does not name the glob.`,
    );
  } finally {
    await rm(PROBE, { force: true });
    await rm(PROBE_JS, { force: true });
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

  // Every computed specifier in the real tree, named, justified, and COUNTED.
  //
  // The one sanctioned suppression channel for this scan: a tracked list here
  // rather than a flag on the scan, so a suppression cannot exist without
  // appearing in a diff. That is `.gitleaks.toml`'s `[allowlist]` shape — but
  // only the tracked-and-reviewed half of it, and the half it originally
  // omitted is exactly what got `.gitleaksignore` closed.
  //
  // KEYED ON THE FILE, JUSTIFIED BY A LINE. Without `sites`, one entry granted
  // its whole file standing amnesty: a second computed specifier appearing
  // anywhere in `nativeAddon.proof.mjs` would be accounted for by a sentence
  // describing a different call, producing NO CHANGE TO THIS MAP and therefore
  // no diff. That is the property this repository banned fingerprint files
  // for, reproduced by a list that reads as if it had learned the lesson.
  //
  // ENFORCED IN BOTH DIRECTIONS, which is what makes it more than a floor:
  //   more sites than declared -> a new, unreviewed suppression
  //   fewer                    -> a STALE entry, pre-authorising whatever
  //                               computed load lands in that file next
  // Both red, with the number visible in the diff. `createRoster`'s declared
  // count exactly, and for the same reason it has no `--update`: lowering one
  // should be a keystroke someone types and defends.
  //
  // The downward direction is also this check's vacuity guard, and it is worth
  // knowing which one it is. If the scan broke and returned nothing, `unlisted`
  // would be empty and pass — absence and correctness produce the same answer
  // there. Every entry would then read `found 0` and redden. The comparison is
  // mutated towards disagreement by the failure itself.
  //
  // NOT keyed on `path:line`: a line number moves whenever anything above it is
  // edited, and a suppression that reddens on unrelated edits is one that gets
  // loosened.
  //
  // WHAT THIS STILL DOES NOT CATCH, stated rather than implied. **The count is
  // quantity, not identity.** If `nativeAddon.proof.mjs`'s koffi
  // `require.resolve` were deleted and a different computed load written in its
  // place, the count stays 1, this case stays green, and the recorded reason
  // describes a call that no longer exists — a justification vouching for a
  // site it has never seen. That is this same granularity axis one notch finer,
  // and it is AA-1's family.
  //
  // Deliberately not fixed by keying on identity: a content hash of the call
  // site reddens on reformatting, and a suppression that reddens on unrelated
  // edits is the one that gets loosened — the same reason `path:line` was
  // rejected above. The remedy that would work is a reader, not a checker.
  //
  // So this is `passRoster.mjs`'s limit in a different object. That header says
  // the declared count protects a roster from disagreeing with ITSELF and
  // cannot fire when the wrong roster is formatted; here the count protects the
  // list from disagreeing with the tree's SHAPE and cannot fire when a site is
  // swapped. Naming it is what stops the mechanism being read as more than it
  // is — and both limits are the same sentence: a count sees how many, never
  // which.
  const ACCOUNTED_COMPUTED = new Map([
    [
      'scripts/lib/loadTypeScript.mjs',
      {
        sites: 1,
        reason:
          'loads the TypeScript compiler by absolute path through a file:// URL. It cannot be ' +
          'a literal — the path is resolved at run time and needs Windows backslash ' +
          'conversion — and it is the module this very scan loads its compiler with.',
      },
    ],
    [
      'scripts/proofs/nativeAddon.proof.mjs',
      {
        sites: 1,
        reason:
          'require.resolve of `@koromix/koffi-${platform}-${arch}/package.json` — the ' +
          'specifier names the running platform, so it cannot be a literal. Found by this ' +
          'case on its first run: the site became visible only once require.resolve and ' +
          'createRequire aliases were covered, which is what a widened check is for.',
      },
    ],
    [
      'scripts/proofs/rendererPolicy.proof.mjs',
      {
        sites: 1,
        reason:
          'imports apps/desktop/dist/windowPolicy.js by absolute path through a file:// URL, ' +
          'to read the CSP the shell actually declares. It cannot be a literal: the path is a ' +
          'BUILD OUTPUT resolved at run time and needs Windows backslash conversion — and a ' +
          'static import of the constant would compare the declared policy against a copy of ' +
          'itself, which is the one thing that proof exists not to do. Caught by this case on ' +
          'the first genuinely new computed site it ever met, which is what it is for.',
      },
    ],
    [
      'scripts/proofs/composition.proof.mjs',
      {
        sites: 1,
        reason:
          'imports apps/desktop/dist/budget.js by absolute path through a file:// URL, for the ' +
          'same reason and with the same constraint as the entry above: the ceiling is read ' +
          'from the BUILD so that the number compared against ADR-0007 is the one the shell ' +
          'ships, and a static import would compare the constant with itself. The path is ' +
          'resolved at run time and needs Windows backslash conversion, so it cannot be a ' +
          'literal.',
      },
    ],
    [
      'scripts/proofs/win32Handle.proof.mjs',
      {
        sites: 1,
        reason:
          'imports apps/desktop/dist/win32HostSurface.js through a file:// URL, to compare the ' +
          'COPY of isInvalidHandle that lives in that package against the owner in ' +
          'scripts/lib/win32Handle.mjs. The copy exists because apps/desktop cannot import ' +
          'plain Node under scripts/, and MMM-1s rule is that a copy made for that reason must ' +
          'be proven equal — so this proof has to reach the build, and a static import would be ' +
          'the very edge the copy exists to avoid. Nothing electron is reachable through it: ' +
          'the module imports koffi and @monstera/shared and its own sibling type file.',
      },
    ],
    [
      'scripts/research/lowboxSpike.mjs',
      {
        sites: 4,
        reason:
          'imports four built modules through file:// URLs, and the count moved from 2 to 4 ' +
          'when pipe creation followed process creation onto the shipped surface. All four ' +
          'are the same argument: reading the build IS the measurement, and a hand-rolled ' +
          'equivalent beside it is the B3a defect these moves remove. ' +
          'apps/desktop/dist/win32HostSurface.js creates every cell (RR-3). ' +
          'apps/desktop/dist/win32PipeSurface.js and dist/enginePipeFactory.js create every ' +
          'pipe, so the row that measures the SHIPPED descriptor against a contained cell is ' +
          'built by the shipped factory rather than by a copy that agrees today. ' +
          'scripts/lib/memoryBudgets.mjs reads §9.17s absolute cap, because applyLimits ' +
          'requires a memory limit and a number typed into a research file would be a second ' +
          'opinion about the invariant (ADR-0023 §2). Every path needs Windows backslash ' +
          'conversion at run time. This file starts the Electron BINARY by path under ' +
          'ELECTRON_RUN_AS_NODE and never imports the electron package, which is invariant 26 ' +
          'satisfied rather than evaded — and none of the three built modules imports it ' +
          'either: they reach koffi, @monstera/shared and their own siblings.',
      },
    ],
    [
      'scripts/research/hostSurfaceProbe.mjs',
      {
        sites: 2,
        reason:
          'imports apps/desktop/dist/win32HostSurface.js and scripts/lib/memoryBudgets.mjs ' +
          'through file:// URLs. The first is the whole point of the probe — it drives the ' +
          'SHIPPED surface against real processes rather than a copy of it, so reading the ' +
          'build is the measurement. The second reads §9.17s absolute cap, because a memory ' +
          'limit typed into a research file would be a second opinion about the invariant ' +
          '(ADR-0023 §2). Both paths need Windows backslash conversion at run time. This file ' +
          'starts an Electron BINARY in Node mode by path and never imports the electron ' +
          'package, which is invariant 26 satisfied rather than evaded.',
      },
    ],
  ]);

  /** @type {Map<string, number>} */
  const observedComputed = new Map();
  for (const site of nodeSide.unreadable) {
    const file = site.slice(0, site.lastIndexOf(':'));
    observedComputed.set(file, (observedComputed.get(file) ?? 0) + 1);
  }

  const unlisted = nodeSide.unreadable.filter(
    (site) => !ACCOUNTED_COMPUTED.has(site.slice(0, site.lastIndexOf(':'))),
  );
  check(
    'every file with a computed specifier is listed in ACCOUNTED_COMPUTED',
    unlisted.length === 0,
    `${unlisted.join(', ')} load(s) a module through a specifier this scan cannot read, in a ` +
      `file that is not listed. A computed specifier is not a violation — it is a site where ` +
      `the rule cannot answer, so someone has to. Read it, then add the file with a reason and ` +
      `a site count, or make the specifier a literal. Listed: ` +
      `${[...ACCOUNTED_COMPUTED.keys()].join(', ')}.`,
  );

  const miscounted = [...ACCOUNTED_COMPUTED]
    .map(([file, entry]) => {
      const actual = observedComputed.get(file) ?? 0;
      if (actual === entry.sites) return undefined;
      return actual > entry.sites
        ? `${file}: declared ${entry.sites}, found ${actual} — a NEW computed load in an ` +
            `already-listed file. The recorded reason covers a different call: "${entry.reason}"`
        : `${file}: declared ${entry.sites}, found ${actual} — STALE. ${
            actual === 0
              ? 'No computed specifier remains here, so the entry now pre-authorises whatever ' +
                'lands in this file next. Delete it.'
              : 'Lower the count in the same commit that removed the site.'
          }`;
    })
    .filter((line) => line !== undefined);
  check(
    'every listed entry matches its live site count, in BOTH directions',
    miscounted.length === 0,
    `${miscounted.join('\n      ')}\n      A file-keyed list with no count is standing amnesty: ` +
      `a second computed load inside a listed file changes nothing here, so it reaches no diff ` +
      `— which is precisely why .gitleaksignore is closed in this repository.`,
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

  // ---------------------------------------------------------------------------
  // A RESTORED CACHE IS RE-VERIFIED. A cache hit that skipped the digest check
  // would convert a hash-pinned artifact into an unpinned one delivered by a
  // store any workflow run on this repository can write to.
  //
  // Exercised against `verifyFileDigest` directly rather than by running the
  // provisioner, which would download ~100 MB. That is the same reasoning the
  // eight pin cases use, and the seam is real: the provisioner has exactly one
  // path from a pre-existing archive to an extraction, and it goes through this
  // function.
  // ---------------------------------------------------------------------------
  const cacheRoot = await mkdtemp(join(tmpdir(), 'monstera-cache-'));
  try {
    const poisoned = join(cacheRoot, 'electron-vX-poisoned.zip');
    await writeFile(poisoned, 'not the pinned archive', 'utf8');
    const anyPin = Object.values(BUILDS)[0]?.sha256 ?? '';

    let refused = false;
    try {
      await verifyFileDigest({ path: poisoned, sha256: anyPin, context: 'a poisoned cache entry' });
    } catch (error) {
      refused = error instanceof Error && error.message.includes('SHA-256 mismatch');
    }
    check(
      'a cached archive whose bytes do not match the pin is REFUSED',
      refused,
      `verifyFileDigest accepted a file that is not the pinned archive. A poisoned cache and a ` +
        `clean one look identical at the point of use, so the digest check is the only thing ` +
        `between the two — and a cache hit that skips it is a supply-chain path with a green ` +
        `check on it.`,
    );

    check(
      'and the refused file is deleted unread, not left for the next run to find',
      (await fileExists(poisoned)) === false,
      `${poisoned} survived a failed verification. A file that fails its pin is not a ` +
        `diagnostic to inspect later: leaving it invites the next run to find it and a human to ` +
        `decide it is probably fine.`,
    );

    const honest = join(cacheRoot, 'honest.txt');
    await writeFile(honest, 'pinned bytes', 'utf8');
    const honestDigest = createHash('sha256').update('pinned bytes').digest('hex');
    let accepted = true;
    try {
      await verifyFileDigest({ path: honest, sha256: honestDigest, context: 'a clean entry' });
    } catch {
      accepted = false;
    }
    check(
      'CONTROL: an archive that DOES match its pin is accepted and kept',
      accepted && (await fileExists(honest)),
      `a file whose digest equals its pin was rejected or deleted. Without this, both cases ` +
        `above are satisfied by a verifier that refuses everything — which is the reassuring ` +
        `direction for a security check and would make provisioning impossible rather than ` +
        `safe.`,
    );
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
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
