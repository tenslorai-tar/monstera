// @ts-check
/**
 * The one place that decides WHICH GIT SCOPE a guard reads, and says why.
 *
 * Two guards had the same defect independently, which is what makes it a class
 * rather than two bugs:
 *
 *   - `guardFiles.mjs` inspected staged BLOBS for every rule except the fixture
 *     provenance one, which read `PROVENANCE.md` off the WORKING TREE. Staging a
 *     PDF with an unstaged declaration passed; staging a declaration whose disk
 *     copy was emptied failed. The verdict followed the working tree in both
 *     directions, for a rule about what a commit will contain.
 *   - `documentConsistency.mjs` read `git ls-files`, which lists only what is
 *     already COMMITTED. A brand-new ADR staged alongside a missing index row
 *     was invisible until after the commit that should have caught it.
 *
 * Both are "the guard asked git a question whose answer is not the thing it is
 * guarding". So the scopes are named once here, with their semantics stated, and
 * a guard picks one deliberately instead of reaching for whichever git command
 * came to mind.
 *
 * ## The scopes
 *
 * - **staged** — what THIS COMMIT will contain. Blobs from the index, so
 *   `git add -p` and edit-after-add are handled correctly: only the staged bytes
 *   matter, never the file on disk.
 * - **commit** — the tree as the commit will leave it: everything already
 *   tracked, plus everything staged. This is what a check about *repository
 *   state* wants, and it is what `ls-files` alone gets wrong.
 * - **tree** — every tracked file at HEAD. The CI mirror.
 * - **history** — every blob reachable in the range, including blobs whose path
 *   no longer exists. Addressed by SHA, because a deleted object has no path.
 * - **uncommitted** — everything that differs from HEAD, **tracked or not**.
 *   The question "what have I changed since the last commit", which is what a
 *   pre-push report about coverage is asking. It is the only scope here that
 *   includes files git does not yet know about, and that is the whole reason it
 *   exists — see {@link uncommittedPaths}.
 *
 * A guard that reads the filesystem directly is choosing a sixth scope —
 * "whatever is on disk right now" — and that is almost never the question.
 *
 * ## Where the scope is rooted
 *
 * Every scope above is a question about THE REPOSITORY. Most git commands answer
 * about the current directory instead: `git ls-files` run from `packages/ui`
 * lists 3 files where the repository has 100. A guard inheriting an arbitrary
 * cwd therefore inspects a subtree and reports "ok" for the 97 files it never
 * looked at — a green check that verifies almost nothing, and one that gets
 * quieter the deeper the caller happens to be.
 *
 * So `git()` roots itself at the repository by default, and a caller wanting a
 * path-limited query has to say so. That ordering is deliberate: the safe
 * question is the one you get for free, and the narrow one costs a keystroke.
 */

import { spawnSync } from 'node:child_process';

/** @type {string | null} */
let cachedRoot = null;

/**
 * The repository, asked of git rather than derived from a script's own location.
 *
 * `resolve(__dirname, '..', '..')` is the tempting alternative and it is a
 * second answer to a question that must have one. It disagrees with git for a
 * linked worktree, for a submodule, and for any invocation where the scripts
 * directory is not two levels below the root — and it disagrees silently,
 * because both forms return a plausible absolute path.
 *
 * @returns {string}
 */
export function repoRoot() {
  if (cachedRoot !== null) return cachedRoot;
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Not inside a git work tree: ${`${result.stderr ?? ''}`.trim()}`);
  }
  cachedRoot = `${result.stdout}`.trim();
  return cachedRoot;
}

/**
 * @param {readonly string[]} args
 * @param {{ input?: string, binary?: boolean, cwd?: string }} [options]
 *   `cwd` defaults to the repository root. Pass it only to ask a deliberately
 *   path-limited question — see the note above on what inheriting the caller's
 *   directory costs.
 * @returns {{ stdout: string | Buffer }}
 */
export function git(args, options = {}) {
  const result = spawnSync('git', [...args], {
    input: options.input,
    cwd: options.cwd ?? repoRoot(),
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
 * Every path the commit will leave in the tree: tracked plus staged.
 *
 * Use this for any check about repository STATE — "is this ADR indexed", "does
 * every referenced script exist". `git ls-files` alone answers about the
 * previous commit, which means a check can only catch a mistake after the commit
 * that made it.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {string[]}
 */
export function filesInCommit(options = {}) {
  const tracked = `${git(['ls-files', '-z'], options).stdout}`.split('\0');
  const staged = `${
    git(['diff', '--cached', '--name-only', '--diff-filter=d', '-z'], options).stdout
  }`.split('\0');

  return [...new Set([...tracked, ...staged].filter((path) => path.length > 0))];
}

/**
 * @typedef {{
 *   state: string,
 *   path: string,
 *   from: string | null,
 * }} ChangedPath
 *   `state` is the single status letter with its similarity score stripped.
 *   `path` is the path the entry is ABOUT after the change — the destination for
 *   a rename or copy, the deleted path for a delete. `from` is the source of a
 *   rename or copy and `null` otherwise.
 */

/**
 * Parses `--name-status -z` output.
 *
 * ## Why this is shared rather than written twice
 *
 * It was written twice, and only one of them was right. `lockfileIntegrity.mjs`
 * passed `-z` and consumed three fields for `/^[RC]\d*$/`, with a control
 * proving a rename earlier in the list cannot hide a later dependency change.
 * `auditWatermark.mjs` passed neither flag and split on tab — so a rename became
 * one entry whose "path" was two paths joined by a tab, matching no state the
 * classifier recognised. Measured: a proof moved and edited (`R090`) reported in
 * NO column of the audit report, and `files` carried a path that does not exist.
 *
 * **Two opinions about the same porcelain is the finding**, not either bug.
 * Patching one in place leaves the third caller to repeat it, which is how this
 * module came to exist for git *scopes* in the first place.
 *
 * Three things `-z` settles at once, and only one of them is about renames:
 *
 *   - **rename and copy carry two paths.** A parser consuming one field falls
 *     out of alignment with the rest of the list and answers "no" quietly.
 *   - **delete is a state too.** A classifier recognising only `A` and `M`
 *     drops it, and unlike rename that can fire today.
 *   - **paths are C-quoted without it.** `core.quotePath` defaults true, so a
 *     path with any non-ASCII byte arrives as `"\303\251…"` — a real path that
 *     matches no glob and resolves to nothing. No such path exists in this
 *     repository today, which is an expiry to write down rather than a reason to
 *     leave the flag off.
 *
 * @param {string} stdout
 * @returns {ChangedPath[]}
 */
export function parseNameStatus(stdout) {
  const fields = stdout.split('\0').filter((field) => field !== '');

  /** @type {ChangedPath[]} */
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const raw = `${fields[index]}`;
    // R and C are the only states that carry a similarity score, and the only
    // ones followed by two paths. Consuming the right number of fields is what
    // keeps every LATER entry aligned — a misparse here is not a crash, it is a
    // quiet wrong answer about a different file.
    const pair = /^[RC]\d*$/u.test(raw);
    const first = `${fields[index + 1] ?? ''}`;
    const second = pair ? `${fields[index + 2] ?? ''}` : '';
    index += pair ? 2 : 1;

    entries.push({
      state: raw.charAt(0),
      path: pair ? second : first,
      from: pair ? first : null,
    });
  }
  return entries;
}

/**
 * `git diff --name-status -z <args>`, parsed.
 *
 * `-z` is added here rather than left to the caller: it is not a formatting
 * preference, it is the difference between a parser that can see a rename, a
 * delete and a non-ASCII path and one that cannot. See {@link parseNameStatus}.
 *
 * @param {readonly string[]} args Everything after `diff` — a range, `--cached`,
 *   a pathspec.
 * @param {{ cwd?: string }} [options]
 * @returns {ChangedPath[]}
 */
export function changedPaths(args, options = {}) {
  return parseNameStatus(
    `${git(['diff', '--name-status', '-z', ...args], options).stdout}`,
  );
}

/**
 * Every path that differs from HEAD, **including files git does not track yet**.
 *
 * ## Why `git diff` alone is the wrong question here, measured
 *
 * `git diff --name-only HEAD` reports tracked modifications and nothing else, so
 * a brand-new module — the ordinary shape of adding a feature — contributes
 * **nothing**. A caller asking "which proofs does my work reach" then gets an
 * empty set and prints *"nothing is changed against HEAD"*: the reassuring
 * answer, produced by a hole in the input rather than by a clean tree. Measured
 * on 2026-08-28, when `npm run local` said exactly that about a run whose only
 * subject was two untracked files.
 *
 * That is audit item 4b's failure — an empty result that is indistinguishable
 * from a genuine absence — arriving in the INPUT to a search rather than in the
 * search. A positive control on the walk's edges cannot see it, because the walk
 * is working perfectly on the set it was handed.
 *
 * ## Two commands rather than `git status --porcelain`
 *
 * `--porcelain -z` would answer both halves at once, and its framing is a THIRD
 * format this module would have to own — `XY <path>` with renames carrying two
 * NUL-separated paths in the opposite order to `--name-status`. Composing the
 * two scopes that already have parsers keeps the framing count at two (B3a).
 *
 * `--exclude-standard` is what stops `node_modules`, `dist` and `.cache` from
 * arriving as changes; without it this returns tens of thousands of paths and
 * every caller looks affected by everything.
 *
 * Renames report the **new** path, which is {@link parseNameStatus}' answer and
 * the right one here: the file a proof would now read is the destination.
 * Deletions report their path too — removing a source file changes which proofs
 * are owed a run just as surely as editing one.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {string[]} Repository-relative, forward-slashed by git, deduplicated.
 */
export function uncommittedPaths(options = {}) {
  const tracked = changedPaths(['HEAD'], options).map((entry) => entry.path);
  const untracked = `${git(['ls-files', '--others', '--exclude-standard', '-z'], options).stdout}`
    .split('\0')
    .filter((path) => path !== '');
  return [...new Set([...tracked, ...untracked])];
}

/**
 * The bytes of MANY paths as staged, in ONE git invocation.
 *
 * {@link readStagedBlob} spawns twice per path — a `cat-file -e` probe and a
 * `cat-file blob` — and on Windows a spawn costs more than the work. Measured
 * 2026-08-23: reading seven staged blobs that way took 2.2 s, against 154 ms for
 * the parser that consumed them, so the reader was fourteen times the cost of
 * the thing it fed. A pre-commit guard is where that matters.
 *
 * `git cat-file --batch` answers the same question in one process: a header line
 * per request, then the bytes, then a newline. A path that is not in the index
 * gets `<path> missing` instead, which is how absence arrives — and it is
 * reported as an absent entry rather than an empty one, for the same reason the
 * single reader returns null: a missing file and an empty one are different
 * failures.
 *
 * ONE PARSER FOR ONE FORMAT (B3a): this is the only place `--batch`'s framing is
 * read, beside the only place `--name-status` is read, in the module that exists
 * because two guards each asked git a question their own way.
 *
 * @param {readonly string[]} paths
 * @param {{ cwd?: string }} [options]
 * @returns {Map<string, Buffer>} Only the paths that are in the index.
 * @throws when the answer's framing does not line up with the request — see
 *   {@link parseStagedBatch}.
 */
export function readStagedBlobs(paths, options = {}) {
  if (paths.length === 0) return new Map();

  const { stdout } = git(['cat-file', '--batch'], {
    ...options,
    binary: true,
    input: `${paths.map((path) => `:${path}`).join('\n')}\n`,
  });
  return parseStagedBatch(stdout instanceof Buffer ? stdout : Buffer.from(stdout), paths);
}

/**
 * `--batch`'s framing, parsed — separated from the spawn so it can be driven.
 *
 * A framing failure cannot be produced by asking git for something: git answers
 * correctly, and what this guards against is the answer and the request drifting
 * apart. So the only way to exercise it is to hand the parser bytes, which is
 * what this separation is for and the whole of what it is for.
 *
 * @param {Buffer} buffer @param {readonly string[]} paths
 * @returns {Map<string, Buffer>}
 */
export function parseStagedBatch(buffer, paths) {
  /** @type {Map<string, Buffer>} */
  const blobs = new Map();

  let offset = 0;
  for (const [index, path] of paths.entries()) {
    const newline = buffer.indexOf('\n', offset);
    if (newline === -1) {
      throw desynchronised(index, paths.length, path, 'the stream ended');
    }
    const header = buffer.toString('utf8', offset, newline);
    offset = newline + 1;

    // `<request> missing` is git's own answer for a path that is not in the
    // index, and it echoes the request verbatim — so the miss is recognised by
    // EQUALITY with what was asked for, never by a pattern that a byte of some
    // other blob's content could satisfy. That is what separates *absent* from
    // *lost*, and the two are otherwise the same skipped entry.
    if (header === `:${path} missing`) continue;

    // `<sha> <type> <size>` for a hit. Anchored at the end, so a path
    // containing a space cannot break the size off the header.
    //
    // THE TYPE IS READ RATHER THAN ASSUMED, so that a path naming a tree or a
    // submodule's commit gets its own answer. That is a caller error and not a
    // lost offset, and reporting it as the latter would send the next reader
    // hunting a framing bug that is not there.
    const hit = /\s(blob|tree|commit|tag)\s+(\d+)$/u.exec(header);
    if (hit === null) {
      throw desynchronised(index, paths.length, path, `read ${JSON.stringify(header)}`);
    }
    if (hit[1] !== 'blob') {
      throw new Error(
        `git cat-file --batch: :${path} is a ${String(hit[1])}, not a blob. This reader answers ` +
          `about staged FILE contents; a directory or a submodule has none.`,
      );
    }
    const length = Number(hit[2]);
    blobs.set(path, buffer.subarray(offset, offset + length));
    // The bytes are followed by a newline git adds, which is not content.
    offset += length + 1;
  }
  return blobs;
}

/**
 * The error a lost offset raises, and why it is an error rather than a stop.
 *
 * ## An absent entry is a legitimate answer here and a broken read is not
 *
 * This parser walks ONE buffer with an offset it advances by each blob's
 * declared size. Every framing failure has the same consequence: the offset
 * stops pointing at a header, and every remaining path is dropped. The map then
 * comes back short.
 *
 * Its callers cannot tell that apart from absence. `emittedTemplates.mjs` and
 * `typeOnlyExports.mjs` both take their path list from {@link filesInCommit} —
 * `ls-files` plus staged additions, every entry of which resolves as `:path` —
 * and both skip a path the map does not carry. So a dropped tail arrives as
 * *those files contain no violations*, which is the answer both scans exist to
 * be able to give and the answer everybody wants. Their positive controls run
 * against in-memory fixtures **before** this read, so they prove the matcher can
 * see and say nothing about whether the reader delivered.
 *
 * Stopping quietly was this function's own choice — a `break` and a `continue`,
 * written when the batch reader replaced a per-path one whose failures were
 * per-path. Recorded as finding KKKK-1.
 *
 * The repair is placed HERE and not at the two call sites, because *what
 * `--batch`'s framing means* is this module's question (B3a). A caller checking
 * the map's size against its input would be a second opinion about it, and the
 * third caller would not have one.
 *
 * @param {number} index @param {number} total @param {string} path
 * @param {string} what
 * @returns {Error}
 */
function desynchronised(index, total, path, what) {
  return new Error(
    `git cat-file --batch: lost the framing at request ${String(index + 1)} of ` +
      `${String(total)} (${path}) — ${what}. A blob whose declared size does not match its ` +
      `bytes leaves the offset inside content, and every path after this one would be dropped ` +
      `silently. Callers read a short map as "those files were clean", so this throws instead.`,
  );
}

/**
 * The bytes of ONE path AS STAGED — from the index, never from disk.
 *
 * Returns null when the path is not in the index at all, which a caller must
 * distinguish from "staged and empty": a missing declaration file and an empty
 * one are different failures and deserve different messages.
 *
 * For more than a couple of paths use {@link readStagedBlobs}: this spawns git
 * twice per call, and on Windows that dominates everything downstream of it.
 *
 * @param {string} path
 * @param {{ cwd?: string }} [options]
 * @returns {Buffer | null}
 */
export function readStagedBlob(path, options = {}) {
  const probe = spawnSync('git', ['cat-file', '-e', `:${path}`], {
    cwd: options.cwd ?? repoRoot(),
  });
  if (probe.status !== 0) return null;

  const { stdout } = git(['cat-file', 'blob', `:${path}`], { ...options, binary: true });
  return stdout instanceof Buffer ? stdout : Buffer.from(stdout);
}
