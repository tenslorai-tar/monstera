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

import {
  changedPaths,
  parseStagedBatch,
  readStagedBlob,
  readStagedBlobs,
} from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { report, scan } from '../lib/stagedSyntax.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 18 });

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
  // 7-9. THE OTHER TWO PARSE GOALS (finding VVV-4).
  //
  // Every fixture above is `.mjs`, so the `script` and `either` branches were
  // reachable, load-bearing and exercised by nothing — item 4's second kind.
  // Getting `either` wrong is silent in the direction that matters: a `.js`
  // file would be reported broken under a goal it does not have.
  //
  // Each case is built from a program legal in ONE goal only, so it cannot pass
  // by the goal being ignored.
  // -------------------------------------------------------------------------
  {
    const root = repository({ 'commonjs.cjs': "import a from 'b';\n" });
    const result = scan({ root });
    check(
      'a .cjs file is parsed as a SCRIPT, so a top-level import is reported',
      result.blind === null && result.problems.length === 1,
      `An import statement is legal in a module and a syntax error in a script, so this is ` +
        `the goal being chosen by extension rather than assumed. ` +
        `problems = ${JSON.stringify(result.problems)}`,
    );
  }
  {
    const root = repository({ 'plain.js': "import a from 'b';\nexport const c = a;\n" });
    const result = scan({ root });
    check(
      'a .js file parses when it is valid as a MODULE',
      result.blind === null && result.problems.length === 0,
      `The nearest package.json decides a .js file's goal, and resolving that here would ` +
        `reimplement Node's own rule — so either goal is accepted. This is the module half. ` +
        `problems = ${JSON.stringify(result.problems)}`,
    );
  }
  {
    // `with` is legal in sloppy script and a syntax error in a module, which is
    // the mirror of the case above: it can only pass if the SCRIPT attempt runs
    // after the module attempt fails.
    const root = repository({ 'sloppy.js': 'var o = {};\nwith (o) { var x = 1; }\n' });
    const result = scan({ root });
    check(
      'CONTROL: and a .js file valid only as a SCRIPT parses too, so the fallback runs',
      result.blind === null && result.problems.length === 0,
      `Without this, "accepts either goal" is satisfied by a scan that only ever tries the ` +
        `module one — every .js file in this repository is ESM, so nothing else would notice. ` +
        `problems = ${JSON.stringify(result.problems)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 10. A STAGED DELETION. Written because the filter for it was INERT and
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
  // 11-13. THE BATCHED BLOB READER agrees with the single one.
  //
  // AGAINST A FIXTURE, not this repository (finding VVV-5). It read the real
  // staged set, which is whatever the person running it happens to have added —
  // so with a clean index it compared ZERO paths and the control correctly said
  // so. In CI, where a fresh checkout stages nothing, it would have failed on
  // every run. It did not, because nothing in CI ran this proof at all (VVV-1):
  // one gap hiding another.
  //
  // Item 2's ambient-environment axis — a harness depending on state the real
  // caller does not supply. The fixture stages a known set, including a file
  // whose CONTENT contains a newline, so the framing has to use the header's
  // byte count rather than stopping at the first one it sees.
  // -------------------------------------------------------------------------
  {
    const root = repository({
      'one.mjs': FINE,
      'two.mjs': 'export const b = 2;\n',
      'three.cjs': 'module.exports = 3;\n',
      'nested/four.js': 'export const d = 4;\n',
      'multiline.mjs': 'export const e = 5;\nexport const f = 6;\nexport const g = 7;\n',
    });
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

  // -------------------------------------------------------------------------
  // THE FRAMING, DRIVEN DIRECTLY — finding KKKK-1.
  //
  // git cannot be asked to answer wrongly, so a desynchronised batch is not
  // reachable through `readStagedBlobs`. What is reachable is the consequence:
  // the map comes back SHORT, and both call sites skip a path the map does not
  // carry, so a dropped tail arrives as *those files were clean*. That is the
  // answer both scans exist to be able to give.
  //
  // The fixture is built here rather than staged, because the property is about
  // bytes that no repository can produce.
  // -------------------------------------------------------------------------
  {
    /** @param {string} sha @param {string} body @param {number} [declared] */
    const frame = (sha, body, declared) =>
      Buffer.concat([
        Buffer.from(`${sha} blob ${String(declared ?? body.length)}\n`, 'utf8'),
        Buffer.from(body, 'utf8'),
        Buffer.from('\n', 'utf8'),
      ]);

    const asked = ['a.mjs', 'b.mjs', 'gone.mjs', 'c.mjs'];
    const missLine = Buffer.from(':gone.mjs missing\n', 'utf8');

    const wellFormed = parseStagedBatch(
      Buffer.concat([frame('aaa1', 'AAA'), frame('bbb2', 'BB'), missLine, frame('ccc3', 'CCCC')]),
      asked,
    );
    check(
      'the framing parser reads every hit, skips the miss, and keeps the bytes',
      wellFormed.size === 3 &&
        wellFormed.get('a.mjs')?.toString('utf8') === 'AAA' &&
        wellFormed.get('b.mjs')?.toString('utf8') === 'BB' &&
        wellFormed.get('c.mjs')?.toString('utf8') === 'CCCC' &&
        !wellFormed.has('gone.mjs'),
      `read ${String(wellFormed.size)} of 3 expected. This is the POSITIVE CONTROL for the two ` +
        `cases below: a parser that threw on everything would pass them both while being ` +
        `useless, and its failure and its correctness are otherwise the same absence of output.`,
    );

    // ONE BYTE SHORT — the smallest lie a header can tell. The offset then
    // lands inside the frame it was meant to step over, and the two paths after
    // it are read from the wrong place.
    const lying = Buffer.concat([
      frame('aaa1', 'AAA'),
      frame('bbb2', 'BB', 1),
      missLine,
      frame('ccc3', 'CCCC'),
    ]);

    let threw = null;
    try {
      parseStagedBatch(lying, asked);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    check(
      'a declared size that does not match its bytes THROWS, naming where it was lost',
      threw !== null && threw.includes('gone.mjs') && threw.includes('3 of 4'),
      threw === null
        ? 'It returned a map. A short map is what the callers read as "those files were clean".'
        : `threw, but the message does not say which request lost the framing: ${threw}`,
    );

    // THE CONTROL, and it is the one that makes the case above mean anything.
    // It reproduces the rule this fix replaced — skip a header that is not a
    // blob line, stop at the end of the stream — and requires the SAME fixture
    // to be accepted quietly by it. Without this, the case above could be
    // passing because the fixture is malformed in some way the old rule also
    // rejected, and the throw would be evidence of nothing.
    let lenient = 0;
    let offset = 0;
    for (const path of asked) {
      const newline = lying.indexOf('\n', offset);
      if (newline === -1) break;
      const header = lying.toString('utf8', offset, newline);
      offset = newline + 1;
      const size = /\bblob\s+(\d+)$/u.exec(header)?.[1];
      if (size === undefined) continue;
      lenient += 1;
      offset += Number(size) + 1;
      void path;
    }
    check(
      'CONTROL: the rule this replaced accepts that same fixture, and just returns fewer',
      lenient < asked.length - 1,
      `the tolerant parse produced ${String(lenient)} entries for ${String(asked.length)} ` +
        `requests, which is not short — so the fixture does not reproduce the defect and the ` +
        `throw above proves nothing about it.`,
    );

    // A path that names a DIRECTORY resolves to a tree, and a submodule's to a
    // commit. Both are well-formed answers and neither is a lost offset, so
    // they get their own message — a reader sent hunting a framing bug that is
    // not there is worse off than one told what it actually asked for.
    let wrongType = null;
    try {
      parseStagedBatch(
        Buffer.concat([Buffer.from('aaa1 tree 3\n', 'utf8'), Buffer.from('AAA\n', 'utf8')]),
        ['some/dir'],
      );
    } catch (error) {
      wrongType = error instanceof Error ? error.message : String(error);
    }
    check(
      'a path that resolves to a tree is refused BY TYPE, not reported as lost framing',
      wrongType !== null && wrongType.includes('is a tree') && !wrongType.includes('framing'),
      wrongType === null
        ? 'It returned a tree object as though it were a staged file body.'
        : `threw with the wrong diagnosis: ${wrongType}`,
    );

    let truncated = null;
    try {
      parseStagedBatch(Buffer.concat([frame('aaa1', 'AAA')]), asked);
    } catch (error) {
      truncated = error instanceof Error ? error.message : String(error);
    }
    check(
      'a stream that ends before the last header THROWS rather than returning what it got',
      truncated !== null && truncated.includes('the stream ended'),
      truncated === null
        ? 'It returned one entry for four requests, silently.'
        : `threw for the wrong reason: ${truncated}`,
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
