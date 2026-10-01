// @ts-check
/**
 * Do answers larger than a frame cross, in a file, through BOTH real engine hosts — and does Edit text work through the
 * real PDFium host on a page drawn one text object per glyph?
 *
 * ## The failure this closes
 *
 * The owner's install of 0.1.5.0 (2026-09-30) ended the PDFium host on their own documents: the page's text-runs
 * answer was 663,815 bytes against a 262,144-byte frame, and the host ended rather than send what it could not frame
 * ([ADR-0125](../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)). The answer now
 * crosses in a file. No proof drove a real PDFium host through `main` before this — the adapter proofs run PDFium in
 * their own process and the body cases stub the host, so the transport between them, where the failure lived, was
 * crossed by neither.
 *
 * ## Its control is the input, asserted
 *
 * The child measures the page's text-runs answer with the reader the host runs, and the first case requires it to
 * exceed the frame. A page that fitted would pass every other case here and say nothing about the route — which is
 * `CLAUDE.md`'s rule that a negative probe's input must be one the absent guard would have failed on, turned round:
 * this input must be one the OLD build failed on. With the route removed (`fileAnswered` → `channel` on
 * `engine/text-runs`), the host ends at the blocks case, as the owner's did.
 *
 * `hostRecovery.mjs`' shape otherwise: the cell needs Win32, the pinned Electron binary, the built shell, the shim,
 * PDFium and the container grants, reports UNVERIFIABLE through `unverifiable.mjs` wherever one is missing, and
 * `--require-containment` turns that into a failure.
 *
 * **The MuPDF host, the one that holds the document**, is driven with a generated 5,000-field form: a 3,000-field
 * form's list answered 531,355 bytes when measured, over a frame, and a host ending there would take the document's
 * session with it. Its control is the same: the answer is measured and must exceed a frame. Five thousand is past one
 * part of `document.formFields`, so the list reaches the harness in two parts cut by main's own handler (ADR-0130).
 *
 * **Undo's pair** (ADR-0125's addendum) is driven by rotating every page of a generated 10,000-page document and undoing
 * it: the capture answers in a file and the undo sends the same prior back as `engine/invert`'s request in one. The
 * control is again the input — the prior is measured with the kernel's own capture and must exceed a frame — and both
 * ends are read back through the view model, so a rotate that never applied or an undo that restored nothing is red.
 *
 * `--document <path>` runs the PDFium sequence on a copy of that file instead — made in the run's scratch folder, so the
 * file named is never written, and reported as outcomes and counts only. For a person's own file they allowed to be
 * opened, which is how the owner's failing document was re-run; the committed proof is the generated page.
 *
 * Usage: node scripts/research/hostFileAnswersLive.mjs [--require-containment] [--document <path>]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HOST_FILE_ANSWERS_LIVE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { shimBuildState, shimEnvironment } from '../lib/shimBinary.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { pdfiumEnvironment, pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'hostFileAnswersLiveHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);

const REQUIRE_CONTAINMENT = process.argv.includes('--require-containment');
const documentFlag = process.argv.indexOf('--document');
const DOCUMENT = documentFlag === -1 ? undefined : process.argv[documentFlag + 1];

/** The cases, named, so the unverifiable branch can list them and the count is independent. */
const CASES = [
  'CONTROL: the page’s text-runs answer is larger than a frame can carry, so the old build could not answer it',
  'the one-object-per-glyph page opened',
  'the real PDFium host answered the page’s text blocks, holding every run',
  'the edit applied through the real PDFium host',
  'the edited document saved',
  'reopened, the edited block reads what was typed',
  'no host ended and no incident was recorded during the run',
  'CONTROL: and the harness process itself exited CLEANLY',
  'CONTROL: the generated form’s field list is larger than a frame can carry',
  'the real MuPDF host answered the 5,000-field form’s field list, whole, and main handed it over in parts',
  'CONTROL: rotating every page of the 10,000-page document captures a prior larger than a frame can carry',
  'the real MuPDF host rotated every page, first and last read back turned',
  'undo sent the prior back through the real MuPDF host, and first and last read back upright',
  'CONTROL: the generated page draws its inline picture before any edit',
  'the inline-picture page, edited through the compose and PDFium hosts and saved, still draws its picture',
  'the Word export, composed in the real MuPDF host and moved by main, carries both pictures, the first between its paragraphs',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 16 });
if (CASES.length !== 16) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 16`);

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @returns {string[]} the granted paths the container cannot read */
function ungrantedPaths() {
  if (process.platform !== 'win32') return [];
  return inspect({ root: ROOT })
    .filter((entry) => entry.present === false)
    .map((entry) => entry.path);
}

const ungranted = process.platform === 'win32' ? ungrantedPaths() : [];
const shim = shimBuildState({ root: ROOT });
const pdfiumPresent = existsSync(pdfiumLibrary(ROOT));
const runnable =
  process.platform === 'win32' && existsSync(ELECTRON_BINARY) && shim.current && pdfiumPresent && ungranted.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The PDFium host is a Win32 AppContainer process (ADR-0022), so there is nothing to run on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? 'The pinned Electron binary is absent. Run `npm run provision:electron`.'
        : !shim.current
          ? `The MuPDF shim the hosts load is not usable: ${shim.reason}`
          : !pdfiumPresent
            ? 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'
            : `The container cannot read ${String(ungranted.length)} of its granted path(s):\n  ` +
              `${ungranted.join('\n  ')}\n  Run \`npm run provision:grants\`.`;
  exitUnverifiable({
    required: REQUIRE_CONTAINMENT,
    subject: 'answers through both real hosts',
    why:
      `${String(CASES.length)} case(s) could not be evaluated:\n` +
      `${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ${why}`,
    flag: '--require-containment',
  });
} else {
  // THE BUILT SHELL AND HOSTS ARE THE SUBJECT, so a stale build would run yesterday's route under today's name.
  refuseStaleBuild(ROOT, HOST_FILE_ANSWERS_LIVE, 4);

  // A FILE AND INHERITED STDIO, for `hostRecovery.mjs`' measured reason: the hosts inherit this child's handles, so a
  // piped stdout would hold the driver open.
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-file-answers-driver-'));
  const reportPath = join(scratch, 'report.json');
  /** @type {any} */
  let seen;
  /** @type {{ status: number | null, signal: string | null } | undefined} */
  let exited;
  try {
    const result = spawnSync(ELECTRON_BINARY, DOCUMENT === undefined ? [CHILD, reportPath] : [CHILD, reportPath, DOCUMENT], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 180_000,
      env: {
        ...process.env,
        ...shimEnvironment({ root: ROOT }),
        ...pdfiumEnvironment(ROOT),
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
    if (result.error !== undefined) {
      throw new Error(`could not run ${CHILD} under ${ELECTRON_BINARY}`, { cause: result.error });
    }
    exited = { status: result.status, signal: result.signal };
    if (!existsSync(reportPath)) {
      throw new Error(
        `the harness wrote no report (exit ${String(result.status)}). A line beginning ` +
          'MONSTERA_FILE_ANSWERS_LIVE_FAILED above is the harness refusing; none means it never started.',
      );
    }
    seen = JSON.parse(readFileSync(reportPath, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  check(
    CASES[0] ?? '',
    typeof seen.runsAnswerBytes === 'number' && seen.runsAnswerBytes > seen.frameMaxBytes,
    `the page's text-runs answer measured ${String(seen.runsAnswerBytes)} bytes against a frame of ` +
      `${String(seen.frameMaxBytes)}. A page that fits proves nothing about the file route — make it denser.`,
  );
  check(CASES[1] ?? '', seen.opened === 'opened', `document.open answered ${JSON.stringify(seen.opened)}.`);
  check(
    CASES[2] ?? '',
    typeof seen.blocks?.count === 'number' &&
      seen.blocks.count > 0 &&
      seen.uprightRunCount > 0 &&
      seen.blockRuns === seen.uprightRunCount,
    `document.textBlocks answered ${JSON.stringify(seen.blocks)} holding ${String(seen.blockRuns)} run(s) against ` +
      `${String(seen.uprightRunCount)} upright of ${String(seen.runCount)} on the page (text at an angle is left out ` +
      "by design). An error here is the owner's failure: read the failures case below.",
  );
  check(CASES[3] ?? '', seen.edited === 'ok', `document.execute(editTextBlock) answered ${JSON.stringify(seen.edited)}.`);
  check(CASES[4] ?? '', seen.saved === 'saved', `document.save answered ${JSON.stringify(seen.saved)}.`);
  check(
    CASES[5] ?? '',
    seen.reopenedHasEdit === true,
    `after reopening, the blocks answered ${JSON.stringify(seen.reopenedBlocks)} and no block reads the edit.`,
  );
  check(
    CASES[6] ?? '',
    Array.isArray(seen.failures) && seen.failures.length === 0,
    `the shell recorded: ${JSON.stringify(seen.failures)}`,
  );
  check(
    CASES[7] ?? '',
    exited !== undefined && exited.status === 0 && exited.signal === null,
    `the harness exited ${String(exited?.status)}${exited?.signal == null ? '' : ` on ${exited.signal}`} ` +
      'after writing its report. Read its stderr above.',
  );

  check(
    CASES[8] ?? '',
    typeof seen.formAnswerBytes === 'number' && seen.formAnswerBytes > seen.frameMaxBytes,
    `the form's field-list answer measured ${String(seen.formAnswerBytes)} bytes against a frame of ` +
      `${String(seen.frameMaxBytes)}. A form that fits proves nothing about the file route.`,
  );
  check(
    CASES[9] ?? '',
    seen.formFields?.count === seen.formFieldCount && seen.formFields?.parts >= 2 && seen.formFields?.truncated === false,
    `document.formFields answered ${JSON.stringify(seen.formFields)} against ${String(seen.formFieldCount)} fields ` +
      'in the form. An error here, with the failures case red, is the MuPDF host ending on the answer.',
  );

  check(
    CASES[10] ?? '',
    typeof seen.captureAnswerBytes === 'number' && seen.captureAnswerBytes > seen.frameMaxBytes,
    `rotating all ${String(seen.rotatedPages)} pages captured ${String(seen.captureAnswerBytes)} bytes against a frame ` +
      `of ${String(seen.frameMaxBytes)}. A prior that fits proves nothing about either file route — add pages.`,
  );
  check(
    CASES[11] ?? '',
    seen.rotateOpened === 'opened' && seen.rotated === 'ok' && JSON.stringify(seen.rotatedView) === '[90,90]',
    `opened ${JSON.stringify(seen.rotateOpened)}, the rotate answered ${JSON.stringify(seen.rotated)} and the first ` +
      `and last pages read ${JSON.stringify(seen.rotatedView)}. An error with the failures case red is the host ending ` +
      'on the capture.',
  );
  check(
    CASES[12] ?? '',
    seen.undone === 'undone' && JSON.stringify(seen.undoneView) === '[0,0]',
    `undo answered ${JSON.stringify(seen.undone)} and the first and last pages read ${JSON.stringify(seen.undoneView)}. ` +
      'An error with the failures case red is the host ending on the invert.',
  );

  check(
    CASES[13] ?? '',
    seen.inlineBefore === true,
    'the generated page does not draw its red picture even before an edit, so the case after it measures nothing.',
  );
  check(
    CASES[14] ?? '',
    seen.inlineOpened === 'opened' &&
      seen.inlineEdited === 'ok' &&
      seen.inlineSaved === 'saved' &&
      seen.inlineAfter === true &&
      String(seen.inlineText).includes('Edited'),
    `opened ${JSON.stringify(seen.inlineOpened)}, edited ${JSON.stringify(seen.inlineEdited)}, saved ` +
      `${JSON.stringify(seen.inlineSaved)}; after the reopen the picture is ${seen.inlineAfter === true ? 'drawn' : 'GONE'} ` +
      `and the text reads "${String(seen.inlineText)}". An inline-images-left line in the failures case says why.`,
  );
  check(
    CASES[15] ?? '',
    seen.wordExported === 'copied' && seen.wordPictures === 2 && seen.wordInOrder === true,
    `document.exportWord answered ${JSON.stringify(seen.wordExported)}; the package holds ${String(seen.wordPictures)} ` +
      `picture(s) and the first is ${seen.wordInOrder === true ? '' : 'NOT '}between its paragraphs. An error with the ` +
      'failures case red is the host ending on the export.',
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} file-answer case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('file-answer case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
