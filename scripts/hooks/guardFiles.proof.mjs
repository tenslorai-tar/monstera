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
 * @param {string} root
 * @returns {{ ok: boolean, output: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [GUARD, '--staged'], { cwd: root, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * @typedef {{
 *   name: string,
 *   expect: 'reject' | 'accept',
 *   because?: string,
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
    name: 'text file containing a mangled escape sequence',
    expect: 'reject',
    because: 'control character 0x07',
    // The exact corruption that reached a commit here: `\a` and `\b` inside a
    // non-raw Python string became BEL and BACKSPACE, and `C:\a\b.pdf` rendered
    // as `C:.pdf` — the characters appear to vanish rather than look wrong, so
    // a review reads straight past it.
    setup: (root) => stage(root, 'notes.md', `A Windows path: C:${String.fromCharCode(7, 8)}.pdf\n`),
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
];

function main() {
  /** @type {string[]} */
  const failures = [];

  for (const testCase of CASES) {
    const root = makeRepo();
    try {
      testCase.setup(root);
      const { ok, output } = runGuard(root);

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
