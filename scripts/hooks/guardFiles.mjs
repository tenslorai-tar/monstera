// @ts-check
/**
 * File-content guard: rejects content that must never enter a public
 * repository's permanent history (invariant L15, Part J).
 *
 * Two scopes, one implementation, because Part J requires CI to run the same
 * check the hook runs and two implementations of one rule drift apart:
 *
 *   staged — what a commit would immortalise. It inspects staged *blobs*, not
 *            the working tree: `git add -p`, or an edit after `git add`, makes
 *            those differ, and only the blob is what gets committed.
 *   tree   — every tracked file. This is the CI mirror; it catches anything
 *            that reached the repository by a route the hook did not cover
 *            (a web edit, a merge, a contributor with hooks disabled).
 *
 * Three classes are rejected:
 *
 *   1. Anything over 5 MB. Fixtures larger than this are generated
 *      deterministically at test time instead (Part I, fixture size rule).
 *   2. Binary content whose extension is not on a short allowlist. The axis is
 *      binary-vs-text rather than an extension blocklist, because a blocklist
 *      fails open on the first extension nobody thought of — `pdfium.bin`, or
 *      an executable renamed to `.dat`. Text files pass freely; gitleaks
 *      covers the risk they carry.
 *   3. Executable images by magic bytes, whatever the extension claims. This
 *      is the check that makes rule 2 hard to sidestep by renaming.
 *
 * Plus one provenance rule: a committed PDF must live in the fixture corpus
 * and be declared in its PROVENANCE.md. Part J bans real-world documents as
 * fixtures — a PDF carrying a stranger's name becomes permanently public the
 * moment it is pushed — and a declaration file is the only part of that policy
 * a program can actually enforce.
 *
 * Usage: node scripts/hooks/guardFiles.mjs [--staged | --tree]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 5 * 1024 * 1024;

/** Git's own heuristic for "is this a binary file". */
const SNIFF_BYTES = 8000;

/**
 * Binary formats this repository legitimately stores: brand artwork, Playwright
 * screenshot baselines, the fixture corpus, and font files a text-fidelity
 * fixture may need. Everything else binary is rejected.
 */
const ALLOWED_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.pdf',
  '.ttf',
  '.otf',
  '.woff2',
]);

const FIXTURE_ROOT = 'packages/testing/fixtures/';
const PROVENANCE_FILE = `${FIXTURE_ROOT}PROVENANCE.md`;

/**
 * @typedef {{ name: string, bytes: readonly number[] }} Signature
 * @type {readonly Signature[]}
 */
const EXECUTABLE_SIGNATURES = [
  { name: 'Windows PE/DOS (MZ)', bytes: [0x4d, 0x5a] },
  { name: 'Linux ELF', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Mach-O 32-bit', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { name: 'Mach-O 64-bit', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: 'Mach-O reverse 32-bit', bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { name: 'Mach-O reverse 64-bit', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: 'Mach-O universal / Java class', bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: 'Static library archive', bytes: [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e] },
];

/**
 * @param {readonly string[]} args
 * @param {{ input?: string, binary?: boolean }} [options]
 * @returns {{ stdout: string | Buffer }}
 */
function git(args, options = {}) {
  const result = spawnSync('git', [...args], {
    input: options.input,
    encoding: options.binary === true ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run git ${args.join(' ')}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const stderr = result.stderr instanceof Buffer ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${stderr}`);
  }
  return { stdout: result.stdout ?? '' };
}

/**
 * @param {'staged' | 'tree'} scope
 * @returns {string[]}
 */
function collectPaths(scope) {
  const args =
    scope === 'staged'
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
      : ['ls-files', '-z'];
  return `${git(args).stdout}`.split('\0').filter((path) => path.length > 0);
}

/**
 * Blob sizes in one git invocation rather than one per file. Both scopes read
 * from the index: in a fresh checkout the index matches HEAD, so `:path`
 * resolves correctly for the tree scope too.
 *
 * @param {readonly string[]} paths
 * @returns {Map<string, number>}
 */
function blobSizes(paths) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  if (paths.length === 0) return sizes;

  const { stdout } = git(['cat-file', '--batch-check=%(objectsize)'], {
    input: `${paths.map((path) => `:${path}`).join('\n')}\n`,
  });
  const lines = `${stdout}`.trim().split('\n');
  paths.forEach((path, index) => {
    const size = Number.parseInt(`${lines[index]}`.trim(), 10);
    sizes.set(path, Number.isNaN(size) ? 0 : size);
  });
  return sizes;
}

/**
 * @param {string} path
 * @returns {Buffer}
 */
function blobHead(path) {
  const { stdout } = git(['cat-file', 'blob', `:${path}`], { binary: true });
  const buffer = stdout instanceof Buffer ? stdout : Buffer.from(stdout);
  return buffer.subarray(0, SNIFF_BYTES);
}

/**
 * @param {Buffer} head
 * @returns {boolean}
 */
function looksBinary(head) {
  return head.includes(0x00);
}

/**
 * @param {Buffer} head
 * @returns {string | null} The signature name, or null if none matched.
 */
function executableSignature(head) {
  for (const { name, bytes } of EXECUTABLE_SIGNATURES) {
    if (head.length < bytes.length) continue;
    if (bytes.every((byte, index) => head[index] === byte)) return name;
  }
  return null;
}

/**
 * @param {string} path
 * @param {number} size Size of the blob in bytes.
 * @returns {string[]} Human-readable reasons this path may not be committed.
 */
function violations(path, size) {
  /** @type {string[]} */
  const reasons = [];
  const extension = extname(path).toLowerCase();

  if (size > MAX_BYTES) {
    reasons.push(
      `${(size / (1024 * 1024)).toFixed(1)} MB exceeds the 5 MB limit. Large fixtures are ` +
        `generated at test time by a script, not committed (Part I, fixture size rule).`,
    );
    // Content checks are skipped: the file is already rejected, and reading it
    // whole to say so a second time helps nobody.
    return reasons;
  }

  const head = blobHead(path);
  const signature = executableSignature(head);

  if (signature !== null) {
    reasons.push(
      `starts with a ${signature} header — this is an executable. Native binaries are ` +
        `downloaded by scripts/provision/* against a pinned SHA-256, never committed (Part J).`,
    );
  } else if (looksBinary(head) && !ALLOWED_BINARY_EXTENSIONS.has(extension)) {
    reasons.push(
      `is binary content with extension "${extension || '(none)'}", which is not on the ` +
        `allowlist [${[...ALLOWED_BINARY_EXTENSIONS].join(' ')}]. If this file genuinely ` +
        `belongs in the repository, widen the allowlist in this guard in its own commit, ` +
        `with the reason.`,
    );
  }

  // Control characters in a text file are almost always silent corruption
  // rather than intent — a shell or a language escape that resolved when it
  // should not have. `\a` and `\b` inside a non-raw Python string become BEL and
  // BACKSPACE, and the result renders as though the characters simply vanished:
  // `C:\a\b.pdf` displays as `C:.pdf` in most viewers, so a review reads past
  // it. This guard exists because exactly that reached a commit in this
  // repository.
  //
  // Tab, LF and CR are excluded — they are legitimate text. NUL is not checked
  // here because it is what `looksBinary` keys on, so it is already handled.
  if (!looksBinary(head)) {
    const control = [...head].find(
      (byte) => (byte < 0x09 && byte > 0x00) || byte === 0x0b || byte === 0x0c || (byte >= 0x0e && byte <= 0x1f) || byte === 0x7f,
    );
    if (control !== undefined) {
      reasons.push(
        `is a text file containing the control character 0x${control.toString(16).padStart(2, '0')}. ` +
          `These are nearly always a mangled escape sequence rather than intent, and they are ` +
          `invisible in most viewers — the surrounding text simply appears to lose characters.`,
      );
    }
  }

  if (extension === '.pdf') {
    if (!path.startsWith(FIXTURE_ROOT)) {
      reasons.push(
        `is a PDF outside ${FIXTURE_ROOT}. Documents belong in the fixture corpus so their ` +
          `provenance is auditable.`,
      );
    } else if (!existsSync(PROVENANCE_FILE)) {
      reasons.push(`is a fixture but ${PROVENANCE_FILE} does not exist to record its origin.`);
    } else if (!readFileSync(PROVENANCE_FILE, 'utf8').includes(path.slice(FIXTURE_ROOT.length))) {
      reasons.push(
        `is not declared in ${PROVENANCE_FILE}. Every fixture states whether it is ` +
          `self-generated or verifiably public domain; real-world documents are banned ` +
          `outright because a public push is permanent (Part J).`,
      );
    }
  }

  return reasons;
}

/**
 * @param {'staged' | 'tree'} scope
 * @returns {string[]} One entry per violation; empty means clean.
 */
export function guardFiles(scope) {
  const paths = collectPaths(scope);

  const newlineInPath = paths.find((path) => path.includes('\n'));
  if (newlineInPath !== undefined) {
    return [`  ${JSON.stringify(newlineInPath)}\n      contains a newline in its path.`];
  }

  const sizes = blobSizes(paths);
  /** @type {string[]} */
  const failures = [];

  for (const path of paths) {
    for (const reason of violations(path, sizes.get(path) ?? 0)) {
      failures.push(`  ${path}\n      ${reason}`);
    }
  }
  return failures;
}

/**
 * @param {readonly string[]} failures
 * @param {'staged' | 'tree'} scope
 * @returns {string}
 */
export function formatFailures(failures, scope) {
  const headline =
    scope === 'staged'
      ? 'Commit blocked — staged content is not allowed in this repository:'
      : 'Tracked content is not allowed in this repository:';
  return (
    `\n${headline}\n\n${failures.join('\n\n')}\n\n` +
    `This repository is public from its first commit and GitHub retains commits by hash ` +
    `even after a history rewrite, so there is no later scrub. The guard runs before the ` +
    `mistake becomes permanent rather than after.\n\n`
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  /** @type {'staged' | 'tree'} */
  const scope = process.argv.includes('--tree') ? 'tree' : 'staged';
  const failures = guardFiles(scope);
  if (failures.length > 0) {
    process.stderr.write(formatFailures(failures, scope));
    process.exit(1);
  }
  process.stderr.write(`Guard passed (${scope} scope).\n`);
}
