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

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The git scope this guard reads is a decision, not an implementation detail —
// see scripts/lib/gitScope.mjs for the four scopes, where they are rooted, and
// why reaching for the filesystem instead is almost always the wrong question.
import { git, readStagedBlob, repoRoot } from '../lib/gitScope.mjs';

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
 * The fixture names a PROVENANCE.md actually declares.
 *
 * ANCHORED, and a set rather than a substring search. The previous form asked
 * whether the whole document `includes()` the filename, so declaring
 * `form-rotated.pdf` silently declared an entirely different, undeclared
 * `rotated.pdf` — every name is a substring of every name that ends with it.
 * That held at both the staged and tree scopes, so nothing caught it.
 *
 * A declaration is a markdown list item or table cell naming the file, so the
 * name is matched between a boundary and its extension rather than anywhere in
 * the text.
 *
 * @param {Buffer} document
 * @returns {Set<string>} Fixture paths relative to FIXTURE_ROOT.
 */
function declaredFixtures(document) {
  /** @type {Set<string>} */
  const declared = new Set();
  for (const match of document.toString('utf8').matchAll(/(?:^|[\s`|(/])([\w./-]+\.pdf)\b/gim)) {
    const name = match[1];
    if (name === undefined) continue;
    declared.add(name.startsWith(FIXTURE_ROOT) ? name.slice(FIXTURE_ROOT.length) : name);
  }
  return declared;
}

/**
 * PROVENANCE.md from disk, for the tree scope only.
 *
 * Resolved against the repository, not the caller's directory: a relative read
 * makes the answer depend on where the guard was invoked from, so running it
 * one directory down would report every fixture as undeclared.
 *
 * @returns {Buffer | null}
 */
function readDiskProvenance() {
  const absolute = join(repoRoot(), PROVENANCE_FILE);
  return existsSync(absolute) ? readFileSync(absolute) : null;
}

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
 * Tab, LF and CR are legitimate text. **Everything else, NUL included.**
 *
 * NUL used to be excluded here, on the reasoning that `looksBinary` keys on it
 * so it is already handled as a type question rather than a corruption one.
 * That sentence is true only for the **first 8000 bytes**, which is all
 * `looksBinary` reads. Past that window nothing checked NUL at all.
 *
 * This is the same defect this check already fixed once, arriving as one
 * reasonable-looking exception. The repair split the sniff window from the
 * corruption scan for every C0 byte **except the one it delegated away** — and
 * the delegation target still had the limitation the repair existed to correct.
 * Fixing the class means not leaving a byte behind on someone else's window.
 *
 * A NUL found here is by construction one `looksBinary` could not see, so both
 * readings — a corrupt text file, or a binary the type check misclassified —
 * warrant rejection, and the message names both rather than picking one.
 *
 * @param {Buffer} bytes
 * @returns {number} Index of the first offending byte, or -1.
 */
function findControlCharacter(bytes) {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) continue;
    if (byte < 0x09 || byte === 0x0b || byte === 0x0c) return index;
    if ((byte >= 0x0e && byte <= 0x1f) || byte === 0x7f) return index;
  }
  return -1;
}

/**
 * Codepoints that change how text READS without changing what it CONTAINS.
 *
 * Two families, one property, and the property is the reason they belong in the
 * same check as the C0 scan above rather than in a separate one:
 *
 * - **Bidirectional overrides and isolates** (`U+202A`–`U+202E`,
 *   `U+2066`–`U+2069`, `U+061C`). These reorder the glyphs a reader sees while
 *   leaving the codepoint sequence a compiler consumes untouched. That is
 *   Trojan Source, CVE-2021-42574: a comment that renders as if it ends where it
 *   does not, so a line the reviewer reads as inert is compiled as code.
 * - **Zero-width and invisible characters** (`U+200B`–`U+200D`, `U+2060`,
 *   `U+FEFF`, `U+00AD`). These render as nothing at all, so two identifiers
 *   that look identical are different symbols — the homoglyph attack's quieter
 *   sibling, and the reason `U+00AD` (a *soft hyphen*, invisible unless the
 *   line wraps) is here beside the more obvious ones.
 *
 * ## Why this belongs to this guard specifically
 *
 * `findControlCharacter`'s stated purpose is text carrying characters that are
 * **invisible to a reader** — its message says the surrounding text "simply
 * appears to lose characters". This is that purpose, one codepoint range short.
 * The scan was C0 plus `0x7f` because it reads raw bytes, and every codepoint
 * here is a multi-byte UTF-8 sequence, so the whole class was not merely
 * unchecked but *unreachable* by the check's own shape.
 *
 * And it matters here more than it would elsewhere. This repository's premise is
 * that the world reads the code, under AGPL, with outside contributions
 * arriving. **Review integrity is precisely what these characters attack**, and
 * a guard protecting a public repository's readability is the right place for
 * them — see `docs/security/THREAT-MODEL.md`, which previously covered supply
 * chain only as a malicious upstream release.
 *
 * @type {ReadonlySet<number>}
 */
const DECEPTIVE_CODEPOINTS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // LRE RLE PDF LRO RLO
  0x2066, 0x2067, 0x2068, 0x2069, // LRI RLI FSI PDI
  0x061c, // ARABIC LETTER MARK
  0x200b, 0x200c, 0x200d, // ZWSP ZWNJ ZWJ
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BOM anywhere
  0x00ad, // SOFT HYPHEN
]);

/**
 * The first {@link DECEPTIVE_CODEPOINTS} member in `bytes`, or `null`.
 *
 * **Decodes**, where the C0 scan reads bytes. That is not a stylistic
 * difference: a byte-wise scan cannot express these at all, which is why the
 * class was invisible rather than merely unlisted.
 *
 * Reported by codepoint and by the line it sits on rather than by byte offset,
 * because the whole difficulty with these characters is finding them once you
 * know they are there — an offset into a decoded string does not locate one in
 * an editor.
 *
 * @param {Buffer} bytes
 * @returns {{ codepoint: number, line: number } | null}
 */
function findDeceptiveCodepoint(bytes) {
  const text = bytes.toString('utf8');
  let line = 1;
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) continue;
    if (DECEPTIVE_CODEPOINTS.has(codepoint)) return { codepoint, line };
    if (character === '\n') line += 1;
  }
  return null;
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
 * Escape-resolving invocations, matched against a manifest's `scripts` values.
 *
 * Deliberately narrower than the PreToolUse hook's patterns. That hook judges a
 * command someone is about to run and can afford breadth, because a false
 * positive costs one retry. This judges a file that must be committed, so a
 * false positive blocks a commit — and the forms below are the ones with no
 * legitimate use in a package script.
 *
 * `sed -n` and a bare `grep` are not here, for the same reason the hook permits
 * them: a guard that blocks the commands a project runs constantly is a guard
 * somebody turns off.
 *
 * @param {Buffer} blob
 * @returns {string[]}
 */
function bannedScriptForms(blob) {
  /** @type {{ scripts?: Record<string, unknown> }} */
  let manifest;
  try {
    manifest = JSON.parse(blob.toString('utf8'));
  } catch {
    // Not this rule's business. A malformed manifest fails the build elsewhere,
    // and reporting it here would blame the wrong check.
    return [];
  }

  /** @type {Array<{ pattern: RegExp, form: string }>} */
  const banned = [
    { pattern: /\bnode\s+(?:-e|--eval|-p|--print)\b/u, form: 'node -e / --eval / -p' },
    { pattern: /\bpython3?\s+-c\b/u, form: 'python -c' },
    { pattern: /\b(?:perl|ruby|php)\s+-e\b/u, form: 'perl/ruby/php -e' },
    { pattern: /\bsed\s+(?:-[a-zA-Z]*i|--in-place)\b/u, form: 'sed -i' },
    { pattern: /\b(?:echo|printf|awk)\b[^|;&]*(?<![02-9>])>{1,2}\s*(?!&[0-9-])\S/u, form: 'echo/printf/awk redirected to a file' },
    { pattern: /\|\s*tee\b/u, form: 'piped to tee' },
    { pattern: /<<\s*[A-Za-z_"']/u, form: 'heredoc' },
    { pattern: /\b(?:Set-Content|Out-File|Add-Content)\b/u, form: 'PowerShell Set-Content / Out-File' },
  ];

  /** @type {string[]} */
  const reasons = [];
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    for (const { pattern, form } of banned) {
      if (!pattern.test(command)) continue;
      reasons.push(
        `declares script "${name}" using ${form}, which resolves escape sequences. npm hides this ` +
          `from the PreToolUse guard — it sees "npm run ${name}", never the invocation inside — so ` +
          `a package script is a channel the guard cannot reach and this check is what closes it. ` +
          `Put the program in a file and run it by path, as scripts/clean.mjs does.`,
      );
    }
  }
  return reasons;
}

/**
 * @param {string} path
 * @param {string} sha
 * @param {number} size Size of the blob in bytes; -1 means "not a blob".
 * @param {'staged' | 'tree' | 'history'} scope Which git scope the caller is checking.
 * @returns {string[]} Human-readable reasons this path may not be committed.
 */
function violations(path, sha, size, scope) {
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
  // Tab, LF and CR are excluded — they are legitimate text. NUL is INCLUDED,
  // and used not to be: it was delegated to `looksBinary`, which reads only the
  // sniff window, so a NUL past byte 8000 was checked by nothing. That is this
  // check's own defect repeating on the one byte it handed away — see
  // `findControlCharacter`.
  if (!looksBinary(head)) {
    const at = findControlCharacter(blob);
    if (at !== -1) {
      const byte = blob[at] ?? 0;
      reasons.push(
        byte === 0x00
          ? `contains a NUL byte at byte ${at}, past the ${String(SNIFF_BYTES)}-byte window the ` +
            `type check reads — so it was classified as text without anything having looked ` +
            `there. Either it is a text file corrupted by a tool that resolved an escape, or it ` +
            `is a binary the type check could not recognise. Both are rejected; which one it is ` +
            `is for you to say, not for this guard to guess.`
          : `is a text file containing the control character 0x${byte.toString(16).padStart(2, '0')} ` +
            `at byte ${at}. These are nearly always a mangled escape sequence rather than intent, ` +
            `and they are invisible in most viewers — the surrounding text simply appears to lose ` +
            `characters.`,
      );
      // HOW TO REPAIR IT, printed here because this is where you meet the
      // problem and every obvious move fails silently. All three facts measured
      // 2026-08-23 against a file carrying one NUL:
      //
      //   - reading the file renders the byte as nothing, so the corruption is
      //     invisible in the text you are looking at;
      //   - a search-and-replace edit CANNOT match a span containing it, because
      //     the search text would have to contain the byte and no keyboard emits
      //     one. The report is "string to replace not found" for text you can
      //     see on screen, which reads as a stale file rather than a corrupt one;
      //   - a whole-file rewrite DOES clear it.
      reasons.push(
        `To repair it: rewrite the whole file, or — for a file too large to retype — ` +
          `\`git checkout HEAD -- <path>\` and re-apply the change. Do not try to edit the ` +
          `byte out in place: the edit cannot name it, and the failure looks like a stale ` +
          `file rather than a corrupt one.`,
      );
    }

    // The same purpose, one codepoint range further out. The scan above reads
    // bytes and so cannot express these at all; this one decodes.
    const deceptive = findDeceptiveCodepoint(blob);
    if (deceptive !== null) {
      const name = `U+${deceptive.codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
      reasons.push(
        `is a text file containing ${name} on line ${String(deceptive.line)}, a codepoint that ` +
          `changes how the text READS without changing what it contains. Bidirectional overrides ` +
          `reorder the glyphs a reviewer sees while the compiler consumes the original order ` +
          `(Trojan Source, CVE-2021-42574); zero-width characters make two different identifiers ` +
          `look identical. Neither is visible in a diff, which is exactly why they are rejected ` +
          `rather than flagged. If this codepoint is genuinely wanted — in a test fixture for ` +
          `this very class, say — the fixture must construct it numerically rather than carry it.`,
      );
    }
  }

  // A package.json script is a channel the PreToolUse hook structurally cannot
  // see. It inspects the command a tool is asked to run, and `npm run clean` is
  // what it sees — never the `node -e` inside the script. All six workspaces
  // carried exactly that, so the repository shipped six working copies of the
  // banned form in the one place the guard could not reach.
  //
  // Those six deleted rather than wrote, so nothing was corrupted. The reason to
  // close the channel is precedent: a rule with six sanctioned-looking
  // counter-examples inside the repository is one the next person cites instead
  // of follows.
  //
  // Scoped to `scripts` values rather than the whole file, because a dependency
  // NAME containing one of these substrings is not an invocation.
  if (path === 'package.json' || path.endsWith('/package.json')) {
    for (const reason of bannedScriptForms(blob)) reasons.push(reason);
  }

  if (extension === '.pdf') {
    if (!path.startsWith(FIXTURE_ROOT)) {
      reasons.push(
        `is a PDF outside ${FIXTURE_ROOT}. Documents belong in the fixture corpus so their ` +
          `provenance is auditable.`,
      );
    } else {
      // Read the DECLARATION from the same scope as the thing being declared.
      //
      // This used to read PROVENANCE.md off the working tree while every other
      // rule inspected staged blobs, so the verdict followed the disk in both
      // directions: a PDF staged with an unstaged declaration passed, and a
      // staged declaration whose disk copy was emptied failed. For a rule about
      // what a commit will contain, the file on disk is not the question.
      //
      // The tree scope has no index entry to read, so it falls back to disk
      // deliberately — there, the working tree IS the subject.
      const declarations =
        scope === 'staged' ? readStagedBlob(PROVENANCE_FILE) : readDiskProvenance();

      if (declarations === null) {
        reasons.push(
          `is a fixture but ${PROVENANCE_FILE} is not ${scope === 'staged' ? 'staged' : 'present'} ` +
            `to record its origin. Stage the declaration in the same commit as the fixture.`,
        );
      } else if (!declaredFixtures(declarations).has(path.slice(FIXTURE_ROOT.length))) {
        reasons.push(
          `is not declared in ${PROVENANCE_FILE}. Every fixture states whether it is ` +
            `self-generated or verifiably public domain; real-world documents are banned ` +
            `outright because a public push is permanent (Part J).`,
        );
      }
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

    for (const reason of violations(blob.path, blob.sha, sizes.get(blob.sha) ?? 0, scope)) {
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
