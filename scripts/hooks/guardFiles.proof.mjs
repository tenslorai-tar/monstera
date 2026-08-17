// @ts-check
/**
 * Proof for the file-content guard (rule B2).
 *
 * Each rejection case is paired with a control that must be *accepted*. That
 * pairing is the point: a guard that rejected everything would pass every
 * rejection test on its own, and "blocks bad input" is only meaningful
 * alongside "admits good input". Remove any rule from guardFiles.mjs and its
 * rejection case here goes red; make any rule too broad and its control does.
 *
 * The proof drives the real guard as a subprocess against a throwaway git
 * repository, so it exercises shipping code — including its git plumbing —
 * rather than a re-implementation of it.
 *
 * Usage: node scripts/hooks/guardFiles.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), 'guardFiles.mjs');

/**
 * @param {string} cwd
 * @param {readonly string[]} args
 */
function git(cwd, args) {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  }
}

/** @returns {string} Path to a fresh repository with one commit. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-guard-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'proof@example.invalid']);
  git(root, ['config', 'user.name', 'Guard Proof']);
  writeFileSync(join(root, 'README.md'), '# scratch\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '--no-verify', '-m', 'base']);
  return root;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {Buffer | string} contents
 */
function stage(root, relativePath, contents) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  git(root, ['add', '--', relativePath]);
}

/**
 * Writes a file WITHOUT staging it, so the index and the working tree disagree.
 *
 * `stage()` writes and adds in one call, so every case built on it has a blob
 * that matches the disk. That is why the provenance scope defect was invisible
 * to this proof for its whole life: the two could never differ, so a rule that
 * read the wrong one behaved identically either way.
 *
 * @param {string} root
 * @param {string} relativePath
 * @param {Buffer | string} contents
 */
function writeUnstaged(root, relativePath, contents) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

/**
 * @param {string} root
 * @param {string} [from] Directory to invoke from; defaults to the root.
 * @param {'--staged' | '--tree'} [scope]
 * @returns {{ ok: boolean, output: string }}
 */
function runGuard(root, from, scope = '--staged') {
  const result = spawnSync(process.execPath, [GUARD, scope], {
    cwd: from === undefined ? root : join(root, from),
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * @typedef {{
 *   name: string,
 *   expect: 'reject' | 'accept',
 *   because?: string,
 *   runFrom?: string,
 *   scope?: '--staged' | '--tree',
 *   setup: (root: string) => void,
 * }} Case
 * @type {readonly Case[]}
 */
const CASES = [
  {
    name: 'plain source file',
    expect: 'accept',
    setup: (root) => stage(root, 'src/index.ts', 'export const answer = 42;\n'),
  },
  {
    name: 'file over the 5 MB ceiling',
    expect: 'reject',
    because: 'exceeds the 5 MB limit',
    setup: (root) => stage(root, 'big.txt', 'x'.repeat(5 * 1024 * 1024 + 1)),
  },
  {
    name: 'file exactly at the 5 MB ceiling',
    expect: 'accept',
    // Control for the size rule: proves the boundary is a ceiling, not an
    // off-by-one that rejects the largest legal file.
    setup: (root) => stage(root, 'exact.txt', 'x'.repeat(5 * 1024 * 1024)),
  },
  {
    name: 'Windows executable disguised as a text file',
    expect: 'reject',
    because: 'Windows PE/DOS (MZ)',
    // The case the extension-blocklist design fails: a real executable whose
    // extension is entirely innocent. Magic-byte detection is what closes it.
    setup: (root) => stage(root, 'notes.txt', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])),
  },
  {
    name: 'ELF executable disguised as data',
    expect: 'reject',
    because: 'Linux ELF',
    setup: (root) => stage(root, 'blob.dat', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])),
  },
  {
    name: 'binary content with an unlisted extension',
    expect: 'reject',
    because: 'not on the',
    setup: (root) => stage(root, 'model.bin', Buffer.from([0x01, 0x00, 0x02, 0x00, 0x03])),
  },
  {
    name: 'PNG artwork under the size ceiling',
    expect: 'accept',
    // Control for the binary rule: allowlisted binaries must still pass, or
    // the repository could hold no brand assets and no screenshot baselines.
    setup: (root) =>
      stage(root, 'assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
  },
  {
    name: 'text file containing a mangled escape sequence near the start',
    expect: 'reject',
    because: 'control character 0x07',
    // The exact corruption that reached a commit here: `\a` and `\b` inside a
    // non-raw Python string became BEL and BACKSPACE, and `C:\a\b.pdf` rendered
    // as `C:.pdf` — the characters appear to vanish rather than look wrong, so
    // a review reads straight past it.
    setup: (root) => stage(root, 'notes.md', `A Windows path: C:${String.fromCharCode(7, 8)}.pdf\n`),
  },
  {
    name: 'text file whose only mangled escape is past the 8000-byte sniff window',
    expect: 'reject',
    because: 'control character 0x07',
    // THIS is the case that was missing, and its absence is why the guard shipped
    // blind. The scan shared the 8000-byte window the binary sniff uses, while
    // the case above puts its control character at byte 16 — so the case could
    // never reach past the window, and the guard passed docs/JOURNAL.md, which
    // carried this exact corruption at byte 26635, from the commit that
    // introduced the rule until it was found by audit.
    //
    // The padding is deliberately larger than the window rather than just over
    // it, so a later change that merely widens the window does not turn this
    // case green again by accident.
    setup: (root) =>
      stage(
        root,
        'long-notes.md',
        `${'Filler line that is unremarkable prose.\n'.repeat(600)}` +
          `A Windows path: C:${String.fromCharCode(7, 8)}.pdf\n`,
      ),
  },
  {
    name: 'long clean text file past the sniff window',
    expect: 'accept',
    // Control for the case above: a file of the same shape and size with no
    // control characters must still pass, or the rejection above would prove
    // only that the guard dislikes long files.
    setup: (root) =>
      stage(
        root,
        'long-clean.md',
        `${'Filler line that is unremarkable prose.\n'.repeat(600)}A Windows path: C:\\a\\b.pdf\n`,
      ),
  },
  {
    name: 'text file with tabs and newlines',
    expect: 'accept',
    // Control for the case above: tab, LF and CR are legitimate text, and a
    // guard that rejected them would reject most of the repository.
    setup: (root) => stage(root, 'table.md', 'a\tb\r\nc\td\n'),
  },
  {
    name: 'PDF outside the fixture corpus',
    expect: 'reject',
    because: 'outside packages/testing/fixtures/',
    setup: (root) => stage(root, 'docs/sample.pdf', '%PDF-1.7\n\x00trailer\n'),
  },
  {
    name: 'fixture PDF with no provenance record',
    expect: 'reject',
    because: 'not declared in',
    setup: (root) => {
      stage(root, 'packages/testing/fixtures/PROVENANCE.md', '# Fixture provenance\n');
      stage(root, 'packages/testing/fixtures/rotated.pdf', '%PDF-1.7\n\x00trailer\n');
    },
  },
  {
    name: 'fixture PDF declared in PROVENANCE.md',
    expect: 'accept',
    // Control for the provenance rule: proves it gates on the declaration
    // rather than simply refusing every PDF.
    setup: (root) => {
      stage(
        root,
        'packages/testing/fixtures/PROVENANCE.md',
        '# Fixture provenance\n\n- `rotated.pdf` — self-generated by scripts/fixtures/rotated.mjs\n',
      );
      stage(root, 'packages/testing/fixtures/rotated.pdf', '%PDF-1.7\n\x00trailer\n');
    },
  },
  {
    name: 'fixture PDF whose declaration exists on disk but is NOT staged',
    expect: 'reject',
    because: 'not staged',
    // The scope defect, which no case could express while `stage()` was the only
    // way to create a file. The commit contains the PDF and not the declaration,
    // so the commit is undeclared — regardless of what is sitting on disk.
    setup: (root) => {
      writeUnstaged(
        root,
        'packages/testing/fixtures/PROVENANCE.md',
        '# Fixture provenance\n\n- `rotated.pdf` — self-generated\n',
      );
      stage(root, 'packages/testing/fixtures/rotated.pdf', '%PDF-1.7\n\x00trailer\n');
    },
  },
  {
    name: 'declaration staged, then emptied on disk',
    expect: 'accept',
    // The mirror direction, and the reason this is a SCOPE bug rather than a
    // missing check: the commit is complete and correct, so a later edit to the
    // working copy must not change the verdict.
    setup: (root) => {
      stage(
        root,
        'packages/testing/fixtures/PROVENANCE.md',
        '# Fixture provenance\n\n- `rotated.pdf` — self-generated\n',
      );
      stage(root, 'packages/testing/fixtures/rotated.pdf', '%PDF-1.7\n\x00trailer\n');
      writeUnstaged(root, 'packages/testing/fixtures/PROVENANCE.md', '');
    },
  },
  {
    name: 'undeclared fixture whose name is a suffix of a declared one',
    expect: 'reject',
    because: 'not declared in',
    // The substring defect. `includes('rotated.pdf')` is true of a document that
    // only ever mentions `form-rotated.pdf`, so declaring one fixture silently
    // declared every fixture whose name ends with it — at both scopes, so
    // nothing caught it.
    setup: (root) => {
      stage(
        root,
        'packages/testing/fixtures/PROVENANCE.md',
        '# Fixture provenance\n\n- `form-rotated.pdf` — self-generated\n',
      );
      stage(root, 'packages/testing/fixtures/rotated.pdf', '%PDF-1.7\n\x00trailer\n');
    },
  },

  // ---------------------------------------------------------------------------
  // Where the guard is rooted.
  //
  // The two commands this guard uses do NOT behave alike, and the difference is
  // the whole finding. `git diff --cached` reports the entire index whatever the
  // working directory is, so the staged scope was never exposed. `git ls-files`
  // defaults its pathspec to `.`, so the TREE scope — the CI mirror, the one
  // check that inspects everything already committed — inspected only what
  // happened to sit below the caller's directory and reported "ok" for the rest.
  //
  // Measured in this repository: 3 files listed from packages/ui, 100 from the
  // root. A guard that examines 3% of the tree and prints a clean bill is worse
  // than no guard, because someone is relying on it.
  //
  // The scopeControl() below exists because the first version of these two cases
  // used --staged and passed with or without the fix. The control is what said so.
  // ---------------------------------------------------------------------------
  {
    name: 'tracked violation at the root, tree scope invoked from a subdirectory',
    expect: 'reject',
    because: 'is an executable',
    runFrom: 'packages/ui/src',
    scope: '--tree',
    setup: (root) => {
      mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
      stage(root, 'packages/ui/src/index.ts', 'export const ui = true;\n');
      stage(root, 'tool.dat', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
      git(root, ['commit', '--quiet', '--no-verify', '-m', 'introduce a tracked violation']);
    },
  },
  {
    name: 'clean tracked tree, tree scope invoked from a subdirectory',
    expect: 'accept',
    runFrom: 'packages/ui/src',
    scope: '--tree',
    setup: (root) => {
      mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
      stage(root, 'packages/ui/src/index.ts', 'export const ui = true;\n');
      stage(root, 'notes.md', '# notes\n');
      git(root, ['commit', '--quiet', '--no-verify', '-m', 'clean tree']);
    },
  },
];

/**
 * The control for the two cases above: confirm `git ls-files` really is
 * path-limited by the working directory.
 *
 * Without this, both cases would still pass if `repoRoot()` were deleted and git
 * turned out to be scope-agnostic — which is exactly what happened on the first
 * attempt. Those cases were written against `git diff --cached`, which reports
 * the whole index from anywhere, so they were green before the fix and green
 * after it. This control is the only reason that was noticed.
 *
 * @returns {string[]}
 */
function scopeControl() {
  const root = makeRepo();
  try {
    mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
    stage(root, 'packages/ui/src/index.ts', 'export const ui = true;\n');
    stage(root, 'tool.dat', Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    git(root, ['commit', '--quiet', '--no-verify', '-m', 'tracked']);

    const listFrom = (/** @type {string} */ cwd) =>
      `${spawnSync('git', ['ls-files'], { cwd, encoding: 'utf8' }).stdout ?? ''}`
        .trim()
        .split('\n')
        .filter(Boolean);

    const rootPaths = listFrom(root);
    const subPaths = listFrom(join(root, 'packages/ui/src'));

    if (rootPaths.length <= subPaths.length || subPaths.includes('tool.dat')) {
      return [
        'CONTROL: `git ls-files` was expected to be path-limited by the working directory, ' +
          `but it returned ${rootPaths.length} path(s) from the root and ${subPaths.length} ` +
          `from a subdirectory. If it is not path-limited, the two tree-scope cases above pass ` +
          'whether or not the guard resolves the repository root, and they prove nothing.',
      ];
    }
    process.stdout.write(
      `  ok  control git ls-files is path-limited: ${rootPaths.length} tracked path(s) from ` +
        `the root, ${subPaths.length} from packages/ui/src\n`,
    );
    return [];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  /** @type {string[]} */
  const failures = [...scopeControl()];

  for (const testCase of CASES) {
    const root = makeRepo();
    try {
      testCase.setup(root);
      const { ok, output } = runGuard(root, testCase.runFrom, testCase.scope);

      if (testCase.expect === 'accept' && !ok) {
        failures.push(`${testCase.name}: expected acceptance, guard rejected:\n${output}`);
      } else if (testCase.expect === 'reject' && ok) {
        failures.push(`${testCase.name}: expected rejection, guard accepted it.`);
      } else if (
        testCase.expect === 'reject' &&
        testCase.because !== undefined &&
        !output.includes(testCase.because)
      ) {
        failures.push(
          `${testCase.name}: rejected, but for the wrong stated reason.\n` +
            `  expected the message to mention: ${testCase.because}\n  got:\n${output}`,
        );
      } else {
        process.stdout.write(`  ok  ${testCase.expect.padEnd(6)} ${testCase.name}\n`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} guard proof failure(s):\n\n${failures.join('\n\n')}\n`);
    return 1;
  }
  process.stdout.write(`\n${CASES.length} guard cases passed.\n`);
  return 0;
}

process.exit(main());
