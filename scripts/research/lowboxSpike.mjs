// @ts-check
/**
 * Can a process WE create run the engine host inside an AppContainer (LowBox),
 * and what does that cost?
 *
 * ## The one question, covering invariant 25's (c) and (d) together
 *
 * (a) integrity and (b) job object are obtained and have differentials on a host
 * carrying the engine. (c) *no network* and (d) *reaches no filesystem path
 * it was not handed* have **no mechanism**: QQ-1 removed the only candidate for
 * (d) by measuring that Node's permission model is enforced inside Node's own
 * filesystem bindings, so a `CreateFileW` walks past it. The principle that
 * followed — *only kernel-enforced mechanisms contain native code* — leaves
 * exactly one family of candidates, and AppContainer is the one that covers both
 * properties at once. Hence one spike and not two.
 *
 * **This prices a branch. It does not justify one, and it is not a sandbox.**
 * Chromium's renderer sandbox is this entire stack and is not being reimplemented
 * here. What is wanted is a number: does the host still work in a LowBox, what
 * had to be granted for it to, and which of (c) and (d) come back with a
 * mechanism.
 *
 * ## Four cells, because a comparison that crosses two variables says nothing
 *
 * | cell | created by | LowBox | job |
 * |---|---|---|---|
 * | `route` | our own `CreateProcessW` | no | yes |
 * | `route-no-job` | our own `CreateProcessW` | no | **no** |
 * | `lowbox` | our own `CreateProcessW` | yes | yes |
 * | `lowbox-no-job` | our own `CreateProcessW` | yes | **no** |
 *
 * Two independent switches — containment and the job — so **every property has a
 * pair that flips exactly one thing**, which is what RR-2 asks for and what WW-1
 * moved here. Every cell is created the same way, so no row's verdict crosses
 * the creation route.
 *
 * ## Every cell is created by the SHIPPED surface (RR-3)
 *
 * `apps/desktop/src/win32HostSurface.ts` creates each cell: the command line,
 * the security-capabilities attribute, `CREATE_SUSPENDED`, the job, its limits,
 * the assignment, the membership read, the resume. This file used to hand-roll
 * all of that in an emitted `MAIN` template running under the Electron binary —
 * a second implementation of the thing being measured, sitting beside the
 * shipped one (B3a), and a proof built on it would have proven the wrong
 * artefact.
 *
 * The rule that replaces it is one line: **creation belongs to the surface,
 * observation belongs to this instrument.** Reading the child's token from
 * outside and waiting for exit stay here, because no shipped host does either.
 *
 * Two things the migration cost, both caught by requiring every property verdict
 * to stay byte-identical across it:
 *
 *   - `process.execPath` silently changed meaning. It was the Electron binary
 *     when the driver ran under Electron; in a plain-Node parent it is system
 *     Node, so the cells ran the wrong runtime, the container had no rights on
 *     it, and one row went from `same` to UNREADABLE. The executable is
 *     `electronBinaryPath()` now, named rather than inherited.
 *   - `applyLimits` has no undefaulted form, so the job gained §9.17's memory
 *     cap. That is a coverage GAIN and it is stated on the (b) memory row rather
 *     than absorbed.
 *
 * ## The control is that the uncontained host WORKS, not that it resembles a fork
 *
 * There was a fifth cell, `baseline`, forked by `utilityProcess.fork`, and the
 * control compared it against `route` to establish that our own creation route
 * was sound. **Removed by finding RR-3, and the reason is that its referent is
 * gone**: ADR-0022 decided the hosts are processes this application creates, so
 * agreeing with the fork route is agreement with a process type nobody builds.
 * A differential against a retired reference is a proxy with nothing behind it.
 *
 * It also cost more than it looked. A forked cell needs an Electron **app**, and
 * that app started a GPU process which crash-looped twice and killed whole runs
 * (LLL-1). With the cell gone, this parent is plain Node.
 *
 * What replaced it is narrower and is not a comparison: the uncontained cell
 * must be observed **loading koffi, loading the shim and opening the document it
 * was handed** on every run. That is a positive control with a refusal — a
 * refusal measured against a host that does not work is not containment, it is a
 * broken run — so the file prints **HOST NOT WORKING**, terminally, and offers
 * no property verdict rather than one it cannot attribute.
 *
 * **The loss is real and is stated where the control lives** (audit item 2a): a
 * differential can catch an unanticipated difference, and a working-host check
 * catches only the three things it names.
 *
 * The attribution the baseline seemed to carry was already carried by the pairs
 * above, each flipping one mechanism with the route held fixed.
 *
 * **The job axis paid for itself before it reached a property row.** The
 * ordering evidence for ADR-0023 §1 used to be read `route` against `baseline`,
 * because every `CreateProcessW` cell carried the job and no other cell lacked
 * one — so that reading crossed the creation route as well, one section below
 * where this file refuses to do exactly that. `route-no-job` makes it single
 * variable.
 *
 * ## ACLs are machine state, and this is the one spike that changes the machine
 *
 * Granting the AppContainer SID read+execute on koffi, its platform sibling, the
 * shim and the Electron install **persists after the run**. A later run that
 * inherits grants it did not set would report *the LowBox can reach the FFI* for
 * a reason nobody established that day — and that is the one failure a positive
 * control cannot catch, because an inherited grant is present exactly like a
 * fresh one.
 *
 * So: every path is asserted **clear before anything is granted**; every grant is
 * recorded; every grant is reversed on exit including the failure path; and the
 * profile is deleted only if this run created it.
 *
 * **The absence check is a SEARCH, and its reassuring answer is "not found"**
 * (item 4b). Its positive control is the grant itself: after granting, the same
 * search must find the principal it just reported absent. If it cannot, the
 * search is blind and this exits rather than concluding — one instrument, two
 * readings that must disagree, which is also its resolution test (item 4a).
 *
 * ## BBB-1 — one probe blinded both contained cells for four commits
 *
 * Found and fixed 2026-08-22. Recorded because the *shape* recurs and the fix
 * does not stop it recurring.
 *
 * `spawnAtStartup` arrived in `56f77f7` to supply ADR-0023 §1's ordering
 * evidence, written as a **synchronous** `execFileSync` — the host's first
 * action, which is what that reading requires. From that commit until this one,
 * **both contained cells died at main's 60-second wait having measured
 * nothing**, so every property row in the lowbox column read UNREADABLE while
 * the table below went on displaying readings taken at `36caf21`, one commit
 * earlier.
 *
 * The measured mechanism, corrected once by running it — the first version of
 * this paragraph said the spawn call did not return, and the async probe shows
 * that is not what happens:
 *
 *   - inside the container the child **is** created; the attempt resolves
 *     `allowed`, just slowly, around five seconds;
 *   - the child then does not exit inside main's whole 60-second window;
 *   - `execFileSync` waits for **exit**, not for creation, so it blocked;
 *   - and its `timeout: 10000` did not end that wait. Why the timeout's kill did
 *     not take is **not established here** and is not guessed at.
 *
 * **The question never needed the exit.** *Can this process create a process* is
 * answered by the attempt resolving, so the probe now spawns asynchronously,
 * settles once, and arms **its own** timer — which is what every other probe in
 * this host already did. That is the class: this was the only probe in the file
 * that borrowed somebody else's timeout, and it is the only one that hung.
 *
 * Two things worth keeping beyond the fix:
 *
 *   1. **The blinding is silent and asymmetric.** One probe added for one
 *      property took out every *other* property in that cell, and the reading it
 *      was added FOR still worked — the ordering section read the forked cell
 *      against `route` at the time, both uncontained, so it never touched a
 *      container. (That pair is gone with the cell; the reading is now `route`
 *      against `route-no-job`, and both of those are uncontained too, so the
 *      asymmetry the finding describes is unchanged.) A defect that spares the
 *      thing it was introduced with is a defect nobody is looking at.
 *   2. **The control came before the conclusion.** The pre-consolidation file,
 *      stashed and run unmodified, hung identically — so WW-1's consolidation
 *      was excluded as the cause by measurement rather than by reading a diff.
 *
 * The breadcrumbs below are what located it and are permanent. Before them the
 * instrument could say *unreadable* and nothing could say *unreadable where*.
 *
 * ## What it measured, 2026-08-23, on this machine
 *
 * Dated because it is a reading and not a property of the file. Re-run it rather
 * than trusting this block.
 *
 * The working-host control passed: in the `route` cell koffi loaded (3.1.5), the
 * shim created a context, and the handed document opened at 1 page. So the
 * uncontained side is a working host and the lowbox column is readable.
 *
 * **Taken with the baseline cell removed, and every property verdict is
 * byte-identical to the run immediately before the removal** — which is the
 * measurement that the fifth cell was carrying nothing the same-route pairs did
 * not already carry. **Byte-identical again across the move onto the shipped
 * surface**, with the single deliberate exception of the (b) memory row, whose
 * blocker changed.
 *
 * ## What it COSTS, measured, because the next step is a proof
 *
 * **5 seconds**, wall clock, for the whole run: four cells created, every probe
 * in each, the ACL grants taken and released, the profile created and deleted.
 *
 * That number matters because RR-3's proof has to live in the sweep
 * `checkLocal.mjs` orders by measured cost, and the concern raised against it
 * was that a Windows-only containment proof would be the next `proof:cff` —
 * something that strands the queue and gets diagnosed twice. On the shape this
 * file had when that was said it was a fair worry: a driver process started
 * under the Electron binary, an app before that, and a 60-second wait armed per
 * cell. The migration removed the intermediate process, and what is left is
 * four `CreateProcessW` calls and their children.
 *
 * So the premise is measured rather than assumed, and it is the good direction:
 * this belongs in the cheap end of the duration table, not the doomed tail.
 * Re-measure rather than trusting THAT DURATION — it is a reading of one
 * machine, and the sentence is scoped to it deliberately. A general "re-measure
 * rather than trust" placed above a table makes every row in it read as
 * current-and-checked, including a row that has since been superseded; the rows
 * below carry their own corrections in their own text (finding YYY-1).
 *
 * Every row below is against the cell that removes ONLY that row's mechanism,
 * and the run exits 0 with no unreadable row.
 *
 * | property | contained | uncontained | |
 * |---|---|---|---|
 * | (b) process creation — job alone | `route` refused `UNKNOWN` | `route-no-job` spawned | **differs** |
 * | (b) process creation — LowBox alone | spawned HERE, refused `EPERM` on `windows-latest` | `route-no-job` spawned | **either — build-dependent** |
 * | (d) filesystem, JS | refused `EPERM` | read 6250 bytes | **differs** |
 * | (d) filesystem, native | refused `CreateFileW: error 5` | read 4096 bytes | **differs** |
 * | (c) network, loopback | refused `ETIMEDOUT` | connected | **differs** |
 * | engine | `mz_init` created a context | same | same |
 * | document it WAS handed | opened, 1 page | same | same |
 * | IPC over a named pipe | refused `EPERM` | connected | **differs** |
 *
 * **The second row separates two mechanisms that were always present together,
 * and the claim that SURVIVED is a reliability one: the container cannot be
 * relied on for (b).** That is stronger than *it does not deliver (b)*, which is
 * what this paragraph asserted until 2026-08-23 and what the run on this machine
 * had shown — a LowBox host with no job of ours spawned a child without
 * difficulty. On `windows-latest` the same cell was refused `EPERM`. Both
 * readings are real; neither is the mechanism. An AppContainer refuses process
 * creation on some Windows builds and permits it on others, and something
 * present on some builds and absent on others is precisely what a design may not
 * depend on — which is what [ADR-0023](../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 8 rests on. The split reading is better evidence for that decision
 * than a uniform `same` would have been.
 *
 * So the row asserts `either`, and the assertion has not gone away: the
 * UNCONTAINED half must still be allowed, or two dead cells would satisfy it.
 * The enforcing code is in `PROPERTIES` below and carries the same note.
 *
 * **The union problem the variant matrix exists to break is still broken by row
 * one**, on both builds — its two cells are uncontained and Medium-integrity on
 * both sides, so the job is the only difference between them and the container
 * cannot be the cause of the refusal either way.
 *
 * And the ordering, added 2026-08-22 for ADR-0023 §1: `previousSuspendCount: 1`
 * and `inJobBeforeResume: true`, with the host's **first** action — a spawn
 * attempt — refused in the route cell and allowed where no job of ours exists.
 * The job is in force at instruction one, so the handshake finding PP-6 designed
 * for that window is unnecessary. **This reading still reproduces**, and it is
 * now single-variable: `route` refused against `route-no-job` allowed, same
 * creation route on both sides. It was read against the forked baseline until
 * WW-1 added the job axis.
 *
 * **(c) and (d) both come back with a mechanism, and (d) binds the NATIVE
 * caller** — `error 5` is `ERROR_ACCESS_DENIED` from `CreateFileW` itself, which
 * is the call the permission model could not reach. The engine still runs.
 *
 * Three costs, each measured rather than predicted:
 *
 *   1. **Five grants**, and not all of the same kind: read+execute on the runtime,
 *      the FFI, its platform sibling and the shim; **modify** on what the host was
 *      handed, because a host that reports has to write where it was handed.
 *      Granted read+execute, it ran every probe and exited 97 — its own code for
 *      "could not write the report".
 *   2. **`--preserve-symlinks` and `--preserve-symlinks-main`.** Without them the
 *      host dies before its first line with `EPERM lstat 'C:\'`: Node realpaths
 *      the main path and every require, and a LowBox token passes an access check
 *      only where the DACL names the container or an application-package SID, so
 *      the user's own rights on the volume root do not count. `C:\Program Files`
 *      grants `ALL APPLICATION PACKAGES`; `C:\` and `C:\Users` grant it nothing.
 *   3. **IPC is not free.** Node's named-pipe server sets no DACL for the
 *      container, so the contained host cannot connect to it — and a MessagePort
 *      is unreachable off the fork route by construction. Whatever the host talks
 *      through has to be created with the container in its DACL.
 *
 * ## What this does NOT answer, stated so nobody reads it as covered
 *
 * - **Capabilities.** The container is created with none. A host that needs one
 *   is a different measurement.
 * - **Whether a LowBox host is the right design.** Decided on these numbers by
 *   [ADR-0022](../../docs/DECISIONS/0022-the-engine-host-is-a-process-we-create.md):
 *   it is, and the hosts are processes this application creates. How it is built
 *   is [ADR-0023](../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md).
 * - **Anything about a renderer.** Reaching MuPDF there means WASM, which
 *   ADR-0010 withdrew on measurement.
 *
 * ## This is the only containment instrument (WW-1, done 2026-08-22)
 *
 * `hostFixture.mjs` measured a utility process that lowers its own integrity —
 * a process type ADR-0022 withdrew as the host and a step ADR-0023 §1 withdrew
 * as a mechanism, since a LowBox token is Low at creation. Two instruments
 * measuring two process types breaks RR-2's premise that every containment
 * conclusion comes from one, so it was **consolidated here and deleted**, rather
 * than repaired into a second maintained thing.
 *
 * Three things came across, and each closes a gap this file had:
 *
 *   1. the **per-property variant matrix** — the job axis above, so a denial is
 *      attributable to the mechanism whose absence produced it;
 *   2. the **four-state outcome classifier**, whose `unreadable` is terminal, so
 *      *could not look* and *looked and found containment* never share an
 *      output. This file used to return a probe's reading as it arrived, which
 *      is how the fixture's own first version printed a containment verdict for
 *      prose;
 *   3. the **control that removes the CONTAINED reading** and requires the row
 *      to go unreadable — mutated on that side because two absences agree, so
 *      the other direction never reaches the defect.
 *
 * One reading did **not** come across and the table says so where it would have
 * been: **(b) memory**. The fixture measured it against a 512 MB literal its own
 * comment flagged as PP-4; ADR-0023 §2 makes the shipped limit a derivation from
 * §9.17's absolute cap, and implementing that rule a second time here is B3a. It
 * is a coverage reduction, printed at the point of use, with RR-3 as its
 * trigger.
 *
 * `hostIntegrityFromMain.mjs` survives: (a) still has to be read from outside,
 * and is now read at creation rather than after a lowering that no longer
 * happens, so its motivation changed and its existence did not.
 *
 * ## THIS IS A PROOF NOW, and it did not move to become one (RR-3, ADR-0023 §6)
 *
 * It asserts. Every property row carries the verdict the invariant requires and
 * fails when the measurement disagrees; the working-host control is three cases;
 * the absence control is one. It is registered as `proof:hostcontainment` and
 * runs in the shim job — `windows-latest`, builds MuPDF, provisions Electron,
 * the only job that can host one.
 *
 * **The path did not change, and that is a decision rather than laziness.**
 * `check:docs` requires every `scripts/` path named in a tracked document to
 * resolve, and this file is named by `docs/JOURNAL.md` and two ADRs — records,
 * which take appended corrections and are never edited. Moving the file would
 * have forced a choice between a red check and editing records, to buy a tidier
 * directory. A file's behaviour is cheap to change and its identity is not,
 * because identity is what records point at.
 *
 * What `scripts/research/` means is corrected where it is stated rather than
 * worked around: ADR-0023 §6 carries a dated note that the transition happened
 * in place.
 *
 * ## Where it cannot look, it says UNVERIFIABLE and never `passed`
 *
 * AppContainer is a Windows kernel object, the engine is the point (QQ-2), and
 * the surface under test has to be built. Where any of that is missing this
 * reports UNVERIFIABLE cases and exits 0 — a proof that cannot look must not
 * print the reassuring answer, and "containment asserted" is the most
 * reassuring line in the build.
 *
 * `--require-containment` turns every one of those into a hard failure, and the
 * shim job passes it. That is the same shape as `--require-derivation` and
 * `--require-desktop-copy`: UNVERIFIABLE is honest where nothing is
 * provisioned, and mandatory where something is.
 *
 * Usage: node scripts/research/lowboxSpike.mjs [--reset] [--require-containment]
 *
 *   --reset  delete a leftover profile and its grants from a crashed run, then
 *            exit. Explicit operator action to clear machine state; it clears
 *            nothing this run would otherwise have checked.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import koffi from 'koffi';

import { createRoster } from '../lib/passRoster.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { INVALID_HANDLE_SOURCE } from '../lib/win32Handle.mjs';

const ROOT = repoRoot();
const SHIM = join(ROOT, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
/**
 * The document the host IS handed — GENERATED here, not assumed to exist.
 *
 * This named `packages/testing/fixtures/generated/perf-baseline.pdf`, which the
 * performance gate happens to produce. On a developing machine that file is
 * always there and the dependency was invisible; on the shim job's fresh
 * checkout it is not, and the first CI run of this proof died on `ENOENT
 * copyfile` after taking five ACL grants and creating a container.
 *
 * **Audit item 3's inverse, and the plainest instance of it yet**: a branch keyed
 * on the presence of something, where the developed-in world is the one that has
 * it. Nothing here was wrong on this machine and nothing could be.
 *
 * `buildLargeFixture` caches against a digest of its own source plus the
 * parameters, so this costs one 64 KB write on a cold machine and nothing after.
 * Its own name and parameters rather than the gate's: sharing a filename with a
 * caller that may change its parameters is a cache two things thrash.
 */
const FIXTURE = buildLargeFixture({
  root: ROOT,
  targetBytes: 64 * 1024,
  pages: 1,
  name: 'containment-handed.pdf',
}).path;

/**
 * A FIXED name, deliberately, so a leftover from a crashed run is detectable.
 *
 * A per-run name would make a collision impossible and would also make stale
 * profiles and stale ACEs pointing at dead SIDs accumulate invisibly. Detecting
 * the leftover is the point; `--reset` is the way to clear it, and it is an
 * explicit action rather than a silent one.
 */
const CONTAINER = 'monstera-lowbox-spike';

/** @type {string[]} */
const caseFailures = [];

/**
 * Mandatory where something can look; UNVERIFIABLE where nothing can.
 *
 * The shim job passes it. Without it a machine with no Windows, no shim or no
 * build reports could-not-look and exits 0, which is the honest answer there —
 * and would be a green board for a check that never ran on the one job that
 * exists to run it.
 */
const REQUIRE = process.argv.includes('--require-containment');

/**
 * Refuses to measure, in the one way that is not a pass.
 *
 * Exits 0 so a machine that cannot host an AppContainer is not reported as a
 * containment failure, and prints UNVERIFIABLE so it is not reported as a pass
 * either. Under `--require-containment` the same condition is a hard failure,
 * because on a job that provisions everything, "could not look" means something
 * broke.
 *
 * @param {string} why
 * @returns {never}
 */
function unverifiable(why) {
  if (REQUIRE) {
    process.stderr.write(
      `\nCONTAINMENT UNPROVEN, and --require-containment says that is a failure here.\n\n  ${why}\n\n` +
        `  This flag is passed by the job that provisions Windows, the shim and the build, so a\n` +
        `  could-not-look on it is something broken rather than something absent.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `\n  UNVERIFIABLE  invariant 25's containment is not measured here\n      ${why}\n\n` +
      `  NOT a pass. Nothing about containment is asserted by this run, and nothing is denied\n` +
      `  either — the shim job passes --require-containment, where the same condition is red.\n`,
  );
  process.exit(0);
}

if (process.platform !== 'win32') {
  unverifiable(
    'AppContainer is a Windows kernel object, and this measures nothing elsewhere. ' +
      `This is ${process.platform}.`,
  );
}

if (!existsSync(SHIM)) {
  unverifiable(
    `The MuPDF shim is not built at ${SHIM}. This exists to prove a host that has the ENGINE ` +
      `in it; without the shim it would measure whether Node starts in a container, which is ` +
      `not the question (QQ-2). Run \`npm run provision:mupdf\`.`,
  );
}

const userenv = koffi.load('userenv.dll');
const advapi = koffi.load('advapi32.dll');

const CreateAppContainerProfile = userenv.func(
  'int CreateAppContainerProfile(const char16_t *name, const char16_t *display, ' +
    'const char16_t *description, void *capabilities, uint32 count, _Out_ void **sid)',
);
const DeriveAppContainerSidFromAppContainerName = userenv.func(
  'int DeriveAppContainerSidFromAppContainerName(const char16_t *name, _Out_ void **sid)',
);
const DeleteAppContainerProfile = userenv.func('int DeleteAppContainerProfile(const char16_t *name)');
const ConvertSidToStringSidW = advapi.func(
  'bool ConvertSidToStringSidW(void *sid, _Out_ char16_t **out)',
);

/** `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`. */
const E_ALREADY_EXISTS = 0x800700b7 | 0;

/**
 * The container SID as a string, and whether this run created the profile.
 *
 * @returns {{ sid: string, created: boolean }}
 */
function ensureContainer() {
  const sidOut = [null];
  const hr = CreateAppContainerProfile(CONTAINER, CONTAINER, 'Monstera LowBox spike', null, 0, sidOut);
  let created = hr === 0;
  if (!created) {
    if (hr !== E_ALREADY_EXISTS) {
      throw new Error(`CreateAppContainerProfile failed: 0x${(hr >>> 0).toString(16)}`);
    }
    if (DeriveAppContainerSidFromAppContainerName(CONTAINER, sidOut) !== 0) {
      throw new Error('the profile exists and its SID could not be derived');
    }
  }
  const stringOut = [null];
  if (!ConvertSidToStringSidW(sidOut[0], stringOut) || typeof stringOut[0] !== 'string') {
    throw new Error('ConvertSidToStringSidW gave no string, so nothing below can name the principal');
  }
  return { sid: stringOut[0], created };
}

/**
 * `icacls` output for one path, or null when it could not be read.
 *
 * @param {string} path
 * @returns {string | null}
 */
function readAcl(path) {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const text = `${result.stdout}`;
  // AN EMPTY INTERMEDIATE RESULT IS A BROKEN PARSE, NOT A CLEAN INPUT. An ACL
  // with no ACE in it does not exist on a path we can read, so a text with none
  // means the read failed in a way `status` did not report.
  if (!text.includes(':(')) return null;
  return text;
}

/**
 * Does this ACL name the container?
 *
 * Windows may render an AppContainer ACE as the raw SID **or** as the profile's
 * moniker, and which one appears is not ours to decide. Both spellings are
 * searched, and the caller's post-grant control is what proves the search can
 * see either.
 *
 * @param {string} acl @param {string} sid
 */
function namesContainer(acl, sid) {
  return acl.includes(sid) || acl.toLowerCase().includes(CONTAINER.toLowerCase());
}

/**
 * @param {string} path @param {string} sid @param {string} rights
 */
function grant(path, sid, rights) {
  return spawnSync('icacls', [path, '/grant', `*${sid}:(OI)(CI)(${rights})`], { encoding: 'utf8' });
}

/**
 * @param {string} path @param {string} sid
 */
function revoke(path, sid) {
  return spawnSync('icacls', [path, '/remove:g', `*${sid}`], { encoding: 'utf8' });
}

/**
 * The host body. Every probe decides its own outcome where the answer is known —
 * classifying its prose afterwards is a second opinion about a question already
 * answered one frame up (B3a, finding SS-2).
 *
 * Prose stays in this module rather than inside the template: a backtick pair in
 * an embedded comment has closed one of these literals twice, and the error
 * pointed at whatever followed rather than at the delimiter.
 */
const HOST = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const argv = process.argv.slice(-2);
const REPORT = argv[0];
const CELL = argv[1];

// A BREADCRUMB PER STEP, on the inherited stderr handle.
//
// A host that HANGS reports nothing at all: no report file, no exit code, and a
// wait that ends in WAIT_TIMEOUT. Every probe below is individually bounded, so
// the instrument's own design says that cannot happen — which is exactly the
// kind of claim that turns out to be wrong, and did (finding BBB-1). Without
// these lines the only honest thing the table can say is "unreadable", and the
// question "unreadable WHERE" has no channel to be answered on.
//
// Unguarded on purpose. A diagnostic wrapped in a swallow can fail silently in
// the one situation it exists for, and the route cells prove this handle works.
const step = (name) => process.stderr.write('STEP ' + name + '\n');
step('host entered');

const report = { cell: CELL, probes: {} };
const allowed = (detail) => ({ outcome: 'allowed', detail: String(detail).slice(0, 160) });
const refused = (detail) => ({ outcome: 'refused', detail: String(detail).slice(0, 160) });
const errored = (detail) => ({ outcome: 'error', detail: String(detail).slice(0, 160) });

// THE SPAWN PROBE SETTLES ON ITS OWN TIMER, and finish() waits for it.
//
// Declared here rather than beside the probe because finish() has to know
// whether the last outstanding reading has arrived. Everything else in this
// host is settled by the time finish() is reachable; this one is not, by
// design, which is the whole of BBB-1's fix.
let spawnSettled = false;
let spawnTimer = null;
let onSpawnSettled = null;
const settleSpawn = (value) => {
  if (spawnSettled) return;
  spawnSettled = true;
  report.probes.spawnAtStartup = value;
  step('spawnAtStartup settled');
  if (spawnTimer !== null) clearTimeout(spawnTimer);
  if (onSpawnSettled !== null) onSpawnSettled();
};

const finish = () => {
  // The spawn probe is the only reading that can still be outstanding. Waiting
  // for it is bounded by its own timer, so this cannot wait forever — which is
  // exactly what the synchronous version could not promise.
  if (!spawnSettled) {
    step('waiting for the spawn probe');
    onSpawnSettled = finish;
    return;
  }
  step('writing the report');
  try {
    fs.writeFileSync(REPORT, JSON.stringify(report), 'utf8');
  } catch (error) {
    // The report path is inside the directory the host WAS handed. Failing to
    // write it is itself a finding, and the only channel left is the exit code.
    process.exit(97);
  }
  process.exit(0);
};

// THE VERY FIRST THING THE HOST DOES, before anything else, is try to spawn.
//
// This is the ordering evidence. The job carries ActiveProcessLimit = 1 and is
// assigned while the process is still suspended, so a refusal here means the job
// was in force at instruction one. Done LAST in the file's reading order would
// prove nothing — by then the host has run, and "the job arrived at some point"
// and "the job was there first" would share one observation.
//
// The route-no-job cell runs the same creation route and gets no job from us,
// so it is expected to SPAWN. That difference is the reading: with the route
// held fixed across the pair, it separates the ordering from the container,
// which refuses process creation for its own reasons.
// ASYNCHRONOUS, AND BOUNDED BY A TIMER THIS FILE OWNS (finding BBB-1).
//
// It used to be execFileSync with timeout: 10000, and inside an AppContainer
// that call did not return — so the host died at main's 60-second wait having
// measured NOTHING, and every property row in both contained cells read
// unreadable from 56f77f7 onward while the header displayed a table from one
// commit earlier.
//
// The mechanism is that execFileSync's timeout is not ours: it is armed by the
// wait the call performs, so a call that never gets that far is not bounded by
// it. Every other probe in this host arms its own setTimeout and settles once;
// this one borrowed somebody else's, and it was the only one that did. Making
// it match its siblings is the fix, rather than moving it or exempting the cell
// where it failed.
//
// STILL THE FIRST INSTRUCTION, which is the only thing the ordering evidence
// requires. What is dropped is waiting for the child to EXIT, which the question
// never needed: "can this process create a process" is answered by the spawn
// attempt resolving, not by what the child then printed.
// ONE CLASSIFIER FOR BOTH ARRIVAL PATHS, keyed on WHAT THE OS ANSWERED rather
// than on HOW the answer arrived.
//
// Node reports a failed spawn two ways: an 'error' event, or a synchronous
// throw from spawn() itself for a non-ENOENT errno — which on Windows is what a
// refused CreateProcessW does. Written the obvious way, the job's refusal landed
// in the catch and was recorded as an ERROR, so the ordering reading went from
// ASSIGNED BEFORE THE FIRST INSTRUCTION to NOT SHOWN while nothing about the
// spawn had changed. Measured, not reasoned about.
//
// A syscall of 'spawn' is the distinction that holds: it means the kernel was
// asked and said no. Anything else — a TypeError, a bad argument — is a broken
// probe, and a broken probe reported as containment is the reassuring direction.
// The arguments here are constants in this file, so the second case should be
// unreachable; it is classified anyway rather than assumed away.
const spawnAnswer = (error) =>
  (error && error.syscall === 'spawn' ? refused : errored)(
    String(error && error.message) + (error && error.code ? ' [' + error.code + ']' : ''),
  );

step('spawnAtStartup');
try {
  const attempt = require('node:child_process').spawn(process.execPath, ['--version'], {
    env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore',
  });
  // unref so a child that outlives its usefulness cannot hold this host open;
  // the reading is the attempt, not the lifetime. Inside the container the child
  // IS created and then takes longer than main's whole wait to exit, which is
  // what BBB-1's synchronous version was blocked on.
  attempt.unref();
  attempt.on('spawn', () => settleSpawn(allowed('spawned before doing anything else')));
  attempt.on('error', (error) => settleSpawn(spawnAnswer(error)));
  spawnTimer = setTimeout(
    () => settleSpawn(errored('the spawn attempt neither started nor failed within the window')),
    10000,
  );
} catch (error) {
  settleSpawn(spawnAnswer(error));
}

// THE HANDED DIRECTORY, read next because it carries the ports and doubles as
// the positive half of the filesystem pair: a refusal outside proves containment
// only if the same call succeeds where reading is permitted.
step('readHanded');
let config = null;
try {
  config = JSON.parse(fs.readFileSync(path.join(path.dirname(REPORT), 'handed.json'), 'utf8'));
  report.probes.readHanded = allowed('read the handed config');
} catch (error) {
  report.probes.readHanded = refused(String(error && error.code || error));
}

step('loadKoffi');
let koffi = null;
try {
  koffi = require(KOFFI_PATH);
  report.probes.loadKoffi = allowed('koffi ' + (koffi.version || 'loaded'));
} catch (error) {
  report.probes.loadKoffi = refused(String(error && error.message));
}

step('loadShim');
if (koffi !== null) {
  try {
    const shim = koffi.load(SHIM_PATH);
    const mz_init = shim.func('int mz_init(_Out_ void **out)');
    const mz_drop = shim.func('void mz_drop(void *c)');
    const mz_open = shim.func('int mz_open(void *c, const char *path, _Out_ void **out)');
    const mz_close = shim.func('int mz_close(void *c, void *d)');
    const mz_page_count = shim.func('int mz_page_count(void *c, void *d, _Out_ int *out)');

    const ctxOut = [null];
    const rc = mz_init(ctxOut);
    if (rc !== 0 || !ctxOut[0]) {
      report.probes.loadShim = refused('mz_init returned ' + rc);
    } else {
      report.probes.loadShim = allowed('mz_init created a context');
      const handedPdf = path.join(path.dirname(REPORT), 'handed.pdf');
      const docOut = [null];
      const openRc = mz_open(ctxOut[0], handedPdf, docOut);
      if (openRc !== 0 || !docOut[0]) {
        report.probes.openDocument = refused('mz_open returned ' + openRc);
      } else {
        const pages = [0];
        mz_page_count(ctxOut[0], docOut[0], pages);
        report.probes.openDocument = allowed('opened, ' + pages[0] + ' page(s)');
        mz_close(ctxOut[0], docOut[0]);
      }
      mz_drop(ctxOut[0]);
    }
  } catch (error) {
    report.probes.loadShim = errored(String(error && error.message));
  }
} else {
  report.probes.loadShim = errored('koffi never loaded, so the engine was never reached');
}

// (d) THE FILESYSTEM PAIR. The unhanded target is the repository's own
// package.json: a file the ROUTE cell reads without difficulty, which is the
// negative-probe rule — build the input from something that would SUCCEED if the
// containment were absent, or refusal and impossibility share one observation.
step('jsReadUnhanded');
try {
  const bytes = fs.readFileSync(UNHANDED_PATH).length;
  report.probes.jsReadUnhanded = allowed('read ' + bytes + ' bytes');
} catch (error) {
  report.probes.jsReadUnhanded = refused(String(error && error.code || error));
}

// AND THE SAME READ THROUGH THE PATH THE ADVERSARY HAS. This is the whole reason
// the permission model fell: a readFileSync refused by Node says nothing about a
// CreateFileW that never reaches Node. An ACL is a kernel object and should bind
// both; that is the prediction under test.
step('nativeReadUnhanded');
if (koffi !== null) {
  try {
    const kernel = koffi.load('kernel32.dll');
    const CreateFileW = kernel.func(
      'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disp, uint32 flags, void *tmpl)',
    );
    const ReadFile = kernel.func(
      'bool ReadFile(void *file, _Out_ void *buffer, uint32 toRead, _Out_ uint32 *read, void *overlapped)',
    );
    const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
    const GetLastError = kernel.func('uint32 GetLastError()');

    const handle = CreateFileW(UNHANDED_PATH, 0x80000000, 1, null, 3, 0x80, null);
    if (isInvalidHandle(koffi, handle)) {
      report.probes.nativeReadUnhanded = refused('CreateFileW: error ' + GetLastError());
    } else {
      const buffer = Buffer.alloc(4096);
      const readOut = [0];
      const ok = ReadFile(handle, buffer, buffer.length, readOut, null);
      CloseHandle(handle);
      report.probes.nativeReadUnhanded = ok
        ? allowed('read ' + readOut[0] + ' bytes, first two ' + JSON.stringify(buffer.toString('latin1', 0, 2)))
        : refused('ReadFile: error ' + GetLastError());
    }
  } catch (error) {
    // A throw from the FFI is not a refusal. A call that never completed and a
    // call that was denied are different facts (finding SS-2).
    report.probes.nativeReadUnhanded = errored(String(error && error.message));
  }
} else {
  report.probes.nativeReadUnhanded = errored('koffi never loaded, so the native path was never reached');
}

// (c) NETWORK, on LOOPBACK. A remote target cannot separate "refused by policy"
// from "this runner has no network" — the two produce one observation, and that
// mistake has been made three times here (HH-2). Main listens on 127.0.0.1, so
// an unconstrained host connects and a refusal is the container.
const afterNetwork = () => {
  step('namedPipe');
  // AND THE IPC QUESTION, which is what a contained host would actually need:
  // a MessagePort is unreachable because this process was not forked by Electron,
  // so a named pipe is the realistic candidate and its reachability is the price.
  if (config === null || !config.pipe) {
    report.probes.namedPipe = errored('no handed config, so no pipe name to try');
    finish();
    return;
  }
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    report.probes.namedPipe = value;
    finish();
  };
  const socket = net.connect(config.pipe);
  socket.on('connect', () => { socket.end(); done(allowed('connected to the pipe main created')); });
  socket.on('error', (error) => done(refused(String(error && error.code || error))));
  setTimeout(() => done(errored('no result within the window')), 5000);
};

step('loopback');
if (config === null || !config.port) {
  report.probes.loopback = errored('no handed config, so no port to try');
  afterNetwork();
} else {
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    report.probes.loopback = value;
    afterNetwork();
  };
  const socket = net.connect(config.port, '127.0.0.1');
  socket.on('connect', () => { socket.end(); done(allowed('connected on ' + config.port)); });
  socket.on('error', (error) => done(refused(String(error && error.code || error))));
  setTimeout(() => done(errored('no result within the window')), 5000);
}
`;

/**
 * THE ONE RULE THIS FILE'S WIN32 CODE FOLLOWS, and it is worth more than any
 * individual binding below (finding RR-3).
 *
 *   **Process CREATION belongs to the shipped surface. OBSERVATION belongs to
 *   this instrument.**
 *
 * Creating a process — the command line, the security-capabilities attribute,
 * `CREATE_SUSPENDED`, the job, its limits, the assignment, the membership read,
 * the resume — is `apps/desktop/src/win32HostSurface.ts`'s job, and this file
 * calls it rather than reimplementing it. It used to reimplement it, in an
 * emitted `MAIN` template that hand-rolled `CreateProcessW` beside the shipped
 * code doing the same thing: B3a's exact shape, and the reason a proof built on
 * the hand-rolled half would have proven the wrong artefact.
 *
 * What stays here is what the surface deliberately does not do, because it is
 * not part of creating a host:
 *
 *   - reading the child's token from OUTSIDE, which is property (a) and cannot
 *     be a self-read (finding PP-2);
 *   - waiting for exit and reading the exit code, which no shipped host does —
 *     a host runs until it is killed.
 *
 * The distinction is not aesthetic. Anything that creates has exactly one
 * implementation; anything that merely looks may live here. **Write the next
 * addition on the correct side of that line, or it becomes a third
 * implementation** — which is how the count went 2, 3, 4 in the advisory
 * register before it was made a named thing with callers.
 */

const BUILT_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32HostSurface.js');
if (!existsSync(BUILT_SURFACE)) {
  unverifiable(
    `The Win32 host surface is not built at ${BUILT_SURFACE}. This drives the SHIPPED surface ` +
      `rather than a copy of it, so without the build there is nothing to measure — and ` +
      `measuring a hand-rolled equivalent is the defect RR-3's migration removed. Run ` +
      `\`npm run build\`.`,
  );
}
const { createWin32HostSurface } = await import(pathToFileURL(BUILT_SURFACE).href);

/**
 * §9.17's absolute cap for `mupdf-host`, which is what the shipped factory
 * passes and therefore what the shipped job carries.
 *
 * **This is a COVERAGE CHANGE and is stated rather than absorbed** (audit item
 * 2a). The hand-rolled job set `LimitFlags` without `JOB_OBJECT_LIMIT_PROCESS_MEMORY`
 * and its comment said so: the number belonged to ADR-0023 §2 and a literal here
 * would be the shape that rule forbids. `applyLimits` REQUIRES a limit, so
 * driving the shipped surface brings the derived cap with it — the mechanism
 * arrived as a side effect of using shipped code, not as the separate work the
 * FEATURES row anticipated.
 *
 * What that moves is the blocker, not the verdict: (b) memory goes from *no
 * mechanism* to *no probe allocates yet*, which are different states and must
 * not share an output. The row says so.
 */
const { assertableBudget, memoryBudgets } = await import(
  pathToFileURL(join(ROOT, 'scripts', 'lib', 'memoryBudgets.mjs')).href
);
const PROCESS_MEMORY_LIMIT = assertableBudget(memoryBudgets(), 'mupdf-host').absoluteBytes;

const kernel = koffi.load('kernel32.dll');
const GetLastError = kernel.func('uint32 GetLastError()');
const WaitForSingleObject = kernel.func('uint32 WaitForSingleObject(void *handle, uint32 ms)');
const GetExitCodeProcess = kernel.func('bool GetExitCodeProcess(void *proc, _Out_ uint32 *code)');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)',
);

/**
 * The child's integrity level, read by the PARENT against the child's token.
 *
 * Not by the host against its own: a process that has lowered itself can no
 * longer open its own token, so a self-read is a could-not-look dressed as a
 * reading (finding PP-2).
 *
 * OBSERVATION, so it lives here. TokenIntegrityLevel is class 25, and the RID is
 * the last four bytes of the returned SID structure. 0x1000 is Low, 0x2000
 * Medium.
 *
 * @param {unknown} handle
 * @returns {string}
 */
function childIntegrity(handle) {
  const tokenOut = [null];
  if (!OpenProcessToken(handle, 0x0008, tokenOut)) {
    return `OpenProcessToken failed: ${String(GetLastError())}`;
  }
  const sizeOut = [0];
  GetTokenInformation(tokenOut[0], 25, null, 0, sizeOut);
  if (!sizeOut[0]) return `sized 0: ${String(GetLastError())}`;
  const buffer = Buffer.alloc(Number(sizeOut[0]));
  if (!GetTokenInformation(tokenOut[0], 25, buffer, sizeOut[0], sizeOut)) {
    return `GetTokenInformation failed: ${String(GetLastError())}`;
  }
  return `0x${buffer.readUInt32LE(buffer.length - 4).toString(16)}`;
}

/** @param {string} logPath @returns {string} */
function readLog(logPath) {
  try {
    const text = readFileSync(logPath, 'utf8').trim();
    return text === '' ? '(the child wrote nothing to stdout or stderr)' : text.slice(0, 1200);
  } catch (error) {
    return `(no log file: ${String(error instanceof Error ? error.message : error)})`;
  }
}

/**
 * @param {string} reportPath
 * @returns {{ probes?: Record<string, { outcome: string, detail: string }> } | null}
 */
function readReport(reportPath) {
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * One cell created by CreateProcessW, with the security-capabilities attribute
 * present or absent and the job assigned or not. Everything else is identical
 * across all four, which is what makes each neighbour pair readable.
 *
 * TWO INDEPENDENT SWITCHES, not one, and that is WW-1's matrix arriving here.
 * Every cell used to carry the job, so a job-attributable property had no
 * one-variable pair anywhere in this file and had to be read against a FORKED
 * cell — which changes the creation route at the same time. Removing the job
 * with the route held fixed is what makes that reading single-variable, and it
 * is why the forked cell could be dropped without losing the reading (RR-3).
 */
/**
 * @param {string} hostJs @param {string} scratchDir @param {string} reportPath
 * @param {string} cell @param {boolean} contained @param {boolean} withJob
 * @returns {Record<string, unknown>}
 */
function runCell(hostJs, scratchDir, reportPath, cell, contained, withJob) {
  // A PROCESS WHOSE FAILURE IS ANNOUNCED ON A CHANNEL NOBODY SUBSCRIBES TO IS
  // UNPROVEN, however carefully everything around it is measured.
  //
  // The first run of this spike had the lowbox cell exit 1 with no report and no
  // way to say WHY: CreateProcessW inherits no handles unless told to, so the
  // child's stderr went nowhere. That turned a diagnosable startup failure into
  // an unattributed refusal — the shape the working-host control exists to
  // prevent one layer up. An inherited handle is also the one channel a
  // container cannot close: the access check happens when the file is OPENED,
  // and the parent opens it. The surface takes `diagnosticPath` for exactly
  // this, so the handle is its business rather than ours.
  const logPath = join(scratchDir, `log-${cell}.txt`);

  // --preserve-symlinks-main AND --preserve-symlinks, measured rather than
  // defensive. Without them the first lowbox cell died before its first line
  // with EPERM lstat 'C:\': Node realpaths the main path and every require,
  // statting each ancestor by name, and a LowBox token passes an access check
  // only where the DACL names the container or an application-package SID — so
  // the user's own rights on the volume root do not count and C:\ grants app
  // packages nothing. The alternative is an ACE on C:\, which needs
  // administrator rights and puts a permanent grant on the volume root to run a
  // sandbox. These flags remove the realpath instead, which is the failing call.
  const surface = createWin32HostSurface({
    // THE ELECTRON BINARY BY PATH, never `process.execPath` (finding RR-3).
    //
    // The driver used to run under the Electron binary itself, so its
    // `process.execPath` WAS the binary and passing it through was invisible.
    // With the driver moved into a plain-Node parent that expression silently
    // became `C:\Program Files\nodejs\node.exe`, and the cells ran the wrong
    // runtime: the grants list names the Electron install, the container had no
    // rights on the other one, and the contained no-job cell's spawn probe came
    // back ENOENT where it had spawned freely. One property row went from `same`
    // to UNREADABLE, which is how it was caught — the migration's condition was
    // that every verdict stay byte-identical, and one did not.
    //
    // The cells must be the Electron binary in Node mode for two reasons that
    // outlive this bug: it is what invariant 25's host actually is, and it is
    // what keeps the shim job's provisioning step consuming something (TT-1).
    // `ELECTRON_RUN_AS_NODE` is forced by the surface itself.
    executablePath: electronBinaryPath(),
    // NO INTERPRETER FLAGS HERE. The surface supplies `--preserve-symlinks`,
    // `--preserve-symlinks-main` and `--no-stdio-init` to every host it
    // creates, with the measurement behind each on the line above it. Passing
    // them again from a caller is a second copy of a decision that belongs to
    // the thing creating the process, and a caller that stopped passing them
    // would look like a caller that had changed its mind (B3a).
    commandArguments: [hostJs, reportPath, cell],
    workingDirectory: scratchDir,
    // The ONE variable on the containment axis. A null name is an uncontained
    // cell; a name is the AppContainer, and the surface derives the SID and
    // sets the security-capabilities attribute itself.
    containerName: contained ? CONTAINER : null,
    diagnosticPath: logPath,
  });

  const created = surface.createSuspended();
  if (!created.ok) return { error: created.error, log: readLog(logPath) };
  const { pid, process: handle, thread } = created.value;

  // THE JOB VARIANT. Skipped entirely rather than created-and-not-assigned: a
  // job object nobody is in still has KILL_ON_JOB_CLOSE and a process limit, and
  // the point of this cell is that no job of ours exists for the child at all.
  //
  // CREATE_SUSPENDED stays on both sides — the surface always creates suspended
  // — which is what makes `integrityBeforeResume` readable and is not the
  // mechanism under test in either pair.
  const job = withJob ? surface.createJob() : null;
  let limitsSet = 'NO JOB (variant)';
  let assigned = 'NO JOB (variant)';
  let inJobBeforeResume = 'NO JOB (variant)';
  if (job !== null) {
    limitsSet = surface.applyLimits(job, PROCESS_MEMORY_LIMIT);
    assigned = surface.assignToJob(job, handle);
    // `readJobMembership` returns 'in-job' | 'not-in-job' | 'unreadable', and
    // the three are kept apart here for the same reason the shipped factory
    // keeps them apart: could-not-read is not not-in-job.
    inJobBeforeResume = surface.readJobMembership(handle, job);
  }

  // PROPERTY (a) WHILE THE PROCESS IS STILL SUSPENDED. This is the second window
  // and it deserves the same evidence the first one got: if the token is already
  // Low here, the host never runs at Medium and never lowers itself, so there is
  // no interval and nothing the host is permitted to do inside one. If it is
  // Medium, (a) is NOT in force at instruction one and the window is real.
  //
  // OBSERVATION, not creation — see this section's rule.
  const integrityBeforeResume = childIntegrity(handle);

  // ONLY NOW does the host run its first instruction.
  const resumed = surface.resume(thread);

  const waited = WaitForSingleObject(handle, 60000);
  let exitCode = null;
  if (waited === 0) {
    const codeOut = [0];
    if (GetExitCodeProcess(handle, codeOut)) exitCode = codeOut[0];
  } else {
    surface.terminate(handle);
  }
  surface.close(thread);
  surface.close(handle);
  if (job !== null) surface.close(job);
  return {
    pid,
    exitCode,
    waited,
    log: readLog(logPath),
    // previousSuspendCount is what ResumeThread returns: the thread's suspend
    // count BEFORE the call. A value of 1 is the proof the process really was
    // created suspended, because a running thread reports 0 — which separates
    // "we asked for CREATE_SUSPENDED" from "it took effect".
    ordering: {
      limitsSet,
      assigned,
      inJobBeforeResume,
      integrityBeforeResume,
      previousSuspendCount: resumed,
    },
  };
}

/**
 * Runs the four cells, with the two servers their probes reach for.
 *
 * THIS PARENT IS PLAIN NODE, and that is finding LLL-1's remedy rather than a
 * simplification. It was an Electron app, and Chromium started a GPU process
 * even though the harness opens no window; twice it crash-looped with
 * exit_code=-2147483645 until the app hit its crash limit and killed the run
 * before any cell finished. A measured negative result so nobody repeats it:
 * `disableHardwareAcceleration` plus a disable-gpu switch, applied before ready,
 * did NOT stop it, and were removed rather than left as a call that does not do
 * what its comment claims.
 *
 * The app existed for exactly ONE cell — the forked baseline — and that cell is
 * gone (RR-3). A parent needing only koffi, Win32 and `node:net` is plain Node
 * with no GPU process to crash. So the answer was a removal, not a Chromium
 * switch: prove the limit has to exist before designing around it, applied to a
 * flake instead of a bound.
 *
 * The cells ALSO used to be driven from an emitted `MAIN` template running under
 * the Electron binary, which hand-rolled `CreateProcessW`. That is gone with it:
 * the driver is this function and the creation is the shipped surface's.
 *
 * This does NOT discharge finding TT-1. Every cell still runs the Electron
 * BINARY in Node mode — the surface forces `ELECTRON_RUN_AS_NODE` — so the shim
 * job's provisioning step keeps its consumer, which is what RR-3 says that step
 * exists for.
 *
 * @param {string} hostJs @param {string} scratchDir
 * @returns {Promise<Array<{ cell: string, spawn: Record<string, unknown>, report: { probes?: Record<string, { outcome: string, detail: string }> } | null }>>}
 */
function runCells(hostJs, scratchDir) {
  return new Promise((resolve, reject) => {
    // Started before any cell, so a refusal cannot be "nothing was listening
    // yet" — which would be a containment verdict read from a race.
    const tcp = createServer((socket) => socket.end());
    const pipeName = `\\\\.\\pipe\\${CONTAINER}-${String(process.pid)}`;
    const pipe = createServer((socket) => socket.end());
    const shut = () => {
      tcp.close();
      pipe.close();
    };

    tcp.on('error', reject);
    pipe.on('error', reject);

    tcp.listen(0, '127.0.0.1', () => {
      pipe.listen(pipeName, () => {
        try {
          const address = tcp.address();
          const port = typeof address === 'object' && address !== null ? address.port : 0;
          writeFileSync(
            join(scratchDir, 'handed.json'),
            JSON.stringify({ port, pipe: pipeName }),
            'utf8',
          );

          // THE CELLS. Two axes, containment and the job, each switchable on its
          // own, so every property has a pair that flips exactly one thing.
          // There is no cell off this route: what used to sit here was a forked
          // baseline, and ADR-0022 retired the route it referenced.
          const cells = [
            { cell: 'lowbox', contained: true, job: true },
            { cell: 'route', contained: false, job: true },
            { cell: 'route-no-job', contained: false, job: false },
            { cell: 'lowbox-no-job', contained: true, job: false },
          ];

          /** @type {Array<{ cell: string, spawn: Record<string, unknown>, report: { probes?: Record<string, { outcome: string, detail: string }> } | null }>} */
          const collected = [];
          for (const spec of cells) {
            const reportPath = join(scratchDir, `report-${spec.cell}.json`);
            const spawn = runCell(hostJs, scratchDir, reportPath, spec.cell, spec.contained, spec.job);
            collected.push({ cell: spec.cell, spawn, report: readReport(reportPath) });
          }
          shut();
          resolve(collected);
        } catch (error) {
          shut();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'monstera-lowbox-'));

/**
 * Every path the container must be able to reach, and why.
 *
 * QQ-4 measured that loading one FFI needed three directories. This list is the
 * ACL form of the same problem plus the engine and the runtime, and its LENGTH is
 * half the answer the spike exists to give: *reaches no path it was not handed*
 * and *reaches the runtime, the FFI, its platform package, the engine and what it
 * was handed* are different properties, and ADR-0022 §6 names the second.
 *
 * **THIS LIST IS A DEVELOPMENT ACCOMMODATION AND IS NOT THE SHIPPED MECHANISM**
 * (ADR-0023 §5). A checkout under a user directory grants application packages
 * nothing, so the spike supplies by hand what the install root is expected to
 * supply by inheritance. The shipped design cannot use these grants at all:
 * MSIX-installed files are read-only to the app itself, so an application that
 * needed a runtime grant on an install-root path would fail on every real
 * installation rather than on some.
 *
 * The shipped app grants only what it CREATES — the handed directory — and rests
 * on premise P1, that the install root already grants `ALL APPLICATION
 * PACKAGES`. P1 is unmeasured: `icacls "C:\Program Files\WindowsApps"` returns
 * *Access is denied* without elevation, which is a could-not-look and not a
 * looked-and-found-nothing. It is carried with an expiry and verified by a
 * startup probe whose diagnostic distinguishes "P1 is false" from "a grant we
 * own did not take", because only the second is something the app can fix.
 */
const GRANTS = [
  { path: join(ROOT, '.tools', 'electron', '43.4.1'), rights: 'RX', why: 'the runtime binary and its resources' },
  { path: join(ROOT, 'node_modules', 'koffi'), rights: 'RX', why: 'the FFI' },
  { path: join(ROOT, 'node_modules', '@koromix', 'koffi-win32-x64'), rights: 'RX', why: "the FFI's platform sibling" },
  { path: join(ROOT, 'native', 'mupdf-shim', 'out'), rights: 'RX', why: 'the engine shim' },
  // MODIFY, and the difference is measured. Granted RX, the host ran every probe
  // and then exited 97 — its own code for "could not write the report into the
  // directory it was handed". A host that reports needs to write where it was
  // handed, so "what it was handed" and "what it may read" are two grants and
  // ADR-0022 §6 names both. The SHIPPED host reports over the pipe rather than
  // to a file, so whether it needs a writable directory at all is decided by the
  // startup check in ADR-0023 §5 and not inherited from this fixture's choice of
  // channel.
  { path: scratch, rights: 'M', why: 'what the host was handed — and it must be able to write back' },
];

/** @type {Array<{ path: string, why: string }>} */
const granted = [];

/**
 * Reverses every grant this run made, and says whether each came back clear.
 *
 * @param {string} sid
 */
function releaseGrants(sid) {
  const lines = [];
  while (granted.length > 0) {
    const entry = granted.pop();
    if (entry === undefined) break;
    revoke(entry.path, sid);
    const after = readAcl(entry.path);
    const clear = after !== null && !namesContainer(after, sid);
    lines.push(`  ${clear ? 'released' : 'STILL GRANTED'}  ${entry.path}`);
  }
  return lines;
}

/**
 * The cases, DECLARED so one that stops running cannot take its line and the
 * total with it (finding Z-4).
 *
 * THIRTEEN: three for the working-host control, nine property rows, and the
 * absence control. The count is constant on any machine that gets this far,
 * because everything before it is a provisioning gate that exits rather than
 * running fewer cases — an UNVERIFIABLE run prints no roster at all, which is
 * the honest shape here: it is not thirteen cases with some skipped, it is a
 * run that measured nothing.
 */
const roster = createRoster(caseFailures, { cases: 13 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function assert(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) caseFailures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const wantsReset = process.argv.includes('--reset');

let container = null;
try {
  container = ensureContainer();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const { sid, created } = container;

if (wantsReset) {
  process.stdout.write(`container: ${sid}\n\nclearing leftover machine state:\n`);
  for (const entry of GRANTS) {
    if (!existsSync(entry.path)) continue;
    revoke(entry.path, sid);
    const after = readAcl(entry.path);
    const clear = after !== null && !namesContainer(after, sid);
    process.stdout.write(`  ${clear ? 'clear' : 'STILL GRANTED'}  ${entry.path}\n`);
  }
  const hr = DeleteAppContainerProfile(CONTAINER);
  process.stdout.write(`  profile deleted: ${hr === 0 ? 'yes' : `0x${(hr >>> 0).toString(16)}`}\n`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}

if (!created) {
  process.stderr.write(
    `INHERITED MACHINE STATE: the AppContainer profile ${CONTAINER} already existed.\n\n` +
      `A profile this run did not create means a previous run did not clean up, and its grants may\n` +
      `still be on disk. A LowBox that reaches the FFI would then be true for a reason nobody\n` +
      `established today, which is the one failure a positive control cannot catch — an inherited\n` +
      `grant is present exactly like a fresh one.\n\n` +
      `Clear it explicitly, then run again:\n\n` +
      `  node scripts/research/lowboxSpike.mjs --reset\n`,
  );
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

/** @type {number} */
let exitCode;
try {
  process.stdout.write(`electron:  ${electronBinaryPath()}\nshim:      ${SHIM}\ncontainer: ${sid}\nscratch:   ${scratch}\n\n`);

  // ---- machine state, before anything runs ----
  process.stdout.write('ACLs, asserted CLEAR before anything is granted:\n');
  for (const entry of GRANTS) {
    if (!existsSync(entry.path)) {
      throw new Error(`${entry.path} does not exist, so the grant list is stale and the run would measure a different host`);
    }
    const before = readAcl(entry.path);
    if (before === null) {
      throw new Error(`icacls could not read ${entry.path}. That is a broken read, not a clean ACL, and nothing below may be concluded from it`);
    }
    if (namesContainer(before, sid)) {
      throw new Error(
        `${entry.path} ALREADY names the container. This run did not put it there, so a result from ` +
          `it would be inherited rather than fresh. Clear it with --reset.`,
      );
    }
    process.stdout.write(`  clear  ${entry.path}\n         ${entry.why}\n`);
  }

  process.stdout.write('\ngranting, and PROVING THE SEARCH CAN SEE IT:\n');
  for (const entry of GRANTS) {
    const result = grant(entry.path, sid, entry.rights);
    granted.push(entry);
    const after = readAcl(entry.path);
    if (after === null || !namesContainer(after, sid)) {
      throw new Error(
        `granted ${entry.path} and the search still reports the container absent.\n` +
          `      THE SEARCH IS BLIND, so its earlier "clear" readings meant nothing and neither would\n` +
          `      any verdict below. icacls said: ${`${result.stdout}${result.stderr}`.trim().slice(0, 200)}`,
      );
    }
    process.stdout.write(`  granted ${entry.rights.padEnd(2)} and FOUND  ${entry.path}\n`);
  }

  // ---- the app ----
  const koffiPath = JSON.stringify(join(ROOT, 'node_modules', 'koffi'));
  const hostJs = join(scratch, 'host.js');
  copyFileSync(FIXTURE, join(scratch, 'handed.pdf'));
  writeFileSync(
    hostJs,
    `const KOFFI_PATH = ${koffiPath};\n` +
      `const SHIM_PATH = ${JSON.stringify(SHIM)};\n` +
      `const UNHANDED_PATH = ${JSON.stringify(join(ROOT, 'package.json'))};\n` +
      // Emitted, not copied. The child cannot import, and a hand-kept second
      // spelling of INVALID_HANDLE_VALUE is precisely what TT-2 was.
      `${INVALID_HANDLE_SOURCE}\n` +
      `${HOST}`,
    'utf8',
  );
  // NO SECOND PROCESS BETWEEN THIS FILE AND THE CELLS (finding RR-3).
  //
  // A `main.js` used to be emitted here and run under the Electron binary in
  // Node mode, and it held the driver AND a hand-rolled `CreateProcessW`. Both
  // are gone: the driver is `runCells` in this file, and creation is the shipped
  // surface's. What the intermediate process bought was a runtime shared with
  // the cells, and the cells do not need their PARENT to be that runtime — the
  // surface forces `ELECTRON_RUN_AS_NODE` on the children it creates, and
  // `hostSurfaceProbe.mjs` has been creating Electron-binary children from plain
  // Node since the surface landed.
  //
  // What went with it: an emitted-source template, a `package.json` whose `main`
  // pointed at a script nothing launched as an app, and a report line parsed out
  // of another process's stdout. The runs are now values.
  process.stdout.write('\nrunning four cells\n\n');
  const runs = await runCells(hostJs, scratch);
  process.stdout.write(`${JSON.stringify({ runs }, null, 2)}\n\n`);
  exitCode = summarise(runs);
} catch (error) {
  process.stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 1;
} finally {
  process.stdout.write('\nreversing machine state:\n');
  for (const line of releaseGrants(sid)) process.stdout.write(`${line}\n`);
  // THE PROFILE IS DELETED BY NAME, AND THERE ARE NOW TWO THINGS THAT CREATE IT.
  //
  // `ensureContainer` creates it first, because the SID is needed to grant the
  // ACLs before any cell runs. The shipped surface then calls
  // `CreateAppContainerProfile` too and takes ALREADY_EXISTS as its ordinary
  // path — that is not a second opinion, it is the surface being self-contained
  // for the application, which never runs `ensureContainer`.
  //
  // **The surface never deletes one, deliberately: deleting drops every ACE
  // naming it.** That is right for shipped code and wrong for a check that runs
  // on every push, so the deletion is this instrument's job and it is
  // unconditional — a profile per run that nothing removes is machine state
  // accumulating on the machine that runs the check.
  const hr = DeleteAppContainerProfile(CONTAINER);
  process.stdout.write(`  profile deleted: ${hr === 0 ? 'yes' : `0x${(hr >>> 0).toString(16)}`}\n`);
  rmSync(scratch, { recursive: true, force: true });
}

// THE CASES, printed after the machine state is reversed so a failure never
// costs the teardown. `format` throws on a count mismatch, which is what turns
// "a case stopped running" into a red rather than into a smaller number nobody
// notices.
//
// The roster is skipped entirely when the run never reached the cells —
// `exitCode` is set by the catch and there is nothing to report about
// containment. Printing "0 of 13" there would invite reading it as coverage.
if (caseFailures.length > 0) {
  process.stdout.write(
    `\n${String(caseFailures.length)} containment case(s) FAILED:\n\n  - ${caseFailures.join('\n\n  - ')}\n`,
  );
  exitCode = 1;
} else if (exitCode === 0) {
  process.stdout.write(`\n${roster.format('containment case')}`);
}

process.exit(exitCode);

/**
 * The attribution table.
 *
 * The route control is read FIRST and is terminal: with a broken spawn route,
 * every LowBox refusal has two explanations and no property verdict below it
 * would mean anything.
 *
 * @param {Array<{ cell: string, spawn: Record<string, unknown>, report: { probes?: Record<string, { outcome: string, detail: string }> } | null }>} runs
 */
function summarise(runs) {
  /**
   * A probe's own verdict, or `unreadable` — NEVER a verdict inferred from an
   * absence. The four-state classifier, brought across from `hostFixture.mjs`
   * by WW-1's consolidation.
   *
   * The last clause is the one that was missing here. This used to return the
   * reading as it arrived, so a probe that reported anything other than the
   * three known outcomes — a string, a half-built object, a value from a future
   * probe that reports differently — was compared as though it were a verdict.
   * That is how the fixture's first version printed ASSERTED for a property
   * nothing had measured: prose fell through and classified as *refused* beside
   * an allowed uncontained side.
   *
   * *Could not look* and *looked and found containment* must not share an
   * output, which is why an unrecognised value becomes a third state rather
   * than a fourth guess.
   *
   * Reads from an explicit `source` rather than closing over `runs`, so the
   * control below can pose the same question to a deliberately damaged copy
   * without mutating anything the rest of this function reads.
   *
   * @param {typeof runs} source @param {string} cell @param {string} key
   * @returns {{ outcome: string, detail: string }}
   */
  const probeIn = (source, cell, key) => {
    const run = source.find((entry) => entry.cell === cell);
    if (run === undefined) return { outcome: 'unreadable', detail: `no ${cell} cell ran` };
    if (run.report === null) {
      const spawn = JSON.stringify(run.spawn);
      return { outcome: 'unreadable', detail: `${cell} wrote no report; spawn said ${spawn}` };
    }
    const reading = run.report.probes?.[key];
    if (reading === undefined || reading === null || typeof reading !== 'object') {
      return { outcome: 'unreadable', detail: `${cell} has no reading for ${key}` };
    }
    const { outcome, detail } = reading;
    if (outcome !== 'allowed' && outcome !== 'refused' && outcome !== 'error') {
      return { outcome: 'unreadable', detail: `${cell} reported ${JSON.stringify(outcome)} for ${key}` };
    }
    return { outcome, detail: String(detail ?? '') };
  };

  /** @param {string} cell @param {string} key */
  const probe = (cell, key) => probeIn(runs, cell, key);

  /**
   * One row's verdict. `unreadable` or `error` on either side is terminal: it is
   * neither DIFFERS nor same, because both of those are claims about what was
   * measured, and nothing was.
   *
   * A THROW IS NOT A REFUSAL, which is why `error` lands here rather than being
   * compared. An FFI binding that failed is a broken probe, and reporting it as
   * containment is the reassuring direction.
   *
   * @param {{ outcome: string }} a @param {{ outcome: string }} b
   * @returns {'DIFFERS' | 'same' | 'UNREADABLE'}
   */
  const verdict = (a, b) => {
    if (a.outcome === 'unreadable' || b.outcome === 'unreadable') return 'UNREADABLE';
    if (a.outcome === 'error' || b.outcome === 'error') return 'UNREADABLE';
    return a.outcome !== b.outcome ? 'DIFFERS' : 'same';
  };

  // THE WORKING-HOST CONTROL, and it replaced a differential against a
  // reference ADR-0022 retired (finding RR-3).
  //
  // What sat here compared the uncontained cell against a `baseline` forked by
  // `utilityProcess.fork`, and read agreement as *our spawn route is sound*.
  // Two things were wrong with that by the time it ran. The comparison is
  // against a process type this project decided it does not build — a proxy
  // whose referent is gone — and the fork route is what dragged an Electron app
  // and its crash-looping GPU process into a measurement that needs neither
  // (LLL-1).
  //
  // The safety property the baseline seemed to carry is carried by WW-1's
  // same-route pairs instead: every property row below flips ONE mechanism with
  // the creation route held fixed on both sides, so no row needs a second route
  // to be attributable.
  //
  // What the control has to establish is narrower and is not a comparison at
  // all: **the uncontained host is a working host.** If it cannot load koffi,
  // cannot load the shim, or cannot open the document it was handed, then a
  // refusal in the contained cell says nothing, because the uncontained side is
  // not a functioning host to differ from.
  //
  // POSITIVE CONTROL WITH A REFUSAL. It must locate the host doing host things
  // on EVERY run, and it prints no property verdict when it cannot — which is
  // item 4b's rule for an instrument whose reassuring answer is available to it.
  // `unreadable` stays terminal here for the same reason it is terminal below:
  // removing the baseline is exactly what made this control the only thing
  // standing between a broken run and a table of containment verdicts.
  //
  // THE GENUINE LOSS, stated under audit item 2a rather than left implicit. A
  // differential can catch an UNANTICIPATED difference; a working-host check
  // can only catch the three things it names. If our route broke something that
  // is neither koffi, nor the shim, nor opening a document — an inherited
  // handle, a console mode, an environment variable a future probe depends on —
  // the baseline would have shown it as a disagreement and this will not. That
  // is a real reduction in what the instrument can see, taken deliberately:
  // the reference it cost was one this project no longer builds.
  process.stdout.write('THE WORKING-HOST CONTROL — read before anything else:\n\n');
  let hostBroken = false;
  for (const key of ['loadKoffi', 'loadShim', 'openDocument']) {
    const route = probe('route', key);
    if (route.outcome !== 'allowed') hostBroken = true;
    process.stdout.write(
      `  ${key.padEnd(14)} route    ${route.outcome.padEnd(11)} ${route.detail}\n`,
    );
    assert(
      `the uncontained host can ${key}`,
      route.outcome === 'allowed',
      `${route.outcome}: ${route.detail}. Every property row is a comparison against this cell, ` +
        `so a refusal measured against a host that does not work is a broken run rather than ` +
        `containment.`,
    );
  }
  process.stdout.write('\n');

  if (hostBroken) {
    process.stdout.write(
      'HOST NOT WORKING — no property verdict is printed.\n\n' +
        '  The route cell is our own CreateProcessW with containment OFF, and it is what every\n' +
        '  row below reads as the uncontained side. It did not load koffi, load the shim and open\n' +
        '  the document it was handed, so it is not a working host — and a refusal measured\n' +
        '  against a host that does not work is not containment, it is a broken run.\n' +
        '  Every verdict below would be read from that, so none is offered.\n',
    );
    return 2;
  }

  // THE ORDERING EVIDENCE, and WW-1's matrix pays for itself here before it
  // reaches a single property row.
  //
  // This used to be read against the forked BASELINE, for a reason stated
  // honestly at the time: both CreateProcessW cells carried the job, so no
  // one-variable pair existed and the forked cell was the only one without one.
  // But that cell also changed the creation route, so the reading crossed two
  // variables — the exact shape this file's matrix exists to prevent, one
  // section above where it prevents it.
  //
  // `route-no-job` is our own CreateProcessW with no job of ours assigned. It
  // pairs with `route` on the job alone, and that pair is the whole reading now.
  // The forked row that used to sit beneath it is gone with the cell (RR-3): it
  // was labelled *not the attribution* every time it printed, which is a row
  // asking the reader to discount it rather than an input to anything.
  process.stdout.write(
    'ORDERING — was the job in force at instruction ONE? (ADR-0023 §1)\n\n',
  );
  for (const cell of ['route', 'route-no-job', 'lowbox', 'lowbox-no-job']) {
    const run = runs.find((entry) => entry.cell === cell);
    const ordering = /** @type {Record<string, unknown> | undefined} */ (
      /** @type {Record<string, unknown>} */ (run?.spawn ?? {})['ordering']
    );
    process.stdout.write(
      `  ${cell.padEnd(8)} ${ordering === undefined ? 'NO ORDERING RECORDED' : JSON.stringify(ordering)}\n`,
    );
  }
  const routeSpawn = probe('route', 'spawnAtStartup');
  const noJobSpawn = probe('route-no-job', 'spawnAtStartup');
  const orderingShown =
    verdict(routeSpawn, noJobSpawn) === 'DIFFERS' &&
    noJobSpawn.outcome === 'allowed' &&
    routeSpawn.outcome === 'refused';
  process.stdout.write(
    `\n  the host's FIRST action is a spawn attempt, so its outcome is the reading:\n` +
      `    route-no-job (our route, NO job)   ${noJobSpawn.outcome.padEnd(9)} ${noJobSpawn.detail}\n` +
      `    route        (our route, job)      ${routeSpawn.outcome.padEnd(9)} ${routeSpawn.detail}\n\n` +
      `  ${orderingShown
        ? 'ASSIGNED BEFORE THE FIRST INSTRUCTION. previousSuspendCount 1 says the process was\n' +
          '  genuinely created suspended, and the refusal says the job was already in force when\n' +
          '  it resumed — with the creation route held fixed across the pair, so the job is the\n' +
          '  only thing that differs. The PP-6 handshake is unnecessary for this window.'
        : 'NOT SHOWN. Either route-no-job was also refused — in which case the refusal is not\n' +
          '  the job and proves nothing — or route spawned, in which case the job was NOT in\n' +
          '  force at instruction one and the window is still open.'}\n\n`,
  );

  // ---------------------------------------------------------------------------
  // ONE UNCONTAINED VARIANT PER PROPERTY (finding RR-2), brought here by WW-1.
  //
  // A run that applies every mechanism and reports every denial cannot say which
  // mechanism produced which denial — the union problem that cost this project
  // its sandbox attribution. So each row names its OWN pair, differing in
  // exactly the mechanism whose absence the row is reading.
  //
  // A property whose two cells AGREE is UNASSERTED no matter what else this
  // prints, and the table says so by name rather than leaving a reader to
  // notice.
  //
  // WHY (b) PROCESS CREATION GETS TWO ROWS. With both mechanisms present the
  // outcome is over-determined: a LowBox refuses a spawn for its own reasons, so
  // `lowbox` against `lowbox-no-job` would read the job's contribution through a
  // container that already refuses. Each mechanism is therefore read against the
  // pair in which the OTHER one is absent on both sides.
  // ---------------------------------------------------------------------------
  /** @type {Array<[string, string, string, string, string]>} */
  // EVERY ROW CARRIES THE VERDICT IT MUST HAVE (finding RR-3, the proof half).
  //
  // Printing a measured verdict and printing an ASSERTED one are different
  // things, and this file did the first for as long as it was research. A row
  // that silently flipped from DIFFERS to `same` — containment stopping working
  // — printed `same` and exited 0, because nothing said which answer the
  // invariant requires.
  //
  // The expected value is part of the row rather than a list beside it, for the
  // reason the registries exist: a table where the claim and its evidence sit
  // apart is a table someone updates half of.
  //
  // `same` IS the correct expectation for two of these and saying so is load
  // bearing: the engine and the document must work INSIDE the container, so a
  // DIFFERS on either means the host cannot do its job.
  //
  // ONE ROW EXPECTS `either`, AND THAT IS A COVERAGE REDUCTION WITH A
  // MEASUREMENT BEHIND IT (audit item 2a, weakening direction).
  //
  // `(b) process creation — LowBox alone` expected `same`, on WW-1's finding
  // that the container does not deliver process creation and the job does. That
  // was measured here and it is not universal. On `windows-latest`, 2026-08-23,
  // the contained cell with no job of ours was **refused EPERM** where this
  // machine allows it — so the AppContainer denies process creation on that
  // build and not on Windows 11.
  //
  // Neither answer can be asserted, and the design conclusion survives both,
  // which is why this is a reduction rather than a problem: ADR-0023 Decision 8
  // rests on *you cannot rely on the container for (b)*, and a mechanism that
  // is present on some builds and absent on others is exactly something you
  // cannot rely on. The row is stronger evidence for that than a uniform `same`
  // would have been.
  //
  // It does not become unasserted. `either` asserts the UNCONTAINED side is
  // allowed — the half that makes row one's refusal attributable to the job —
  // and prints the contained side's outcome for a reader. Without that, a row
  // expecting `either` would be satisfied by two cells that both died.
  /** @type {ReadonlyArray<readonly [string, string, string, string, string, string]>} */
  const PROPERTIES = [
    ['(b) process creation — job alone', 'spawnAtStartup', 'route', 'route-no-job', 'DIFFERS',
      'the job, at Medium integrity on both sides so the container cannot be the cause'],
    ['(b) process creation — LowBox alone', 'spawnAtStartup', 'lowbox-no-job', 'route-no-job', 'either',
      'the container, with no job of ours on either side — MEASURED, NOT ASSERTED, see below'],
    ['(d) filesystem, JS', 'jsReadUnhanded', 'lowbox', 'route', 'DIFFERS',
      'a file the host was not handed, read through Node'],
    ['(d) filesystem, native', 'nativeReadUnhanded', 'lowbox', 'route', 'DIFFERS',
      'the same file through CreateFileW — the path the adversary has'],
    ['(c) network', 'loopback', 'lowbox', 'route', 'DIFFERS',
      'a loopback connection, so a refusal cannot be a runner with no network'],
    ['engine', 'loadShim', 'lowbox', 'route', 'same', 'the MuPDF shim, loaded through koffi'],
    ['document', 'openDocument', 'lowbox', 'route', 'same', 'a document it WAS handed'],
    ['IPC', 'namedPipe', 'lowbox', 'route', 'DIFFERS',
      'a named pipe main created — the MessagePort is unreachable off the fork route'],
    ['CONTROL: handed', 'readHanded', 'lowbox', 'route', 'same',
      'must be `same` and allowed on BOTH sides, or the container was handed nothing'],
  ];

  process.stdout.write('PROPERTIES — each row against the cell that removes ONLY its own mechanism:\n\n');

  let unreadable = 0;
  for (const [label, key, withMech, without, expected, why] of PROPERTIES) {
    const contained = probe(withMech, key);
    const uncontained = probe(without, key);
    const decided = verdict(contained, uncontained);
    if (decided === 'UNREADABLE') unreadable += 1;
    // `either` asserts the UNCONTAINED half instead of the comparison. See the
    // note on the table above for the measurement that made this row's
    // direction environment-dependent.
    const held = expected === 'either' ? uncontained.outcome === 'allowed' : decided === expected;
    const mark = held ? 'ok' : 'FAIL';
    process.stdout.write(
      `  ${mark.padEnd(5)}${decided.padEnd(11)} ${label} (expected ${expected})\n` +
        `              ${why}\n` +
        `              ${withMech.padEnd(13)} ${contained.outcome.padEnd(11)} ${contained.detail}\n` +
        `              ${without.padEnd(13)} ${uncontained.outcome.padEnd(11)} ${uncontained.detail}\n\n`,
    );
    assert(
      expected === 'either'
        ? `${label}: the UNCONTAINED cell is allowed, whichever way the container falls`
        : `${label} is ${expected}`,
      held,
      `measured ${decided}. ${withMech} said ${contained.outcome} (${contained.detail}); ` +
        `${without} said ${uncontained.outcome} (${uncontained.detail}). ` +
        (expected === 'either'
          ? 'This row does not assert a direction — the container denies process creation on ' +
            'some Windows builds and not others — but the uncontained cell must still be able ' +
            'to spawn, or two dead cells would satisfy it.'
          : decided === 'UNREADABLE'
            ? 'UNREADABLE is not a verdict — could-not-look and looked-and-found-containment do ' +
              'not share an output, so this is a broken run rather than a lost property.'
            : 'This row measures ONE mechanism, so the pair differing or agreeing is the ' +
              'property itself changing.'),
    );
  }

  // ---------------------------------------------------------------------------
  // (b) MEMORY: THE BLOCKER MOVED, AND THE STATE IS DIFFERENT (audit item 2a).
  //
  // This row read "the job here sets no memory limit", and that stopped being
  // true when the cells moved onto the shipped surface. `applyLimits` REQUIRES
  // a limit — there is no way to use the shipped job without one — so the job
  // now carries §9.17's absolute cap for `mupdf-host`, derived by the module
  // that owns the rule.
  //
  // **The mechanism arrived as a side effect of using shipped code, not as the
  // separate work this row anticipated**, and that is exactly the kind of
  // improvement that goes unrecorded because nothing goes red. The two states
  // are not the same and must not share an output:
  //
  //   was: no mechanism    — nothing set a limit, so nothing could be measured
  //   now: no probe        — the limit is in force and nothing allocates past it
  //
  // What is still owed is a probe that commits past the cap and reports the
  // refusal, which `hostFixture.mjs` had as `commit768MB` against a 512 MB
  // literal its own comment flagged as PP-4. The literal is what could not come
  // across; the limit came across on its own.
  //
  // Not silently upgraded either: a reduction nobody prints is a reduction
  // nobody reviews, and the same is true of a gain — this row is what a reader
  // sees, so it says which state it is in.
  // ---------------------------------------------------------------------------
  process.stdout.write(
    '  NOT MEASURED  (b) memory — the LIMIT is in force, the PROBE is missing\n' +
      `              The job carries §9.17's absolute mupdf-host cap (${String(PROCESS_MEMORY_LIMIT)}\n` +
      '              bytes), derived by scripts/lib/memoryBudgets.mjs and applied by the SHIPPED\n' +
      '              surface — it arrived with the migration onto that surface rather than as\n' +
      '              separate work, because applyLimits has no undefaulted form.\n' +
      '              So this is no longer "no mechanism". What is owed is a probe that commits\n' +
      '              past the cap and reports the refusal. hostFixture.mjs had one, against a\n' +
      '              512 MB literal it flagged as PP-4; the literal is what could not travel.\n\n',
  );

  // ---------------------------------------------------------------------------
  // THE CONTROL FOR THE UNASSERTED RULE, run every time rather than trusted, and
  // brought across with the classifier because neither is worth much alone.
  //
  // MUTATED ON THE CONTAINED SIDE deliberately. Removing the UNCONTAINED reading
  // passes today for the wrong reason — two missing readings AGREE, so the row
  // prints `same` — and that direction never reaches the defect. Only a missing
  // CONTAINED reading beside a present uncontained one can manufacture the
  // reassuring verdict, which is the direction the bug takes.
  // ---------------------------------------------------------------------------
  {
    const damaged = runs.map((entry) =>
      entry.cell !== 'lowbox' || entry.report === null
        ? entry
        : {
            ...entry,
            report: {
              ...entry.report,
              probes: Object.fromEntries(
                Object.entries(entry.report.probes ?? {}).filter(
                  ([key]) => key !== 'nativeReadUnhanded',
                ),
              ),
            },
          },
    );
    const missing = verdict(
      probeIn(damaged, 'lowbox', 'nativeReadUnhanded'),
      probeIn(damaged, 'route', 'nativeReadUnhanded'),
    );

    process.stdout.write(
      `  ${(missing === 'UNREADABLE' ? 'ok' : 'FAIL').padEnd(5)}` +
        `CONTROL: with the CONTAINED reading removed, that row reads ${missing}\n` +
        `              It must be UNREADABLE. Classified from an absence it read as a refusal beside\n` +
        `              an allowed uncontained side, so the table printed a containment verdict for a\n` +
        `              property nothing had measured — the claim QQ-1 removed from row 283,\n` +
        `              regenerated by a missing value.\n\n`,
    );
    assert(
      'CONTROL: a missing CONTAINED reading makes its row UNREADABLE',
      missing === 'UNREADABLE',
      `read ${missing} instead. Every row above is believed on the strength of this: an absence ` +
        `classified as a refusal, beside an allowed uncontained side, manufactures exactly the ` +
        `verdict a containment proof wants to see.`,
    );
    if (missing !== 'UNREADABLE') unreadable += 1;
  }

  if (unreadable > 0) {
    process.stdout.write(
      `${unreadable} row(s) could not be read. That is not a result — could-not-look and ` +
        `looked-and-found-containment\ndo not share an output, so this exits non-zero (finding SS-2).\n`,
    );
    return 1;
  }
  return 0;
}
