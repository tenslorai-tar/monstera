// @ts-check
/**
 * Every script module guards its main body through {@link isMain}, or not at
 * all (finding AAAA-5).
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
 * not do is *decide by hand* whether it is the entry point, because every hand
 * spelling of that decision has a wrong answer somewhere. So: no script module
 * reads `process.argv[1]` except through `isMain`.
 *
 * ## Why the pattern is the READ, and not one comparison
 *
 * This scan first matched `import.meta.url ===` alone, and reported *ok* over a
 * tree holding 39 hand-written guards in three other spellings (counted by this
 * scan's present pattern, 2026-10-01 on 5f5a747a):
 *
 * | spelling | where it is wrong |
 * |---|---|
 * | `import.meta.url.endsWith(argv[1])` | a path with a space or any character a URL escapes: the url says `%20`, argv says a space, and the guard never fires |
 * | `argv[1].endsWith('name.mjs')` | any entry point with the same file name, in any directory |
 * | `resolve(argv[1]) === fileURLToPath(import.meta.url)` | nowhere yet; it is a second opinion about a question `isMain` owns (B3a) |
 *
 * The first is the AAAA-5 failure one character class over: run from
 * `with space/guard.mjs`, it answered `false` where `isMain` answered `true`
 * (2026-10-01). Every one of those spellings READS `process.argv[1]`, and
 * reading it is the thing only the resolver should do, so the read is what is
 * matched. A comparison pattern describes the defect that has been seen; the
 * read describes the class.
 *
 * ## What it reads: every `.mjs` under `scripts/`
 *
 * Not only the npm-invoked entry points ({@link wrappableEntryPoints}), which
 * this scan took until 2026-10-01: a git hook, a workflow step and a spike are
 * entered too, and four hand-written guards sat outside that roster. The rule is
 * about how a module decides it is main, which does not depend on who enters it.
 *
 * Out of reach, stated: a read spelt without the index — `process.argv.at(1)`,
 * or a destructured `const [, entry] = process.argv`. None exists today.
 *
 * Usage: node scripts/lib/mainGuards.mjs [--root <dir>]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/**
 * A hand-written read of the entry script's path, in any of its spellings.
 *
 * Not any mention of `import.meta.url`. `fileURLToPath(import.meta.url)` to
 * locate a module's own directory is an unrelated and correct use, and the first
 * version of this scan matched it — reporting 38 files, nearly all of them fine.
 * That was this instrument failing its own resolution test before it measured
 * anything (audit item 4a), and it is the shape the escape guard's false
 * positives warn about: a scan that cries wolf is a scan someone turns off.
 */
const READS_ENTRY = /process\.argv\[1\]|import\.meta\.url\s*===|===\s*import\.meta\.url/u;

/** Reaching it through the one resolver. */
const VIA_IS_MAIN = /isMain\s*\(\s*import\.meta\.url\s*\)/u;

/**
 * The three modules that name the read on purpose: the resolver that owns it,
 * this scan, which spells its patterns, and the proof that drives the resolver
 * by removing `argv[1]`.
 */
const OWNERS = new Set(['scripts/lib/isMain.mjs', 'scripts/lib/mainGuards.mjs', 'scripts/proofs/mainGuards.proof.mjs']);

/**
 * Every `.mjs` under `<root>/scripts`, as forward-slash paths relative to the root.
 *
 * @param {string} root
 * @returns {string[]}
 */
function scriptModules(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(join(root, 'scripts'));
  return found.sort();
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ modules: string[], guarded: string[], handRolled: string[] }}
 */
export function scanMainGuards(options = {}) {
  const root = options.root ?? repoRoot();
  const modules = scriptModules(root);
  if (modules.length === 0) {
    throw new Error('Found no script modules. An empty roster is a broken walk, not a clean tree.');
  }

  /** @type {string[]} */
  const guarded = [];
  /** @type {string[]} */
  const handRolled = [];
  for (const path of modules) {
    if (OWNERS.has(path)) continue;
    const text = readFileSync(join(root, path), 'utf8');
    if (READS_ENTRY.test(text)) handRolled.push(path);
    else if (VIA_IS_MAIN.test(text)) guarded.push(path);
  }
  return { modules, guarded, handRolled };
}

/**
 * @param {{ root?: string, control?: string }} [options]
 * @returns {{ ok: boolean, output: string }}
 */
export function report(options = {}) {
  // A file this scan is KNOWN to be able to find guarding itself correctly. If
  // the walk, the read or the pattern breaks, this goes red instead of the
  // violation count quietly reaching zero.
  const control = options.control ?? 'scripts/lib/emittedTemplates.mjs';
  const { modules, guarded, handRolled } = scanMainGuards(options);

  let output = '';
  for (const path of handRolled) {
    output +=
      `  FAILED  ${path} reads process.argv[1] by hand instead of calling isMain(import.meta.url)\n` +
      `          Every hand spelling of "am I the entry point" is wrong somewhere: a url beside a\n` +
      `          path disagrees on Windows and wherever a URL escapes a character, and a file-name\n` +
      `          suffix matches any script with that name. Where it is wrong the guard does not\n` +
      `          fire and the script exits 0 having done nothing — which every check here reads\n` +
      `          as a pass.\n`;
  }
  if (handRolled.length === 0) {
    output +=
      `  ok  ${String(guarded.length)} of ${String(modules.length)} script module(s) guard main ` +
      `through isMain(); none decides it by hand\n`;
  }
  output += guarded.includes(control)
    ? `  ok  and the scan located ${control}, so that result means something\n`
    : `  FAILED  the scan did not locate ${control}, which is known to guard main correctly.\n` +
      `          A walk that reads nothing reports every file as compliant.\n`;

  return { ok: handRolled.length === 0 && guarded.includes(control), output };
}

if (isMain(import.meta.url)) {
  const rootIndex = process.argv.indexOf('--root');
  const result = report(rootIndex === -1 ? {} : { root: resolve(process.argv[rootIndex + 1] ?? '.') });
  process.stdout.write(result.output);
  process.exitCode = result.ok ? 0 : 1;
}
