// @ts-check
/**
 * Does a Markdown import compose in the REAL compose host, against running processes?
 *
 * ## The clause this closes
 *
 * D9's Markdown row is built and owes one run of the real host
 * ([ADR-0060](../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 * `compositionHost.test.ts` drives both import channels through a fake platform, so
 * a compose host created in its own AppContainer, taking its own containment verdict
 * and composing through its pipe is asserted there and executed by nothing. This
 * drives the shipped composition root with a real platform and reads the composed
 * page back through the real MuPDF host.
 *
 * ## Two sides, separated rather than trusted
 *
 * `hostRecovery.mjs`' shape: the cell needs Win32, the pinned Electron binary, the
 * built shell and the container grants, and reports UNVERIFIABLE through
 * `unverifiable.mjs` wherever one is missing. `--require-containment` turns that into
 * a failure, and it is what the Windows job passes.
 *
 * Usage: node scripts/research/composeHostLive.mjs [--require-containment]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMPOSE_HOST_LIVE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'composeHostLiveHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);

const REQUIRE_CONTAINMENT = process.argv.includes('--require-containment');

/** The cases, named, so the unverifiable branch can list them and the count is independent. */
const CASES = [
  'the real compose host composed the source and the file opened',
  'the file at the chosen destination is a PDF',
  'the real MuPDF host read the composed page and found every word',
  'CONTROL: a source that is not UTF-8 is refused by the real host, by name, and nothing is written',
  'CONTROL: and the harness process itself exited CLEANLY',
  'the real compose host set a CSV file as a table and the file opened',
  'the real MuPDF host read the CSV table and found every field',
  'the real compose host made one page per picked image, and the real MuPDF host counted them',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });
if (CASES.length !== 8) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 8`);

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
const runnable = process.platform === 'win32' && existsSync(ELECTRON_BINARY) && ungranted.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The compose host is a Win32 AppContainer process (ADR-0022), so there is nothing to run on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? 'The pinned Electron binary is absent. Run `npm run provision:electron`.'
        : `The container cannot read ${String(ungranted.length)} of its granted path(s):\n  ` +
          `${ungranted.join('\n  ')}\n  Run \`npm run provision:grants\`.`;
  exitUnverifiable({
    required: REQUIRE_CONTAINMENT,
    subject: 'the real compose host',
    why:
      `${String(CASES.length)} case(s) could not be evaluated:\n` +
      `${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ${why}`,
    flag: '--require-containment',
  });
} else {
  // THE BUILT SHELL IS THE SUBJECT, so a stale one would run yesterday's composition
  // root under today's name.
  refuseStaleBuild(ROOT, COMPOSE_HOST_LIVE, 4);

  // A FILE AND INHERITED STDIO, for `hostRecovery.mjs`' measured reason: the hosts
  // inherit this child's handles, so a piped stdout would hold the driver open.
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-compose-live-driver-'));
  const reportPath = join(scratch, 'report.json');
  /** @type {any} */
  let seen;
  /** @type {{ status: number | null, signal: string | null } | undefined} */
  let exited;
  try {
    const result = spawnSync(ELECTRON_BINARY, [CHILD, reportPath], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 180_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (result.error !== undefined) {
      throw new Error(`could not run ${CHILD} under ${ELECTRON_BINARY}`, { cause: result.error });
    }
    exited = { status: result.status, signal: result.signal };
    if (!existsSync(reportPath)) {
      throw new Error(
        `the harness wrote no report (exit ${String(result.status)}). A line beginning ` +
          'MONSTERA_COMPOSE_LIVE_FAILED above is the harness refusing; none means it never started.',
      );
    }
    seen = JSON.parse(readFileSync(reportPath, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  check(
    CASES[0] ?? '',
    seen.composed?.ok === true && seen.composed.value?.kind === 'opened',
    `document.newFromMarkdown answered ${JSON.stringify(seen.composed)}. \`internal\` here is ` +
      'the host refused at creation, at its containment verdict, or at its area.',
  );

  check(
    CASES[1] ?? '',
    seen.header === '%PDF-',
    `the destination began ${JSON.stringify(seen.header)}; null is no file at all.`,
  );

  check(
    CASES[2] ?? '',
    seen.words?.ok === true && seen.words.value?.words === seen.expectedWords,
    `document.pageWordCount answered ${JSON.stringify(seen.words)} against ` +
      `${String(seen.expectedWords)} words in the source. Zero is a page that opened and drew ` +
      'nothing MuPDF can read.',
  );

  check(
    CASES[3] ?? '',
    seen.refused?.ok === true &&
      seen.refused.value?.kind === 'composition-refused' &&
      seen.refused.value?.reason === 'not-utf8' &&
      seen.refusedWroteNothing === true,
    `a non-UTF-8 source answered ${JSON.stringify(seen.refused)}, and the destination was ` +
      `${seen.refusedWroteNothing === true ? 'not written' : 'WRITTEN'}. A refusal by name can ` +
      'only come from the composer in the host.',
  );

  check(
    CASES[5] ?? '',
    seen.csvComposed?.ok === true && seen.csvComposed.value?.kind === 'opened',
    `document.newFromCsv answered ${JSON.stringify(seen.csvComposed)}. It reaches the host on ` +
      'engine/compose-csv, so a refusal here with the Markdown import passing is that channel.',
  );

  check(
    CASES[6] ?? '',
    seen.csvWords?.ok === true && seen.csvWords.value?.words === seen.expectedCsvWords,
    `document.pageWordCount answered ${JSON.stringify(seen.csvWords)} against ` +
      `${String(seen.expectedCsvWords)} fields in the source. Fewer is a table that dropped cells.`,
  );

  check(
    CASES[7] ?? '',
    seen.imagesComposed?.ok === true &&
      seen.imagesComposed.value?.kind === 'opened' &&
      seen.imagePages?.ok === true &&
      seen.imagePages.value?.pageCount === seen.expectedImagePages,
    `document.newFromImages answered ${JSON.stringify(seen.imagesComposed)} and document.viewModel ` +
      `${JSON.stringify(seen.imagePages)}, against ${String(seen.expectedImagePages)} pictures. The ` +
      'images reach the host on engine/compose-images; a count that differs is pages lost or added.',
  );

  check(
    CASES[4] ?? '',
    exited !== undefined && exited.status === 0 && exited.signal === null,
    `the harness exited ${String(exited?.status)}${exited?.signal == null ? '' : ` on ${exited.signal}`} ` +
      'after writing its report. Read its stderr above.',
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} compose-host case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('compose-host case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
