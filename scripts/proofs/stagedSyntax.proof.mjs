// @ts-check
/**
 * Proof that the staged-syntax guard can see, can refuse, and reads the INDEX —
 * and that the batched blob reader it rests on agrees with the single one
 * (findings UUU-2, and the reader beneath it).
 *
 * ## What this guard's silence would otherwise be worth
 *
 * Its reassuring answer is "nothing is broken", and four different things print
 * it: a clean set, an empty file list, an extension filter that stopped
 * matching, and a parser child that never ran. Two controls inside the scan
 * itself cover the last, in both directions; the cases here cover the rest and
 * the property no assertion about results can see — that it reads the index
 * rather than the disk.
 *
 * ## The reader is proven by AGREEMENT, and the direction matters
 *
 * `readStagedBlobs` exists because reading blobs one at a time spawned git twice
 * per path and cost fourteen times the parse it fed. It parses `cat-file
 * --batch`'s framing — a header line, then exactly N bytes, then a newline — and
 * a framing bug there is silent: the next blob starts at the wrong offset and
 * every file after it is garbage that may still parse.
 *
 * So it is compared against `readStagedBlob`, which is the existing single
 * reader, on real staged content. Item 4's rule about comparisons applies: the
 * mutation that separates is one towards DISAGREEMENT, because agreement is also
 * what two empty results produce — hence the case requiring a non-trivial number
 * of paths, and the one requiring a path that is not in the index to be ABSENT
 * rather than empty.
 *
 * Usage: node scripts/proofs/stagedSyntax.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedPaths, readStagedBlob, readStagedBlobs, repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { report, scan } from '../lib/stagedSyntax.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @type {string[]} */
const scratches = [];

/**
 * A throwaway git repository with files staged, so the scan can be driven
 * against content that is in an index and not on any disk this repository owns.
 *
 * @param {Record<string, string>} staged Path to contents.
 * @param {Record<string, string>} [afterStaging] Written AFTER `git add`.
 * @returns {string}
 */
function repository(staged, afterStaging = {}) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-syntax-proof-'));
  scratches.push(root);
  const run = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  run(['init', '--quiet']);
  run(['config', 'user.email', 'proof@example.invalid']);
  run(['config', 'user.name', 'proof']);
  for (const [path, contents] of Object.entries(staged)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  run(['add', '-A']);
  for (const [path, contents] of Object.entries(afterStaging)) {
    writeFileSync(join(root, path), contents, 'utf8');
  }
  return root;
}

const BROKEN = 'export const a = ;\n';
const FINE = 'export const a = 1;\n';

try {
  // -------------------------------------------------------------------------
  // 1 & 2. IT CAN REPORT A BREAK, and does not report everything as one.
  // -------------------------------------------------------------------------
  {
    const root = repository({ 'bad.mjs': BROKEN, 'good.mjs': FINE });
    const result = scan({ root });
    check(
      'a staged file that does not parse is REPORTED',
      result.blind === null && result.problems.some((problem) => problem.path === 'bad.mjs'),
      `blind = ${String(result.blind)}, problems = ${JSON.stringify(result.problems)}`,
    );
    check(
      'CONTROL: and the file beside it that parses is NOT reported',
      !result.problems.some((problem) => problem.path === 'good.mjs'),
      `a scan that reports everything satisfies the case above. ${JSON.stringify(result.problems)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 3 & 4. THE INDEX, NOT THE DISK. No assertion about results can see this:
  // the same files, the same verdict, whichever source it read.
  // -------------------------------------------------------------------------
  {
    // Staged broken, then FIXED on disk. A guard reading the working tree
    // passes this commit and the broken bytes go in.
    const root = repository({ 'bad.mjs': BROKEN }, { 'bad.mjs': FINE });
    const result = scan({ root });
    check(
      'a file staged BROKEN and fixed on disk afterwards is still reported',
      result.problems.some((problem) => problem.path === 'bad.mjs'),
      `The working tree is valid and the index is not. Reading the disk here passes a commit ` +
        `whose content does not parse. problems = ${JSON.stringify(result.problems)}`,
    );
  }
  {
    // The mirror: staged FINE, broken on disk. A guard reading the working tree
    // blocks a commit that is perfectly good.
    const root = repository({ 'good.mjs': FINE }, { 'good.mjs': BROKEN });
    const result = scan({ root });
    check(
      'CONTROL: a file staged FINE and broken on disk afterwards is NOT reported',
      result.blind === null && result.problems.length === 0,
      `Without this, the case above is satisfied by a scan that reports every file. ` +
        `blind = ${String(result.blind)}, problems = ${JSON.stringify(result.problems)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. THE SCOPE IS STATED AND IS REAL. A .ts file must not be parsed, because
  // V8 refuses type annotations and every one would report as broken.
  // -------------------------------------------------------------------------
  {
    const root = repository({
      'typed.ts': 'export const a: number = 1;\n',
      'plain.mjs': FINE,
    });
    const result = scan({ root });
    check(
      'a staged TypeScript file is not parsed, and so is not reported broken',
      result.blind === null && result.problems.length === 0 && result.checked === 1,
      `checked = ${String(result.checked)}, problems = ${JSON.stringify(result.problems)}. ` +
        `Type annotations are a syntax error to V8. Including .ts would report every one of ` +
        `them, which is why the scope is JavaScript and why tsc keeps the other half.`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. THE COMMENT-CLOSING SEQUENCE, which is the occurrence this exists for.
  // -------------------------------------------------------------------------
  {
    const root = repository({
      // Built by concatenation for the reason the module states: written out, it
      // would end this file's own comment.
      'doc.mjs': `/** a sed expression: s/=.*${'*/'}=x/ */\nexport const a = 1;\n`,
    });
    const result = scan({ root });
    check(
      'a comment-closing sequence inside a JSDoc block is caught',
      result.problems.length === 1,
      `This is the 2026-08-23 occurrence. The emitted-template scan cannot see it — it looks ` +
        `for a backtick — and what caught it was a person running node --check. ` +
        `problems = ${JSON.stringify(result.problems)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 7. A STAGED DELETION. Written because the filter for it was INERT and
  // nothing here would have said so.
  //
  // It read `entry.status`, and the field is `entry.state` — so the comparison
  // was `undefined !== 'D'`, always true, and deletions were passed through.
  // The scan was still correct, because a deleted path is not in the index and
  // the batch reader reports it absent, which is a second mechanism doing the
  // work. TypeScript caught the slip; no case did, because the fixture set had
  // no deletion in it at all.
  // -------------------------------------------------------------------------
  {
    const root = repository({ 'gone.mjs': FINE, 'kept.mjs': FINE });
    spawnSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root, encoding: 'utf8' });
    spawnSync('git', ['rm', '--quiet', 'gone.mjs'], { cwd: root, encoding: 'utf8' });
    const result = scan({ root });
    check(
      'a staged DELETION is not parsed and does not report a problem',
      result.blind === null && result.problems.length === 0 && result.checked === 0,
      `checked = ${String(result.checked)}, problems = ${JSON.stringify(result.problems)}. ` +
        `A deletion has no content in the index; treating it as a file to parse would report ` +
        `it as unreadable, which is a defect the classifier's state axis exists to prevent.`,
    );
  }

  // -------------------------------------------------------------------------
  // 8-10. THE BATCHED BLOB READER agrees with the single one, on real content.
  // -------------------------------------------------------------------------
  {
    const root = repoRoot();
    const staged = changedPaths(['--cached'], { cwd: root })
      .filter((entry) => entry.state !== 'D')
      .map((entry) => entry.path);
    const batch = readStagedBlobs([...staged, 'no/such/path.mjs'], { cwd: root });

    let compared = 0;
    /** @type {string[]} */
    const mismatched = [];
    for (const path of staged) {
      const single = readStagedBlob(path, { cwd: root });
      if (single === null) continue;
      compared += 1;
      const many = batch.get(path);
      if (many === undefined || !single.equals(many)) mismatched.push(path);
    }

    check(
      'the batched reader agrees with the single reader byte for byte',
      mismatched.length === 0,
      `disagreed on: ${mismatched.join(', ')}. A framing bug in \`cat-file --batch\` starts the ` +
        `next blob at the wrong offset, so every file after it is garbage that may still parse.`,
    );
    check(
      'CONTROL: and it compared a non-trivial number of paths, so agreement means something',
      compared >= 2,
      `compared ${String(compared)}. Two empty results agree, which is why the count is the ` +
        `case rather than the comparison alone — item 4, applied to a comparison.`,
    );
    check(
      'a path not in the index is ABSENT from the batch, never empty',
      !batch.has('no/such/path.mjs'),
      'An empty buffer and a missing file are different answers, and a reader that returns ' +
        'the first for the second makes a deleted file look like an empty one.',
    );
  }
} finally {
  for (const scratch of scratches) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} staged-syntax case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('staged-syntax case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;

// Keeps `report` honest about being importable and callable — it is what the
// hook prints, and a formatter nothing exercises is the display-only shape.
if (process.env['MONSTERA_SYNTAX_REPORT'] === '1') {
  process.stdout.write(report(scan()));
}
