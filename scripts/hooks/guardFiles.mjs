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
 * Blobs that are already in this repository's permanent history, cannot be
 * removed, and are recorded here rather than allowed to turn the history scope
 * red forever.
 *
 * These are the eight `docs/JOURNAL.md` revisions that carried the resolved
 * escape sequences described in that file's own entry — BEL and BACKSPACE where
 * `\a` and `\b` were written. The earliest carries 2 and the rest 4, which is
 * the corruption spreading through later edits of the same paragraph.
 *
 * B10 forbids rewriting published history, and GitHub retains objects by hash
 * regardless, so the sanctioned repair is a new commit: 45eb4fb repaired the
 * working file and widened the guard that had been blind to it. This list is the
 * record of what could not be undone, NOT an allowlist anything new may join —
 * a blob is added here only when it is already unreachable-but-retained, and the
 * commit that adds it says why.
 *
 * @type {ReadonlySet<string>}
 */
const KNOWN_HISTORICAL_BLOBS = new Set([
  '95fe6518d167398d3c5385cb47df3f24cf27c808',
  '6633e8f49263c9aad91683e1db26489f3035128b',
  'b01b6a29f498559dad31aa528915c281964bac72',
  '56f22e12e8cfe6f00543f66335810dff62e6e9fa',
  'bb47ba3dddb45736e75417869bd921ea9bbfa4d4',
  'cd3af618092111fa29fbfbd8cf39debff1042a59',
  '0bb674e513c0c5cecd38018f28d18dedc54aa71f',
  '339a4d62ea8bf2a1000a8ec35545e9503439f8bc',
]);

/**
 * @typedef {{ path: string, sha: string }} Blob
 */

/**
 * The blobs a scope must inspect, addressed by SHA rather than by path.
 *
 * By SHA because the history scope reaches objects that no longer have a path
 * in any tree — a blob committed and then deleted still exists, forever, and is
 * exactly what B10 is about.
 *
 * @param {'staged' | 'tree' | 'history'} scope
 * @param {string | undefined} range For the history scope, e.g. `origin/main..HEAD`.
 * @returns {Blob[]}
 */
function collectBlobs(scope, range) {
  if (scope === 'staged') {
    // `--diff-filter=d` EXCLUDES deletions, rather than listing the statuses to
    // include. The previous form named ACMR and so silently dropped `T`, a type
    // change — git's status for a symlink replaced by a regular file. That path
    // was removed before any check ran, which admitted every class this guard
    // blocks: oversized files, unlisted binaries, control characters, undeclared
    // fixtures. Naming the one status with no blob to inspect cannot omit a
    // status nobody thought of.
    const { stdout } = git(['diff', '--cached', '--raw', '--diff-filter=d', '-z']);
    return parseRawDiff(`${stdout}`);
  }

  if (scope === 'history') {
    // Every blob introduced by the range, whether or not it survives to the tip.
    const args = ['rev-list', '--objects', ...(range === undefined ? ['--all'] : [range])];
    const { stdout } = git(args);
    /** @type {Blob[]} */
    const blobs = [];
    for (const line of `${stdout}`.split('\n')) {
      const space = line.indexOf(' ');
      if (space === -1) continue;
      const sha = line.slice(0, space);
      const path = line.slice(space + 1).trim();
      if (path.length > 0) blobs.push({ path, sha });
    }
    return blobs;
  }

  // tree: every tracked file, with the SHA the index records.
  const { stdout } = git(['ls-files', '-s', '-z']);
  /** @type {Blob[]} */
  const blobs = [];
  for (const entry of `${stdout}`.split('\0')) {
    // `<mode> <sha> <stage>\t<path>`
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const fields = entry.slice(0, tab).split(/\s+/);
    const sha = fields[1];
    const path = entry.slice(tab + 1);
    if (sha !== undefined && path.length > 0) blobs.push({ path, sha });
  }
  return blobs;
}

/**
 * `git diff --raw -z` emits `:<srcmode> <dstmode> <srcsha> <dstsha> <status>\0<path>\0`,
 * with a second path for renames and copies.
 *
 * @param {string} stdout
 * @returns {Blob[]}
 */
function parseRawDiff(stdout) {
  const fields = stdout.split('\0').filter((field) => field.length > 0);
  /** @type {Blob[]} */
  const blobs = [];

  for (let index = 0; index < fields.length; index += 1) {
    const meta = fields[index];
    if (meta === undefined || !meta.startsWith(':')) continue;

    const parts = meta.slice(1).split(/\s+/);
    const dstSha = parts[3];
    const status = parts[4] ?? '';
    const path = fields[index + 1];
    index += 1;
    // R and C carry a second path field: the destination, which is what was
    // staged and therefore what must be inspected.
    if (/^[RC]/.test(status)) {
      const destination = fields[index + 1];
      index += 1;
      if (dstSha !== undefined && destination !== undefined) {
        blobs.push({ path: destination, sha: dstSha });
      }
      continue;
    }
    if (dstSha !== undefined && path !== undefined) blobs.push({ path, sha: dstSha });
  }
  return blobs;
}

/**
 * Blob sizes in one git invocation rather than one per object.
 *
 * @param {readonly Blob[]} blobs
 * @returns {Map<string, number>} Keyed by SHA.
 */
function blobSizes(blobs) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  if (blobs.length === 0) return sizes;

  const shas = [...new Set(blobs.map((blob) => blob.sha))];
  const { stdout } = git(['cat-file', '--batch-check=%(objecttype) %(objectsize)'], {
    input: `${shas.join('\n')}\n`,
  });
  const lines = `${stdout}`.trim().split('\n');
  shas.forEach((sha, index) => {
    const [type, size] = `${lines[index]}`.trim().split(' ');
    // Non-blobs (trees, commits) appear in rev-list output and are not content.
    sizes.set(sha, type === 'blob' ? Number.parseInt(`${size}`, 10) || 0 : -1);
  });
  return sizes;
}

/**
 * The whole blob.
 *
 * Reading all of it is affordable because the size rule above has already
 * rejected anything over 5 MB, so this is bounded by that limit rather than by
 * a sniff window.
 *
 * @param {string} sha
 * @returns {Buffer}
 */
function blobBytes(sha) {
  const { stdout } = git(['cat-file', 'blob', sha], { binary: true });
  return stdout instanceof Buffer ? stdout : Buffer.from(stdout);
}

/**
 * The first byte in `bytes` that is a C0 control character, or -1.
 *
 * Tab, LF and CR are legitimate text. NUL is excluded because `looksBinary`
 * keys on it, so it is already handled as a type question rather than a
 * corruption one.
 *
 * @param {Buffer} bytes
 * @returns {number} Index of the first offending byte, or -1.
 */
function findControlCharacter(bytes) {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) continue;
    if ((byte < 0x09 && byte > 0x00) || byte === 0x0b || byte === 0x0c) return index;
    if ((byte >= 0x0e && byte <= 0x1f) || byte === 0x7f) return index;
  }
  return -1;
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
 * @param {string} sha
 * @param {number} size Size of the blob in bytes; -1 means "not a blob".
 * @returns {string[]} Human-readable reasons this path may not be committed.
 */
function violations(path, sha, size) {
  /** @type {string[]} */
  const reasons = [];
  const extension = extname(path).toLowerCase();

  // Trees and commits reach the history scope through rev-list; they carry no
  // content to inspect.
  if (size < 0) return reasons;

  if (size > MAX_BYTES) {
    reasons.push(
      `${(size / (1024 * 1024)).toFixed(1)} MB exceeds the 5 MB limit. Large fixtures are ` +
        `generated at test time by a script, not committed (Part I, fixture size rule).`,
    );
    // Content checks are skipped: the file is already rejected, and reading it
    // whole to say so a second time helps nobody.
    return reasons;
  }

  const blob = blobBytes(sha);
  // The 8000-byte slice is git's own binary-detection heuristic and applies only
  // to the *type* questions below. The content scan reads the whole blob: see
  // the comment on the control-character check for what sharing one window cost.
  const head = blob.subarray(0, SNIFF_BYTES);
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
  // rather than intent — any tool that resolves escape sequences can write one.
  // `\a` and `\b` inside a non-raw Python string become BEL and BACKSPACE, and
  // the result renders as though the characters simply vanished: `C:\a\b.pdf`
  // displays as `C:.pdf` in most viewers, so a review reads past it.
  //
  // This scans the WHOLE blob, not the 8000-byte sniff window the type checks
  // use. It shared that window when it was written, which made it blind past
  // byte 8000 — and the corruption it was added to stop was already in
  // docs/JOURNAL.md at byte 26635, so the guard passed the very file that
  // motivated it, from the commit that introduced it, for its whole life. The
  // two questions need different amounts of the file: "is this binary" is a
  // property of the start, "is this corrupt" is a property of all of it.
  //
  // Tab, LF and CR are excluded — they are legitimate text. NUL is not checked
  // here because it is what `looksBinary` keys on, so it is already handled.
  if (!looksBinary(head)) {
    const at = findControlCharacter(blob);
    if (at !== -1) {
      const byte = blob[at] ?? 0;
      reasons.push(
        `is a text file containing the control character 0x${byte.toString(16).padStart(2, '0')} ` +
          `at byte ${at}. These are nearly always a mangled escape sequence rather than intent, ` +
          `and they are invisible in most viewers — the surrounding text simply appears to lose ` +
          `characters.`,
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
 * @param {'staged' | 'tree' | 'history'} scope
 * @param {string} [range] For the history scope; defaults to every reachable object.
 * @returns {string[]} One entry per violation; empty means clean.
 */
export function guardFiles(scope, range) {
  const blobs = collectBlobs(scope, range);

  const newlineInPath = blobs.find((blob) => blob.path.includes('\n'));
  if (newlineInPath !== undefined) {
    return [`  ${JSON.stringify(newlineInPath.path)}\n      contains a newline in its path.`];
  }

  const sizes = blobSizes(blobs);
  /** @type {string[]} */
  const failures = [];

  // One object may appear at several paths across history; inspecting it once is
  // enough, and reporting it once keeps the output readable.
  const seen = new Set();

  let knownHistorical = 0;

  for (const blob of blobs) {
    if (seen.has(blob.sha)) continue;
    seen.add(blob.sha);

    // Only the history scope reaches these, and only because they cannot be
    // removed. If one ever appears in the staged or tree scope it is NOT
    // historical — it has been reintroduced — so the exemption is scoped rather
    // than global.
    if (scope === 'history' && KNOWN_HISTORICAL_BLOBS.has(blob.sha)) {
      knownHistorical += 1;
      continue;
    }

    for (const reason of violations(blob.path, blob.sha, sizes.get(blob.sha) ?? 0)) {
      failures.push(`  ${blob.path}\n      ${reason}`);
    }
  }

  if (scope === 'history' && knownHistorical > 0) {
    // Printed, never silent. An exemption nobody sees is an exemption nobody
    // reviews.
    process.stderr.write(
      `Skipped ${knownHistorical} known-historical blob(s) that predate the repair in 45eb4fb ` +
        `and cannot be removed (B10). See KNOWN_HISTORICAL_BLOBS.\n`,
    );
  }

  return failures;
}

/**
 * @param {readonly string[]} failures
 * @param {'staged' | 'tree' | 'history'} scope
 * @returns {string}
 */
export function formatFailures(failures, scope) {
  const headline =
    scope === 'staged'
      ? 'Commit blocked — staged content is not allowed in this repository:'
      : scope === 'history'
        ? 'Content that is not allowed in this repository exists in its history:'
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
  /** @type {'staged' | 'tree' | 'history'} */
  const scope = process.argv.includes('--history')
    ? 'history'
    : process.argv.includes('--tree')
      ? 'tree'
      : 'staged';

  // `--range a..b` limits the history scope to what a pull request introduces.
  // Without it every reachable object is inspected, which is what a push to main
  // should do.
  const rangeFlag = process.argv.indexOf('--range');
  const range = rangeFlag === -1 ? undefined : process.argv[rangeFlag + 1];

  const failures = guardFiles(scope, range);
  if (failures.length > 0) {
    process.stderr.write(formatFailures(failures, scope));
    process.exit(1);
  }
  process.stderr.write(`Guard passed (${scope} scope${range === undefined ? '' : ` ${range}`}).\n`);
}
