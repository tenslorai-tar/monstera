// @ts-check
/**
 * Does a host call's deadline end a host that answers nothing, against a running process — and does the document
 * come back usable (CR-SEC-09; ADR-0023 §3, corrected 2026-10-03)?
 *
 * `client.test.ts` proves the client ends a connection when a call passes its deadline, against a fake transport and
 * a manual clock. What it cannot show is the rest of the path in a real shell: that ending the connection kills a real
 * host, that the supervisor rebuilds one, and that the document then answers with what it held. This runs the shell
 * with a real contained host and freezes the host mid-call (`hostDeadlineHost.mjs`), in two cells one value apart:
 *
 * - **deadline**, a 4 s floor: the frozen call ends within it, the frozen host is gone, a new one serves the document,
 *   and the rotation made before the freeze is still there. Two more deadlines under the same command rebuild the host
 *   each time without poisoning the document, the third bars that command and the document still answers other
 *   requests (ADR-0221, which amends ADR-0023 Decision 9a for a deadline during a command), and a bystander document
 *   open the whole time still answers (P3: an ending counts against the document whose call the host was running, and
 *   only that one). A host that dies rather than freezes still poisons at two: `hostRecovery.mjs` holds that control.
 * - **CONTROL**, a 10-minute floor and the same freeze: the call is still waiting after 20 s — the wedge, reproduced,
 *   so the first cell's ending is the deadline's and not something else ending the call.
 *
 * Needs Windows, the pinned Electron runtime, the build, the MuPDF shim and the container grants, as
 * `hostRecovery.mjs` does; without them it reports UNVERIFIABLE, and `--require-containment` makes that a failure.
 *
 * Usage: node scripts/research/hostDeadline.mjs [--require-containment]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { shimBuildState, shimEnvironment } from '../lib/shimBinary.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'hostDeadlineHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);
const BUILT = [
  'apps/desktop/dist/composition.js',
  'apps/desktop/dist/engineHostPlatform.js',
  'apps/desktop/dist/harnessComposition.js',
  'packages/kernel/dist/host/hostEntry.js',
];
const REQUIRE_CONTAINMENT = process.argv.includes('--require-containment');

/** The cases, named, so the count is a claim of its own and the unverifiable branch can list them (audit item 4c). */
const CASES = [
  'the first command reached the host, so the freeze had a working host to freeze',
  'the frozen call ENDED within the deadline, not before it',
  'the frozen host stopped existing',
  'a NEW host appeared, and the document answers a command again',
  'the document still holds the rotation made before the freeze',
  'two deadlines under one command rebuild the host each time and do NOT poison the document (ADR-0221)',
  'the THIRD bars that command: the next attempt is refused by name, and the document still answers other requests',
  'P3: the document open the whole time, which caused neither deadline, still answers and holds its own rotation',
  'CONTROL: with a 10-minute deadline the same frozen call is still waiting after the whole watch',
  'CONTROL: and both harness processes exited cleanly',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: CASES.length });
/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const missingBuilt = BUILT.filter((relative) => !existsSync(join(ROOT, relative)));
const ungranted =
  process.platform === 'win32' ? inspect({ root: ROOT }).filter((entry) => entry.present === false).map((entry) => entry.path) : [];
const shim = shimBuildState({ root: ROOT });
const runnable =
  process.platform === 'win32' && existsSync(ELECTRON_BINARY) && missingBuilt.length === 0 && shim.current && ungranted.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The engine host is a Win32 AppContainer process (ADR-0022), so there is nothing to freeze on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? 'The pinned Electron binary is absent. Run `npm run provision:electron`.'
        : missingBuilt.length > 0
          ? `Not built: ${missingBuilt.join(', ')}. Run \`npm run build\`.`
          : !shim.current
            ? `The MuPDF shim the hosts load is not usable: ${shim.reason}`
            : `The container cannot read ${String(ungranted.length)} granted path(s). Run \`npm run provision:grants\`.`;
  exitUnverifiable({
    required: REQUIRE_CONTAINMENT,
    subject: 'a host call past its deadline',
    why: `${String(CASES.length)} case(s) could not be evaluated:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ${why}`,
    flag: '--require-containment',
  });
} else {
  /**
   * Runs one cell. The report comes back in a file and the child's stdio is inherited, for `hostRecovery.mjs`' reason:
   * a host holding an inherited pipe would make `spawnSync` wait on a grandchild.
   *
   * @param {'deadline' | 'control'} cell
   */
  const runCell = (cell) => {
    const scratch = mkdtempSync(join(tmpdir(), `monstera-host-deadline-${cell}-`));
    const reportPath = join(scratch, 'report.json');
    try {
      const result = spawnSync(ELECTRON_BINARY, [CHILD, cell, reportPath], {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 180_000,
        env: { ...process.env, ...shimEnvironment({ root: ROOT }), ELECTRON_RUN_AS_NODE: '1' },
      });
      if (result.error !== undefined) throw new Error(`could not run ${CHILD} under ${ELECTRON_BINARY}`, { cause: result.error });
      if (!existsSync(reportPath)) {
        throw new Error(`the ${cell} harness wrote no report (exit ${String(result.status)}); its stderr is above`);
      }
      return { report: JSON.parse(readFileSync(reportPath, 'utf8')), status: result.status, signal: result.signal };
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };

  const fast = runCell('deadline');
  const slow = runCell('control');
  const seen = fast.report;

  check(CASES[0] ?? '', seen.firstCommand?.ok === true && slow.report.firstCommand?.ok === true, `deadline cell ${JSON.stringify(seen.firstCommand)}, control ${JSON.stringify(slow.report.firstCommand)}`);
  check(
    CASES[1] ?? '',
    seen.frozenCall !== null && seen.settledAfterMs >= seen.floorMs && seen.settledAfterMs < seen.floorMs * 1.5,
    `the frozen call settled ${JSON.stringify(seen.frozenCall)} after ${String(seen.settledAfterMs)} ms against a ${String(seen.floorMs)} ms deadline`,
  );
  check(CASES[2] ?? '', seen.oldGone === true, `host ${String(seen.frozenPid)} was still a child after the deadline ended its connection`);
  check(
    CASES[3] ?? '',
    seen.rebuilt === true && seen.newPid > 0 && seen.newPid !== seen.frozenPid && seen.afterRecovery?.ok === true,
    `new host ${String(seen.newPid)}, rebuilt ${String(seen.rebuilt)}; the rotate after recovery answered ${JSON.stringify(seen.afterRecovery)}`,
  );
  // 90 before the freeze; the frozen call ended without applying; 90 more after recovery.
  check(CASES[4] ?? '', seen.rotationAfter === 180, `page 1 reads ${JSON.stringify(seen.rotationAfter)} after recovery, where 180 was expected`);
  // The first two strikes are ordinary failures of a call whose host ended, and neither may be the refusal that belongs to
  // the third: a shell that barred at two would pass the case after this one and fail this.
  check(
    CASES[5] ?? '',
    seen.strikeOutcomes.length === 3 &&
      seen.strikeOutcomes.slice(0, 2).every((/** @type {{ ok: boolean, code: string | null }} */ outcome) => outcome.ok === false && outcome.code !== 'command-looped' && outcome.code !== 'document-poisoned'),
    `the first two frozen rotates answered ${JSON.stringify(seen.strikeOutcomes?.slice(0, 2))}; each must fail without being barred or poisoned`,
  );
  check(
    CASES[6] ?? '',
    seen.afterSecondDeadline?.code === 'command-looped' && typeof seen.readAfterBarred === 'number',
    `the rotate after the third deadline answered ${JSON.stringify(seen.afterSecondDeadline)} (expected command-looped), and a read of ` +
      `the same document answered ${JSON.stringify(seen.readAfterBarred)} where a number was expected: ADR-0221 bars the command, ` +
      'not the document, and a shell that never barred would send it to a fresh host for ever',
  );
  // THE LIVE REVIEW'S P3, and its control is this case before ADR-0023's correction of 2026-10-03: every held document
  // was counted at each ending, so the bystander answered document-poisoned here, having caused neither.
  check(
    CASES[7] ?? '',
    seen.bystanderBefore === 0 && seen.bystanderAfter?.ok === true && seen.bystanderRotation === 90,
    `the bystander read ${JSON.stringify(seen.bystanderBefore)} before, its rotate after both deadlines answered ` +
      `${JSON.stringify(seen.bystanderAfter)}, and page 1 then reads ${JSON.stringify(seen.bystanderRotation)} where 90 was expected`,
  );
  check(
    CASES[8] ?? '',
    slow.report.stillWaitingAfterWatch === true && slow.report.frozenCall === null,
    `the control's frozen call settled ${JSON.stringify(slow.report.frozenCall)} after ${String(slow.report.settledAfterMs)} ms with a ` +
      `${String(slow.report.floorMs)} ms deadline — something other than the deadline ends a frozen call, so the first cell proves nothing`,
  );
  check(
    CASES.at(-1) ?? '',
    fast.status === 0 && fast.signal === null && slow.status === 0 && slow.signal === null,
    `the harnesses exited ${String(fast.status)} and ${String(slow.status)}`,
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} host-deadline case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('host-deadline case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
