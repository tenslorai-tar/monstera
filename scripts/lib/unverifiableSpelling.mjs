// @ts-check
/**
 * No script spells a could-not-look verdict of its own.
 *
 * ## The class this exists for, measured before it was written
 *
 * `unverifiable.mjs` exports the tokens `npm run local` keys on, and its own
 * header says a caller spelling its own version would be a second opinion about
 * what that module prints. **Six files spelt their own anyway**, and each
 * wording reads perfectly to a person: `UNVERIFIABLE — 6 case(s) could not be
 * evaluated here` matches nothing.
 *
 * The consequence was measured rather than argued. One sweep's row:
 *
 *     { "name": "proof:hostrecovery", "exit": 0, "seconds": 1.74,
 *       "bytes": null, "firstProblem": null }
 *
 * `bytes: null` is the harness's PASS branch — it records a length only when it
 * matched a token — and 1.74 seconds against 20.1 for a real run is the tell.
 * The proof of that range's headline claim was green while it measured nothing.
 *
 * ## Why an exported constant was not enough, and a scan is
 *
 * The constant is what the READER matches on. Nothing makes the writer use it:
 * `process.stdout.write` takes any string, so the correct call and the invisible
 * one look identical at the call site and only one of them is a paragraph away
 * in another file. Writing the rule down had already been tried — it is in that
 * module's header — and six callers re-derived it.
 *
 * So the rule gets a caller. A file that writes either word into a template
 * must import the module that owns it.
 *
 * ## What it deliberately permits
 *
 * **Comments and JSDoc.** The word appears in prose across this repository —
 * explaining the state, recording a finding — and banning that would make the
 * rule one people work around. The scan strips comments and looks at what is
 * left, which is where a `write` call's argument lives.
 *
 * **The owner and its proof.** `unverifiable.mjs` defines both tokens and
 * `unverifiable.proof.mjs` asserts on them.
 *
 * Usage: node scripts/lib/unverifiableSpelling.mjs [--root <dir>]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** The module that owns the answer, and the file that proves it. */
const OWNERS = ['scripts/lib/unverifiable.mjs', 'scripts/proofs/unverifiable.proof.mjs'];

/**
 * The MARKER SHAPES, not the words — two spaces, the word, two spaces.
 *
 * ## The wider rule was written first and it was wrong in four places
 *
 * Banning the bare word reported four files on its first run, and reading them
 * is what narrowed this: `advisoryRegister.proof.mjs` puts `/UNVERIFIABLE/u` in
 * an assertion, `nodeModulesPlacement.proof.mjs` writes it inside fixture source
 * it hands to a scratch tree, and `engineAdvisories.mjs` prints
 * `N symbol(s) UNVERIFIABLE — …`, which is a per-symbol verdict inside its own
 * report and not a run-level one. None of those can be matched by a harness and
 * none is a second opinion about anything.
 *
 * The fifth, `win32Handle.proof.mjs`, prints `  UNVERIFIABLE  ${name}` — the
 * marker's exact shape, at the start of a line — and IS one.
 *
 * So the property is the token a harness keys on rather than the word a person
 * writes, which is the same distinction the classifier findings in this
 * repository keep turning on: what it matches, not just that it matches.
 */
const SHAPES = ['  UNVERIFIABLE  ', '  PARTLY MEASURED  '];

/**
 * The file that must always be found, so silence means something (item 4b).
 *
 * `checkLocal.mjs` reads both tokens and imports the owner, so it is a file the
 * scan must SEE and must not report. A scan that examined nothing would
 * otherwise print a clean result, which is the answer everybody asking this
 * wants to hear.
 */
const CONTROL = 'scripts/checkLocal.mjs';

/**
 * Every `.mjs` under a directory, repo-relative with forward slashes.
 *
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function scripts(root, dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...scripts(root, path));
    else if (name.endsWith('.mjs')) out.push(relative(root, path).replaceAll('\\', '/'));
  }
  return out;
}

/**
 * The source with comments removed.
 *
 * Line comments and block comments only — there is no attempt to parse strings,
 * because the thing being looked for IS a string and removing them would remove
 * the subject. A comment carrying a block-comment terminator inside it ends the
 * block early and leaves prose behind; that direction is a false POSITIVE,
 * which someone reads and fixes, rather than a false negative nobody sees.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, ' ').replaceAll(/(^|\n)\s*\/\/[^\n]*/gu, '$1');
}

/**
 * Files that write a verdict word without importing the owner.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ examined: number, offenders: string[], sawControl: boolean }}
 */
export function spellingReport({ root = repoRoot() } = {}) {
  const files = scripts(root, join(root, 'scripts'));
  /** @type {string[]} */
  const offenders = [];
  let sawControl = false;

  for (const file of files) {
    if (file === CONTROL) sawControl = true;
    if (OWNERS.includes(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    if (text.includes("lib/unverifiable.mjs")) continue;
    const code = withoutComments(text);
    if (SHAPES.some((shape) => code.includes(shape))) offenders.push(file);
  }

  return { examined: files.length, offenders, sawControl };
}

/** @param {string[]} argv @returns {string} */
function rootFrom(argv) {
  const at = argv.indexOf('--root');
  return at === -1 ? repoRoot() : (argv[at + 1] ?? repoRoot());
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const { examined, offenders, sawControl } = spellingReport({ root: rootFrom(process.argv) });

  // THE POSITIVE CONTROL, ON EVERY RUN AND NOT ONLY IN THE PROOF. This is a
  // SEARCH whose good news is silence, and a wrong root, an empty file list or a
  // comment-stripper that ate everything all produce the same clean result.
  if (!sawControl) {
    process.stderr.write(
      `\nThe scan did not reach ${CONTROL}, which reads both tokens and is the file it must\n` +
        `always find. Every way this can be broken — a wrong root, an empty walk, a stripper\n` +
        `that ate the source — reports "nothing to fix", so its silence is refused instead.\n`,
    );
    process.exit(1);
  }

  if (offenders.length > 0) {
    process.stderr.write(
      `\n${String(offenders.length)} script(s) spell a could-not-look verdict without importing\n` +
        `the module that owns it:\n\n${offenders.map((file) => `  - ${file}\n`).join('')}\n` +
        `  \`scripts/lib/unverifiable.mjs\` exports the tokens \`npm run local\` matches on. A\n` +
        `  wording of your own reads correctly to a person and matches nothing, so the harness\n` +
        `  files the run as a PASS — measured on proof:hostrecovery, which reported green in\n` +
        `  1.74s against 20.1s for a real run.\n\n` +
        `  Use exitUnverifiable() where the run measured nothing, or partialOutcome() where\n` +
        `  some cases ran and some could not.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `  ok  ${String(examined)} script(s) leave the could-not-look wording to its owner\n` +
      `  ok  and the control was located, so that result means something\n`,
  );
}
