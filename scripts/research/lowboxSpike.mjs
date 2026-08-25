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
 * | (b) process creation — LowBox alone | spawned on a Windows 11 client dev machine, refused `EPERM` on Server 2025 AND Server 2022 (both CI images) | `route-no-job` spawned | **either — axis under-determined** |
 * | (d) filesystem, JS | refused `EPERM` | read 6250 bytes | **differs** |
 * | (d) filesystem, native | refused `CreateFileW: error 5` | read 4096 bytes | **differs** |
 * | (c) network, loopback | refused `ETIMEDOUT` | connected | **differs** |
 * | engine | `mz_init` created a context | same | same |
 * | document it WAS handed | opened, 1 page | same | same |
 * | IPC — a pipe Node created | refused `EPERM` | connected | **differs** |
 * | IPC — a Win32 pipe with the container in its DACL | **connected** | connected | same |
 * | IPC — the same Win32 pipe, Built-in Users only | refused `EPERM` | connected | **differs** |
 * | (b) memory — job alone | `route-small-limit` refused at 192 MB under a 256 MB cap | `route-no-job` committed 512 MB | **differs** |
 * | (b) memory — the LIMIT, not the job | `route` committed 512 MB under §9.17's 3 GB cap | same | same |
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
 * **THREE POINTS, AND THE READING IS UNDER-DETERMINED** (finding AAAA-8) —
 * measured 2026-08-23 at `0909970`, CI run 32659310667. Windows 11 client
 * allows; Windows Server 2025 (`windows-latest`) refuses; Windows Server 2022
 * (`windows-2022`) refuses. The second server reading was a prediction before it
 * was a measurement: its pin was landed as a deliberate probe against the
 * competing chronological hypothesis, and resolved on its first run.
 *
 * This was recorded as *client versus server* for one day, and that claim is
 * stronger than the evidence. **Two of the three points are GitHub-hosted CI
 * images and the third is a developer machine**, so the single client point is
 * also the single not-a-CI-image point: a different install, different local
 * policy, different security software, a different AppContainer profile history.
 * *Client versus server* and *this machine versus a CI image* survive all three
 * readings equally.
 *
 * ## The discriminating test, its price, and what it can and cannot say
 *
 * It is reachable. `windows-11-arm` is Windows 11 — a client SKU — and it is
 * GitHub-hosted (read from `actions/runner-images` 2026-08-23; the same table no
 * longer lists a 2019 image). It is **arm64**, so it swaps the image-provenance
 * confounder for an architecture one and costs an arm64 MuPDF build and an arm64
 * Electron.
 *
 * **THE TEST IS ASYMMETRIC, and anyone spending that money should know which
 * answer they are buying.** Client SKU and arm64 move together there, so:
 *
 *   - a **refusal** kills the client/server reading outright unless architecture
 *     explains it — genuinely informative;
 *   - an **allow** confirms nothing, because client and arm64 are one variable
 *     in that run.
 *
 * It can falsify and it cannot confirm. Buying it to confirm the hypothesis is
 * buying an outcome the design cannot produce.
 *
 * ## And what the answer would change, which today is nothing
 *
 * ADR-0023 Decision 8 rests on *the container cannot be relied on for (b)*, and
 * all three points support that. This row asserts `either` across images and
 * pins per image, so no verdict here moves whichever way the axis falls.
 *
 * What the axis actually bears on is the SHIPPING configuration: real users run
 * Windows 11 client **x64** — the one point where the container allows the spawn
 * — so if the reading holds, the job object carries invariant 25(b) on every
 * machine this product will ever run on, which is what Decision 8 already
 * asserts.
 *
 * **So this is worth recording and not worth scheduling.** It becomes worth
 * buying the day a design leans on the container for (b), and not before. A
 * price with no consequence beside it is an open question nobody can rank.
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
 *   3. **IPC is not free, AND THE REMEDY IS NOW MEASURED (finding AAAA-39).**
 *      Node's named-pipe server sets no DACL for the container, so the contained
 *      host cannot connect to it — and a MessagePort is unreachable off the fork
 *      route by construction. That was the negative half, and until 2026-08-24
 *      it was the only half: ADR-0023 §4 fixed the transport as a Win32-created
 *      pipe with the container SID in its DACL, an inference standing beside a
 *      measurement of something else, and nothing in this repository had ever
 *      built a security descriptor at all.
 *
 *      It is measured now, in one run, three pipes differing only in creation
 *      route and DACL. The contained cells **open** the Win32 pipe whose DACL
 *      names the container, are **refused** the identical Win32 pipe carrying
 *      Built-in Users alone, and are **refused** Node's. The uncontained cells
 *      open all three, which is what makes a refusal readable rather than
 *      ambiguous with a malformed descriptor. So the ACE is the cause, not the
 *      creation route, and the job is not a variable — `lowbox` and
 *      `lowbox-no-job` agree on every one of the three.
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
 *          [--expect-lowbox-spawn=refused|allowed]
 *
 * `--expect-lowbox-spawn` is MANDATORY under `--require-containment` and pins
 * what the AppContainer does about process creation on this runner image — the
 * one value this file deliberately does not assert. See {@link lowboxSpawnPin}.
 *
 *   --reset  delete a leftover profile and its grants from a crashed run, then
 *            exit. Explicit operator action to clear machine state; it clears
 *            nothing this run would otherwise have checked.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import koffi from 'koffi';

import { createRoster } from '../lib/passRoster.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
// `isInvalidHandle` is no longer imported here: the only caller was this file's
// own `CreateNamedPipeW`, and the shipped surface answers that question now —
// through `win32HostSurface.ts`'s derived copy, which `proof:win32handle`
// requires to agree with this module on every value.
import { INVALID_HANDLE_SOURCE } from '../lib/win32Handle.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

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
 * THE PER-IMAGE PIN for the one row this proof deliberately does not assert
 * (finding AAAA-1).
 *
 * `(b) process creation — LowBox alone` expects `either`, because the container
 * refuses process creation on some Windows builds and permits it on others. That
 * is the right verdict for a cross-image statement and it left the value with no
 * recorder at all: the row printed the contained outcome for a reader, CI has no
 * reader, and so the only event anybody cares about — **the outcome changing on
 * an image** — was unobservable. A claim with no expiry, inside the one row that
 * exists because the fact varies.
 *
 * So the value is pinned per image, beside the `runs-on:` that chooses the
 * image, in the diff rather than in a table someone has to map. `either` is
 * untouched as the cross-image statement in the header table and in ADR-0023
 * Decision 8; this pins what THIS runner must produce.
 *
 * **Mandatory under `--require-containment`.** Absent is a hard failure, or a
 * future job opts out by omission — which is the reassuring direction and the
 * exact shape of the `if:` that was rejected when this job was designed.
 *
 * @returns {'refused' | 'allowed' | null}
 */
function lowboxSpawnPin() {
  const flag = process.argv.find((argument) => argument.startsWith('--expect-lowbox-spawn='));
  if (flag === undefined) return null;
  const value = flag.slice('--expect-lowbox-spawn='.length);
  if (value !== 'refused' && value !== 'allowed') {
    process.stderr.write(
      `\n--expect-lowbox-spawn takes 'refused' or 'allowed'; got '${value}'.\n` +
        `  This pins what the AppContainer does about process creation on THIS runner image.\n`,
    );
    process.exit(1);
  }
  return value;
}

const LOWBOX_SPAWN_PIN = lowboxSpawnPin();

if (REQUIRE && LOWBOX_SPAWN_PIN === null) {
  process.stderr.write(
    `\n--require-containment without --expect-lowbox-spawn=<refused|allowed>.\n\n` +
      `  The LowBox-alone process-creation row asserts 'either' by design, so nothing else in\n` +
      `  this file can notice when its answer changes on an image. The pin is what records it,\n` +
      `  and a job that omits the flag would opt out of the one reading it was added to take.\n`,
  );
  process.exit(1);
}

/**
 * Refuses to measure, in the one way that is not a pass.
 *
 * Exits 0 so a machine that cannot host an AppContainer is not reported as a
 * containment failure, and prints UNVERIFIABLE so it is not reported as a pass
 * either. Under `--require-containment` the same condition is a hard failure,
 * because on a job that provisions everything, "could not look" means something
 * broke.
 *
 * THE RULE MOVED to `scripts/lib/unverifiable.mjs`, and what is left here is the
 * subject and the flag. It was settled in this file first, and then written a
 * second and third time — weaker both times, without the strict half — in
 * `transportTeardown.mjs` and `transportWrite.mjs`, by the author who had this
 * one open. A rule that lives in call sites is one the next caller re-derives
 * (B3a).
 *
 * @param {string} why
 * @returns {never}
 */
function unverifiable(why) {
  exitUnverifiable({
    required: REQUIRE,
    subject: "invariant 25's containment",
    why,
    flag: '--require-containment',
  });
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

  // (b) MEMORY. LAST, AND IT RELEASES — both halves are a recorded lesson.
  //
  // The retired hostFixture.mjs committed 768 MB BEFORE its reads, and under the
  // job's limit the 235 MB document read then failed with
  // ERR_MEMORY_ALLOCATION_FAILED — which its attribution table read as the
  // FILESYSTEM property being enforced. A probe that leaves the process at its
  // ceiling is not measuring one property, it is changing the conditions of
  // every property after it. So this runs after every other probe has settled,
  // and drops its chunks before the report is written.
  //
  // Buffers rather than a typed array on the V8 heap: an allocation V8 cannot
  // satisfy aborts the process, and an aborted host writes no report at all —
  // which arrives as "no report" and is indistinguishable from a host that never
  // started. Buffer.alloc fails by THROWING, which is a reading.
  step('commitPastLimit');
  if (COMMIT_TARGET > 0) {
    var chunks = [];
    var committed = 0;
    try {
      while (committed < COMMIT_TARGET) {
        chunks.push(Buffer.alloc(COMMIT_CHUNK, 1));
        committed += COMMIT_CHUNK;
      }
      report.probes.commitPastLimit = allowed('committed ' + String(committed) + ' bytes');
    } catch (error) {
      report.probes.commitPastLimit = refused(
        'at ' + String(committed) + ' bytes: ' + String(error && error.message).slice(0, 70),
      );
    }
    // Dropped before the write, so the report path's own allocation is not
    // competing with this probe's ceiling.
    chunks.length = 0;
    chunks = null;
  } else {
    report.probes.commitPastLimit = errored('no commit target was handed to this host');
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

// CAN THE HOST REWRITE THE TRANSPORT'S OWN DACL? (finding BBBB-4.)
//
// The shipped descriptor granted GENERIC_ALL to the container, and GA maps to
// FILE_ALL_ACCESS, which carries STANDARD_RIGHTS_REQUIRED — so it included
// WRITE_DAC and FILE_CREATE_PIPE_INSTANCE. The principal invariant 25 declares
// contains a compromise could therefore rewrite the DACL of its own trust
// boundary and decide who else may reach the channel.
//
// The mask is now 0x0012019B: FILE_GENERIC_READ|FILE_GENERIC_WRITE minus 0x4.
// That is measured rather than reasoned, and this is the measurement.
//
// THE INPUT IS ONE THE ABSENT GUARD WOULD LET THROUGH, which is the whole
// design of this pair. Opening a pipe that is not reachable at all would be
// refused for a reason that has nothing to do with the mask, so:
//
//   dacWriteShipped   the shipped pipe, opened for WRITE_DAC — must be REFUSED
//                     for the contained cell. The uncontained one is ALLOWED and
//                     cannot be otherwise: it runs as the object's OWNER, which
//                     holds WRITE_DAC implicitly whatever the DACL says.
//   dacWriteGranted   the BU+container pipe, which still carries GA, opened the
//                     SAME way by the SAME cell — ALLOWED, which both proves the
//                     probe can open something and demonstrates the defect: the
//                     old descriptor let the contained host do this.
//
// One call, one access mask, two descriptors. A Node socket connect cannot ask
// for WRITE_DAC, so this has to be native — which is also the adversary's route.
const openForDacWrite = (probe, name) => {
  if (!name) {
    report.probes[probe] = errored('no handed config, so no pipe name to try');
    return;
  }
  if (koffi === null) {
    report.probes[probe] = errored('koffi never loaded, so the native path was never reached');
    return;
  }
  try {
    const kernel = koffi.load('kernel32.dll');
    const CreateFileW = kernel.func(
      'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disp, uint32 flags, void *tmpl)',
    );
    const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
    const GetLastError = kernel.func('uint32 GetLastError()');
    // WRITE_DAC alone. Not combined with read or write access: the question is
    // whether this principal may change the descriptor, and asking for more
    // would let a denial be about the something else.
    const handle = CreateFileW(name, 0x00040000, 3, null, 3, 0x80, null);
    if (isInvalidHandle(koffi, handle)) {
      report.probes[probe] = refused('CreateFileW WRITE_DAC: error ' + GetLastError());
    } else {
      CloseHandle(handle);
      report.probes[probe] = allowed(CELL + ' opened ' + name + ' for WRITE_DAC');
    }
  } catch (error) {
    report.probes[probe] = errored(String(error && error.message));
  }
};

step('dacWrite');
openForDacWrite('dacWriteShipped', config === null ? null : config.win32SidOnly);
openForDacWrite('dacWriteGranted', config === null ? null : config.win32Granted);

// (c) NETWORK, on LOOPBACK. A remote target cannot separate "refused by policy"
// from "this runner has no network" — the two produce one observation, and that
// mistake has been made three times here (HH-2). Main listens on 127.0.0.1, so
// an unconstrained host connects and a refusal is the container.
const afterNetwork = () => {
  step('namedPipe');
  // AND THE IPC QUESTION, which is what a contained host would actually need:
  // a MessagePort is unreachable because this process was not forked by Electron,
  // so a named pipe is the realistic candidate and its reachability is the price.
  // THREE PIPES, EACH REPORTED BY THE CELL THAT OPENED IT. The access check
  // happens here, at the client's open, so no native code is needed on this
  // side and nothing counts connections on the other: this report says whether
  // THIS cell got in, which is what makes an uncontained connection unable to
  // read as a contained one.
  const tryPipe = (probe, name, next) => {
    if (!name) {
      report.probes[probe] = errored('no handed config, so no pipe name to try');
      next();
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      report.probes[probe] = value;
      next();
    };
    const socket = net.connect(name);
    socket.on('connect', () => { socket.end(); done(allowed(CELL + ' opened ' + name)); });
    socket.on('error', (error) => done(refused(String(error && error.code || error))));
    setTimeout(() => done(errored('no result within the window')), 5000);
  };

  const handed = config === null ? {} : config;
  tryPipe('namedPipe', handed.pipe, () =>
    tryPipe('namedPipeWin32Granted', handed.win32Granted, () =>
      tryPipe('namedPipeWin32SidOnly', handed.win32SidOnly, () =>
        tryPipe('namedPipeWin32UserOnly', handed.win32UserOnly, finish))));
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
 * THE PIPE IS CREATED BY THE SHIPPED SURFACE TOO, for the reason stated above
 * about the host: **anything that creates has exactly one implementation.**
 *
 * This file held the only one until `enginePipeFactory.ts` and
 * `win32PipeSurface.ts` existed, and the note above says to write the next
 * addition on the correct side of that line. Creating a pipe is creating.
 *
 * The split that survives is between the SHIPPED descriptor and the control
 * ones. `createHostPipe` assembles its DACL from two branded SIDs and cannot
 * express `D:(A;;GA;;;BU)` — which is the point of it — so the control pipes,
 * whose descriptors are deliberately wrong, drive the same surface directly
 * through `describe` and `createInstance`. One set of Win32 calls, two callers,
 * and the wrong descriptors are unrepresentable in the shipped path.
 */
const BUILT_PIPE_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js');
const BUILT_PIPE_FACTORY = join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js');
for (const built of [BUILT_PIPE_SURFACE, BUILT_PIPE_FACTORY]) {
  if (!existsSync(built)) {
    unverifiable(
      `The Win32 pipe surface is not built at ${built}. Every pipe below is created through the ` +
        `SHIPPED module rather than a copy of it, so without the build there is nothing to ` +
        `measure. Run \`npm run build\`.`,
    );
  }
}
const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
  pathToFileURL(BUILT_PIPE_SURFACE).href
);
const { createHostPipe } = await import(pathToFileURL(BUILT_PIPE_FACTORY).href);

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

/**
 * The (b) MEMORY probe's numbers, and the reason they are not §9.17's cap.
 *
 * §9.17 puts `mupdf-host` at **3 GB**. A differential needs the UNCONTAINED side
 * to succeed, so measuring against the real cap means committing more than 3 GB
 * on a CI runner — and when that fails for runner memory pressure rather than
 * for the job, both cells report `refused`, the row reads `same`, and a red
 * board says the containment broke. **The instrument would be reporting the
 * runner's memory as this project's defect**, which is the opposite of the
 * attribution every other row here is built to protect.
 *
 * So the differential runs against a limit chosen to be provable: a cell whose
 * job carries {@link SMALL_MEMORY_LIMIT} refuses a commit the same host with no
 * job of ours completes.
 *
 * **WHAT THIS DOES AND DOES NOT ESTABLISH, stated because the difference is the
 * whole of the owed work.** It establishes that the job's memory limit is IN
 * FORCE — a commit past it fails, in the shipped surface, on a running process.
 * It does not establish that 3 GB is the number, and it is not evidence about
 * §9.17. That number is a derivation, and `proof:composition` already requires
 * the surface's limit to equal §9.17's line; a behavioural probe cannot check a
 * derivation and a derivation cannot check enforcement.
 *
 * A third cell falls out of it for free and is worth having: `route` carries the
 * REAL 3 GB cap and allocates the same target without difficulty, so the refusal
 * is attributable to the limit's VALUE rather than to a job existing at all.
 */
const SMALL_MEMORY_LIMIT = 256 * 1024 * 1024;
const COMMIT_TARGET_BYTES = 512 * 1024 * 1024;
const COMMIT_CHUNK_BYTES = 32 * 1024 * 1024;

const kernel = koffi.load('kernel32.dll');
const GetLastError = kernel.func('uint32 GetLastError()');
const WaitForSingleObject = kernel.func('uint32 WaitForSingleObject(void *handle, uint32 ms)');
const GetExitCodeProcess = kernel.func('bool GetExitCodeProcess(void *proc, _Out_ uint32 *code)');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)',
);
const ConnectNamedPipe = kernel.func('bool ConnectNamedPipe(void *pipe, void *overlapped)');
// The CRT, not kernel32: turning a Win32 HANDLE into a C runtime file
// descriptor is the CRT's question, and `net.Socket({ fd })` takes the second.
const ucrt = koffi.load('ucrtbase.dll');
const openOsfHandle = ucrt.func('int _open_osfhandle(void *handle, int flags)');
const getOsfHandle = ucrt.func('void *_get_osfhandle(int fd)');
const GetFileType = kernel.func('uint32 GetFileType(void *handle)');

/** `GetFileType` for a named pipe. */
const FILE_TYPE_PIPE = 0x0003;

/** `ConnectNamedPipe` when a client is already at the other end. */
const ERROR_PIPE_CONNECTED = 535;


/**
 * This process's own user SID, as a string.
 *
 * ## Why a DACL needs it, which ADR-0023 §4's sentence does not say
 *
 * MEASURED 2026-08-24: a one-instance pipe carrying `D:(A;;GA;;;<container>)`
 * and nothing else refused **the contained cell**, EPERM, on the same run in
 * which `D:(A;;GA;;;BU)(A;;GA;;;<container>)` admitted it. An AppContainer
 * token's access check is CONJUNCTIVE: the DACL must grant the requested access
 * to the token's ordinary identity — its user or a group it is in — AND to the
 * package SID. The container SID alone satisfies half of a two-part test.
 *
 * So *"the container SID in its DACL"* is necessary and not sufficient, and a
 * surface built to that sentence alone produces a pipe nobody can open. What
 * Built-in Users was doing in the spike's other two pipes was standing in for
 * the identity half by accident.
 *
 * The tightening that remains real is this SID instead of `BU`: Built-in Users
 * is every user of the machine, and the user's own SID is one of them.
 *
 * ## MOVED, and this note is what is left of it
 *
 * The reader itself is `currentUserSid` in `apps/desktop/src/win32PipeSurface.ts`
 * and this file imports it. It was written here first — the measurement above is
 * why it exists at all — and moving it is the same rule the host surface's
 * migration followed: **anything that creates has exactly one implementation**,
 * and a SID that goes into a shipped descriptor is part of creating.
 *
 * What stays here is the MEASUREMENT, because that is an observation and
 * observations belong in the instrument that took them.
 */

// ---------------------------------------------------------------------------
// A NAMED PIPE CREATED THROUGH WIN32 WITH AN EXPLICIT DACL (finding AAAA-39).
//
// ADR-0023 §4 fixes the transport as "a named pipe main creates with the
// container SID in its DACL", because Node's `net.createServer` sets no DACL
// for the container — measured, and the measurement is the NEGATIVE half. The
// positive half has never been taken: nothing in this repository had ever built
// a security descriptor at all (the one `SECURITY_ATTRIBUTES` in the tree sets
// `lpSecurityDescriptor: null` to mark a handle inheritable), so the shipped
// mechanism rested on an inference standing beside a measurement of something
// else.
//
// This is the instrument that measures it, and `engineHostFactory.ts` says why
// it has to exist before the surface does: a native surface's shape comes from
// a call this spike already makes, not from a reading of the API.
//
// THE ACCESS CHECK HAPPENS CLIENT-SIDE, which is what makes this cheap. A
// client's `CreateFile` against a listening instance is where the DACL is
// evaluated, so the cells need no native code — each opens the pipe with the
// same `net.connect` they already use and reports its OWN result. Identification
// is therefore structural rather than counted: there is no server-side tally in
// which an uncontained connection could read as a contained one.
//
// The parent never calls `ConnectNamedPipe`. It does not need to — an instance
// in listening state is connectable — and the question is whether the client is
// permitted to open it, not what is said afterwards.
// ---------------------------------------------------------------------------

const CloseHandle = kernel.func('bool CloseHandle(void *handle)');

/** Enough instances for every cell to open every pipe once, with margin. */
const PIPE_INSTANCES = 8;

/**
 * The shipped surface, created once. Every pipe below goes through it.
 *
 * What used to sit here was this file's own `CreateNamedPipeW`,
 * `ConvertStringSecurityDescriptorToSecurityDescriptorW` and
 * `MONSTERA_PIPE_SECURITY_ATTRIBUTES` — a second implementation of creating a
 * pipe, which the host-surface migration's own note said to avoid the moment a
 * shipped one existed. It now exists.
 */
const pipeSurface = createWin32PipeSurface();

/**
 * Create one named pipe's instances with the DACL named by `sddl`.
 *
 * ## THE INSTANCE COUNT IS PART OF THE SECURITY DESCRIPTOR'S MEANING, measured
 * 2026-08-24 on this machine
 *
 * `CreateNamedPipeW` for instance 0 creates the object and is not access
 * checked. Every LATER instance opens the existing object by name and IS —
 * against the DACL just written. So a descriptor naming only the container SID
 * denies the creating process its own second instance:
 *
 *   D:(A;;GA;;;<container>)                  instance 1 → GetLastError 5
 *   D:(A;;0x00000004;;;OW)(A;;GA;;;<sid>)    instance 1 → GetLastError 5
 *   D:(A;;GA;;;OW)(A;;GA;;;<sid>)            created — and an uncontained
 *                                            same-user cell then CONNECTS
 *
 * The middle line is the informative one. `FILE_CREATE_PIPE_INSTANCE` alone is
 * not enough, because `PIPE_ACCESS_DUPLEX` asks for read and write on the
 * object — the same rights a client's `CreateFileW` asks for. **There is no ACE
 * that lets the creator add an instance and does not also let any process of
 * that user connect**, which is why the third line admits `route`.
 *
 * So the tightest DACL a multi-instance pipe can carry is one that admits every
 * process of the owning user, and **the tightest pipe is a ONE-INSTANCE pipe**,
 * where no second creation happens and no access check is ever made against the
 * creator. That is also the shipped shape by count: one host, one connection.
 * The single instance is a B5 property as well as a security one — a pipe with
 * one instance cannot be connected to twice, so an impostor racing the host for
 * the channel is unrepresentable rather than guarded against.
 *
 * ## CONTROL PIPES ONLY, and the shipped factory is what makes that a rule
 *
 * This takes an SDDL STRING, which `createHostPipe` deliberately cannot: the
 * shipped path assembles its descriptor from two branded SIDs so that no caller
 * can hand it text. The pipes that need a deliberately wrong descriptor —
 * Built-in Users alone, Built-in Users plus the container — cannot go through
 * that path, which is the design working rather than a gap in it.
 *
 * The Win32 calls are the shipped surface's either way. What is here is the
 * loop and a throw, both of which the shipped path expresses as a `Result`.
 *
 * @param {string} name
 * @param {string} sddl
 * @param {number} instances How many instances to create. See above: this
 *   decides whether the creator is access-checked against its own DACL.
 * @returns {{ handles: unknown[] }}
 */
function createControlPipe(name, sddl, instances) {
  const descriptor = pipeSurface.describe(sddl);
  if (descriptor === null) {
    // A DESCRIPTOR THAT DID NOT PARSE MUST NOT REACH THE MEASUREMENT. This is
    // the failure that would otherwise be indistinguishable from "the container
    // cannot reach a Win32 pipe" — the reading that would send someone into an
    // amendment they do not owe.
    throw new Error(
      `the security descriptor did not parse, so nothing below would measure the DACL: ` +
        `${sddl} (GetLastError ${String(pipeSurface.lastError())})`,
    );
  }
  /** @type {unknown[]} */
  const handles = [];
  for (let instance = 0; instance < instances; instance += 1) {
    const handle = pipeSurface.createInstance(name, descriptor, instances);
    if (handle === null) {
      for (const open of handles) pipeSurface.close(open);
      pipeSurface.freeDescriptor(descriptor);
      throw new Error(
        `CreateNamedPipeW failed for ${name} at instance ${String(instance)}: ` +
          `GetLastError ${String(pipeSurface.lastError())}`,
      );
    }
    handles.push(handle);
  }
  pipeSurface.freeDescriptor(descriptor);
  return { handles };
}

/**
 * The SHIPPED pipe, through the shipped factory, or a throw naming the stage.
 *
 * A thin adapter to this file's `{ handles }` shape and nothing else: the
 * ordering, the descriptor, the every-instance-or-none rule and the descriptor's
 * lifetime are all `createHostPipe`'s, which is the point of calling it.
 *
 * @param {string} name @param {number} instances
 * @param {unknown} user @param {unknown} container Branded SIDs from the
 *   shipped resolvers — see `resolveShippedSids`.
 * @returns {{ handles: unknown[] }}
 */
function createShippedPipe(name, instances, user, container) {
  const result = createHostPipe(pipeSurface, name, user, container, instances);
  if (!result.ok) {
    throw new Error(
      `the shipped pipe factory refused at stage '${result.error.stage}': ${result.error.detail}`,
    );
  }
  return { handles: [...result.value.instances] };
}

/**
 * The two branded SIDs the shipped factory needs, from the shipped resolvers.
 *
 * Resolved here rather than at module scope because `hostContainerSid` creates
 * the AppContainer profile when it is absent, and `ensureContainer` above wants
 * to be the one that reports whether THIS run created it. Called after that, the
 * shipped resolver takes its ALREADY_EXISTS path — which is the ordinary one on
 * every machine after first run, and therefore the path worth exercising.
 *
 * @returns {{ user: unknown, container: unknown }}
 */
function resolveShippedSids() {
  const user = currentUserSid();
  if (!user.ok) {
    throw new Error(`the shipped user-SID resolver failed, so no DACL can name this user: ${user.error}`);
  }
  const container = hostContainerSid(CONTAINER);
  if (!container.ok) {
    throw new Error(
      `the shipped container-SID resolver failed, so no DACL can name the container: ${container.error}`,
    );
  }
  return { user: user.value, container: container.value };
}

/**
 * One round trip over a pipe, with the SERVER side supplied by the caller.
 *
 * ## The question, and why it decides the shape of a module nobody has written
 *
 * ADR-0023 §4 says the pipe is "created through Win32 with an explicit security
 * descriptor and handed to Node". Everything measured so far is the ACCESS CHECK
 * AT A CLIENT'S OPEN: the cells connect with `net.connect`, and the parent has
 * never accepted a connection or read a byte on a Win32-created pipe. So
 * *handed to Node* is an inference about the half that carries the bytes.
 *
 * If libuv can adopt a `CreateNamedPipeW` handle, the surface creates the pipe
 * and hands it over, and `HostRuntimeTransport` sits on an ordinary Node stream.
 * If it cannot, the surface owns overlapped reads and writes itself — far more
 * code inside the one module allowed an `any`. Two materially different modules,
 * and the difference is one measurement.
 *
 * ## Its control is the other server
 *
 * The same client code, the same assertion, against Node's own `createServer`
 * pipe. Without it a silent echo says *libuv cannot drive this handle* and *my
 * harness is broken* in one breath — AAAA-39's ambiguity, in the unit
 * immediately after it.
 *
 * @param {string} name pipe name
 * @param {(client: import('node:net').Socket) => void} serve Attaches an echo to
 *   the server side once a client has connected. Called from the client's
 *   `connect` event, which is when `ConnectNamedPipe` can complete without
 *   blocking — a synchronous-mode handle with no client waiting would block the
 *   only thread this process has.
 * @returns {Promise<{ outcome: string, detail: string }>}
 */
function echoOnce(name, serve) {
  return new Promise((settle) => {
    let settled = false;
    /** @param {string} outcome @param {string} detail */
    const done = (outcome, detail) => {
      if (settled) return;
      settled = true;
      settle({ outcome, detail });
    };
    const client = connect(name);
    client.on('error', (error) => done('refused', `client: ${String(error.message)}`));
    client.on('connect', () => {
      try {
        serve(client);
      } catch (error) {
        done('error', error instanceof Error ? error.message : String(error));
        client.destroy();
        return;
      }
      client.write(Buffer.from('monstera'));
    });
    client.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      client.destroy();
      if (text === 'monstera') done('allowed', `${name} echoed ${text}`);
      else done('error', `echoed ${JSON.stringify(text)}, not what was written`);
    });
    setTimeout(() => {
      client.destroy();
      done('error', 'no echo within the window');
    }, 5000).unref();
  });
}

/**
 * Adopts one Win32 pipe instance into Node and echoes on it.
 *
 * Three steps, each of which can fail differently and is reported as itself:
 * complete the server side of the connection, turn the handle into a C runtime
 * descriptor, and hand that to `net.Socket`. A single "it did not work" would
 * make the next reader guess which.
 *
 * @param {unknown} handle a `CreateNamedPipeW` instance with a client attached
 * @returns {import('node:net').Socket}
 */
function adoptPipeHandle(handle) {
  // A client is already connected, so this returns FALSE with
  // ERROR_PIPE_CONNECTED rather than waiting. On a synchronous-mode handle with
  // no client it would block this process's only thread, which is why it is
  // called from the client's own connect event and never before.
  const connected = ConnectNamedPipe(handle, null);
  const why = GetLastError();
  if (!connected && why !== ERROR_PIPE_CONNECTED) {
    throw new Error(`ConnectNamedPipe refused the already-attached client: GetLastError ${String(why)}`);
  }
  const fd = openOsfHandle(handle, 0);
  if (fd < 0) throw new Error('_open_osfhandle gave no descriptor for the pipe handle');

  // THE DESCRIPTOR IS PROVEN TO POINT AT THE PIPE BEFORE NODE IS ASKED ABOUT IT.
  //
  // Node answers `Unsupported fd type: UNKNOWN` both when it cannot drive a
  // handle of this kind and when the descriptor points at nothing — which is
  // what a mis-marshalled pointer produces. The echo's control separates broken
  // CLIENT code from an impossible server half and says nothing about this step,
  // so the step carries its own: `_get_osfhandle` must give a handle whose
  // `GetFileType` is FILE_TYPE_PIPE.
  const roundTripped = getOsfHandle(fd);
  const kind = GetFileType(roundTripped);
  if (kind !== FILE_TYPE_PIPE) {
    throw new Error(
      `the descriptor does not point at the pipe: GetFileType(_get_osfhandle(${String(fd)})) = ` +
        `${String(kind)}, wanted ${String(FILE_TYPE_PIPE)} (GetLastError ${String(GetLastError())}). ` +
        `That is a marshalling failure in this harness, NOT an answer about what libuv can adopt.`,
    );
  }
  // AND WHETHER NODE'S OWN C RUNTIME KNOWS THE DESCRIPTOR, which is a different
  // question from whether ucrtbase does. `fstatSync` resolves the fd through the
  // CRT `node.exe` is linked against; EBADF here means the two tables are not
  // the same one, and THAT — not anything about pipes — is why Node cannot adopt
  // it. Asked before `net.Socket`, whose own message for both cases is the same
  // `Unsupported fd type: UNKNOWN`.
  let nodeSees = 'the descriptor';
  try {
    fstatSync(fd);
  } catch (error) {
    nodeSees = error instanceof Error && 'code' in error ? String(error['code']) : 'nothing';
  }
  if (nodeSees !== 'the descriptor') {
    throw new Error(
      `ucrtbase gave descriptor ${String(fd)} and GetFileType(_get_osfhandle(${String(fd)})) is ` +
        `FILE_TYPE_PIPE, but node's own C runtime answers ${nodeSees} for it. The descriptor ` +
        `tables are not shared, so no handle this process obtains through an FFI can be turned ` +
        `into an fd node will accept. The limit is the CRT, not the pipe.`,
    );
  }
  return new Socket({ fd, readable: true, writable: true });
}

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
 * @param {number} memoryLimit the job's ProcessMemoryLimit, when there is a job
 * @returns {Record<string, unknown>}
 */
function runCell(hostJs, scratchDir, reportPath, cell, contained, withJob, memoryLimit) {
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
    // The limit is the CELL's, not a constant read from here. Every cell but one
    // passes §9.17's derived cap; the memory differential needs a cell whose
    // limit is small enough to be provable on a runner. See SMALL_MEMORY_LIMIT.
    limitsSet = surface.applyLimits(job, memoryLimit);
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

    // FOUR PIPES, ONE NAME SCHEME, differing only in the creation route and the
    // DACL — so the name is not a second variable beside the thing under test.
    //
    //   pipe          Node's createServer. RE-MEASURED IN THIS RUN rather than
    //                 cited: "already known to be refused" is a historical
    //                 figure, and this repository has been wrong twice about
    //                 machine state it did not re-read.
    //   win32Granted  Win32, DACL naming Built-in Users AND the container SID.
    //                 The reachability claim: a Win32 descriptor can admit the
    //                 container at all.
    //   win32SidOnly  Win32, DACL naming the container SID and NOTHING ELSE.
    //                 THE SHIPPED SPELLING. ADR-0023 §4 requires the container
    //                 SID in the DACL and says nothing about what else may be
    //                 there, and `D:(A;;GA;;;BU)` grants GENERIC_ALL to Built-in
    //                 Users — so the granted pipe above, shipped, would let any
    //                 user process on the machine open the engine host's control
    //                 channel. Built-in Users is in the other two because a
    //                 SPIKE needs its uncontained controls to be able to
    //                 connect; the product does not.
    //   win32UserOnly Win32, DACL naming Built-in Users ONLY. The discriminator:
    //                 without it, a contained cell connecting to win32Granted
    //                 could be explained by "a Win32 pipe is reachable" rather
    //                 than by the container ACE. It separates my descriptor is
    //                 wrong from the container grant is what did it.
    //
    // The UNCONTAINED cells connecting to win32Granted is the positive control,
    // and it is the one that makes a refusal readable: a red without it says
    // "the DACL approach does not work" and "I built a malformed descriptor"
    // in the same breath, on a first attempt at code nobody here has written
    // before.
    const grantedName = `${pipeName}-w32grant`;
    const sidOnlyName = `${pipeName}-w32sid`;
    const userOnlyName = `${pipeName}-w32user`;
    const shipped = resolveShippedSids();
    const granted = createControlPipe(grantedName, `D:(A;;GA;;;BU)(A;;GA;;;${sid})`, PIPE_INSTANCES);
    // THE SHIPPED SPELLING: this user and the container, and no group.
    //
    // Three measurements narrowed it to this, and the third one closed a design
    // I had already written — see `createWin32Pipe` for the instance-count half
    // and `currentUserSid` for the conjunctive-check half:
    //
    //   D:(A;;GA;;;<container>)                    the CONTAINED cell is refused
    //   D:(A;;GA;;;OW)(A;;GA;;;<container>)        admits every process of the owner
    //   D:(A;;GA;;;<user>)(A;;GA;;;<container>)    admits the container. SHIPPED.
    //
    // A one-instance pipe carrying only the container's ACE was the tightest
    // thing this could be, and it does not work: an AppContainer's access check
    // needs the ordinary identity granted too, and any grant that admits this
    // user admits every process this user runs. **Same-user exclusion is not a
    // boundary a DACL can draw here**, and invariant 25 does not ask for one —
    // it contains the engine, it does not defend against the user's own
    // processes. What this spelling buys over `BU` is other USERS of the
    // machine, which cannot be measured on a single-account runner and is
    // stated rather than claimed as measured.
    //
    // BUILT BY THE SHIPPED FACTORY, not spelt here. `createHostPipe` assembles
    // this descriptor from the two branded SIDs and there is no route by which
    // a caller can hand it a string, so what the cells measure below IS what a
    // host will be handed rather than a copy that agrees today.
    const sidOnly = createShippedPipe(
      sidOnlyName,
      PIPE_INSTANCES,
      shipped.user,
      shipped.container,
    );
    const userOnly = createControlPipe(userOnlyName, 'D:(A;;GA;;;BU)', PIPE_INSTANCES);

    // THE ECHO PAIR. Two pipes nothing else touches, so a round trip cannot be
    // confused with a cell's reachability probe on the same instance.
    //
    // One instance each: exactly one client, which is this process. The question
    // is whether libuv can drive the SERVER side of a handle Win32 created, and
    // a second client would only add a way for the answer to be about something
    // else. The Win32 one carries the shipped descriptor because that is the
    // pipe the surface will build; the Node one is the control.
    const echoWin32Name = `${pipeName}-w32echo`;
    const echoNodeName = `${pipeName}-nodeecho`;
    const echoWin32 = createShippedPipe(echoWin32Name, 1, shipped.user, shipped.container);
    const echoNode = createServer((socket) => {
      socket.on('data', (chunk) => socket.write(chunk));
    });

    const shut = () => {
      tcp.close();
      pipe.close();
      echoNode.close();
      for (const handle of [
        ...granted.handles,
        ...sidOnly.handles,
        ...userOnly.handles,
        ...echoWin32.handles,
      ]) {
        CloseHandle(handle);
      }
    };

    tcp.on('error', reject);
    pipe.on('error', reject);
    echoNode.on('error', reject);

    tcp.listen(0, '127.0.0.1', () => {
      echoNode.listen(echoNodeName, () => {
      pipe.listen(pipeName, () => {
        void (async () => {
        try {
          const address = tcp.address();
          const port = typeof address === 'object' && address !== null ? address.port : 0;
          writeFileSync(
            join(scratchDir, 'handed.json'),
            JSON.stringify({
              port,
              pipe: pipeName,
              win32Granted: grantedName,
              win32SidOnly: sidOnlyName,
              win32UserOnly: userOnlyName,
            }),
            'utf8',
          );

          // THE CELLS. Two axes, containment and the job, each switchable on its
          // own, so every property has a pair that flips exactly one thing.
          // There is no cell off this route: what used to sit here was a forked
          // baseline, and ADR-0022 retired the route it referenced.
          const cells = [
            { cell: 'lowbox', contained: true, job: true, limit: PROCESS_MEMORY_LIMIT },
            { cell: 'route', contained: false, job: true, limit: PROCESS_MEMORY_LIMIT },
            { cell: 'route-no-job', contained: false, job: false, limit: PROCESS_MEMORY_LIMIT },
            { cell: 'lowbox-no-job', contained: true, job: false, limit: PROCESS_MEMORY_LIMIT },
            // THE MEMORY CELL. Uncontained, so the container is not a variable
            // in its pair, and identical to `route` in every respect except the
            // job's ProcessMemoryLimit — which is the one thing under test.
            { cell: 'route-small-limit', contained: false, job: true, limit: SMALL_MEMORY_LIMIT },
          ];

          /** @type {Array<{ cell: string, spawn: Record<string, unknown>, report: { probes?: Record<string, { outcome: string, detail: string }> } | null }>} */
          const collected = [];

          // THE PARENT IS A CELL, so the readings it produces are read by the
          // same classifier as every other and no second mechanism appears
          // beside the table. It creates no process; `spawn` says so rather
          // than carrying a shape that would read as one.
          //
          // The control runs FIRST. If Node's own pipe cannot echo, nothing
          // below it means anything, and finding that out after the interesting
          // reading is how a broken harness gets written up as a finding.
          collected.push({
            cell: 'parent',
            spawn: { note: 'this process — no cell was created for these readings' },
            report: {
              probes: {
                echoNode: await echoOnce(echoNodeName, () => undefined),
                echoWin32: await echoOnce(echoWin32Name, () => {
                  const server = adoptPipeHandle(echoWin32.handles[0]);
                  server.on('data', (chunk) => server.write(chunk));
                }),
              },
            },
          });

          for (const spec of cells) {
            const reportPath = join(scratchDir, `report-${spec.cell}.json`);
            const spawn = runCell(
              hostJs,
              scratchDir,
              reportPath,
              spec.cell,
              spec.contained,
              spec.job,
              spec.limit,
            );
            collected.push({ cell: spec.cell, spawn, report: readReport(reportPath) });
          }
          shut();
          resolve(collected);
        } catch (error) {
          shut();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
        })();
      });
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
const roster = createRoster(caseFailures, { cases: 23 });

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
      // EMITTED, not passed on argv, because `argv.slice(-2)` is fixed at two
      // and widening it would make the host's argument handling depend on how
      // many probes exist. The target is one number for every cell — what
      // varies is the LIMIT each cell's job carries, which is the variable
      // under test.
      `const COMMIT_TARGET = ${String(COMMIT_TARGET_BYTES)};\n` +
      `const COMMIT_CHUNK = ${String(COMMIT_CHUNK_BYTES)};\n` +
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
 * What a row requires of EACH of its two cells, by name.
 *
 * Not a verdict about whether they agreed: agreement is what absence produces,
 * so a row expecting it was satisfiable by a probe that failed on both sides.
 * See {@link summarise}'s `judgeRow` for the whole of that reasoning.
 *
 * `either` is the single row whose contained outcome genuinely varies by runner
 * image. It carries a pin rather than an outcome, and keeps its own shape.
 *
 * @typedef {{ readonly withMechanism: 'allowed' | 'refused', readonly without: 'allowed' | 'refused' } | 'either'} Expectation
 */

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

  /**
   * Whether one row holds, and which half of it did not.
   *
   * A named function rather than an expression in the loop, because the control
   * below has to be able to ask it about pairs no run produced.
   *
   * ## The expectation is the PAIR, and `verdict` no longer decides
   *
   * A row used to expect `DIFFERS` or `same`, which are statements about whether
   * the two cells agreed. Agreement is also what ABSENCE produces — refused
   * beside refused is `same` — so `same` was satisfiable by a probe that failed
   * on both sides, and that is how the row certifying ADR-0023 §4's transport
   * passed for a pipe neither cell could open (AAAA-40).
   *
   * The first repair required the uncontained cell to be allowed on every row.
   * Correct for all thirteen rows that existed and wrong as a rule: it forbids
   * the first row whose POINT is that the uncontained cell is excluded — a pipe
   * whose DACL names the container SID and nothing else, which is the spelling
   * the product ships. An expectation that cannot say *contained allowed,
   * uncontained refused* would have made that row an exception, and item 6's
   * retrofit arrives as exactly one reasonable-looking exception.
   *
   * So each row now declares the expected outcome of EACH CELL by name. A token
   * naming one side would leave the reader inferring what it required of the
   * other, and an expectation that did not say what it required of both sides is
   * the defect being fixed. `verdict` is unchanged and still prints DIFFERS/same
   * for a reader; it decides nothing.
   *
   * `unreadable` and `error` cannot equal an expected outcome, so a broken
   * reading fails its row rather than being compared — the classifier's third
   * state arriving where it is load-bearing rather than beside it.
   *
   * ## `either` keeps its pin, and is not folded into the pair vocabulary
   *
   * It exists because a fact genuinely varies by runner image, and the pin is
   * its recorder: without it the container's answer changing is unobservable,
   * which is a claim with no expiry inside the one row that exists because the
   * fact varies. Expressing it as a pair would delete the recorder to gain
   * uniformity. It is absent only where `--require-containment` is, which is a
   * developer machine, where there is a reader.
   *
   * @param {{ outcome: string, detail: string }} contained The cell WITH the mechanism.
   * @param {{ outcome: string, detail: string }} uncontained The cell without it.
   * @param {Expectation} expected
   * @returns {{ held: boolean, containedHeld: boolean, uncontainedHeld: boolean, pinHeld: boolean }}
   */
  const judgeRow = (contained, uncontained, expected) => {
    const pinHeld = LOWBOX_SPAWN_PIN === null || contained.outcome === LOWBOX_SPAWN_PIN;
    const containedHeld =
      expected === 'either' ? pinHeld : contained.outcome === expected.withMechanism;
    const uncontainedHeld =
      expected === 'either'
        ? uncontained.outcome === 'allowed'
        : uncontained.outcome === expected.without;
    return { held: containedHeld && uncontainedHeld, containedHeld, uncontainedHeld, pinHeld };
  };

  /**
   * One row's expectation, rendered so the line names both cells.
   *
   * @param {Expectation} expected @param {string} withMech @param {string} without
   * @returns {string}
   */
  const describeExpectation = (expected, withMech, without) =>
    expected === 'either'
      ? `${withMech} either (pinned ${LOWBOX_SPAWN_PIN ?? 'nothing — no --require-containment'}), ` +
        `${without} allowed`
      : `${withMech} ${expected.withMechanism}, ${without} ${expected.without}`;

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
  // EVERY ROW CARRIES THE OUTCOME EACH OF ITS CELLS MUST REPORT (finding RR-3,
  // the proof half; AAAA-40 for the shape).
  //
  // Printing a measured result and printing an ASSERTED one are different
  // things, and this file did the first for as long as it was research. A row
  // that silently flipped — containment stopping working — printed its new
  // reading and exited 0, because nothing said which answer the invariant
  // requires.
  //
  // What a row asserts is a PAIR OF OUTCOMES, not a verdict about whether the
  // two cells agreed. A verdict cannot distinguish *both cells did the thing*
  // from *neither cell could*, and this table certified ADR-0023 §4's transport
  // for a range on exactly that ambiguity. `verdict` still prints DIFFERS/same
  // beside each row for a reader; it decides nothing. See {@link judgeRow}.
  //
  // The expected value is part of the row rather than a list beside it, for the
  // reason the registries exist: a table where the claim and its evidence sit
  // apart is a table someone updates half of.
  //
  // ALLOWED ON BOTH SIDES IS THE CORRECT EXPECTATION for five of these, and
  // saying so is load bearing: the engine, the document, the handed file and the
  // §4 transport must all work INSIDE the container, so a refusal there means
  // the host cannot do its job.
  //
  // ONE ROW EXPECTS `either`, AND THAT IS A COVERAGE REDUCTION WITH A
  // MEASUREMENT BEHIND IT (audit item 2a, weakening direction).
  //
  // `(b) process creation — LowBox alone` expected a refusal from the contained
  // cell, on WW-1's finding that the container does not deliver process
  // creation and the job does. That
  // was measured here and it is not universal. On `windows-latest`, 2026-08-23,
  // the contained cell with no job of ours was **refused EPERM** where this
  // machine allows it — so the AppContainer denies process creation on that
  // build and not on Windows 11.
  //
  // Neither answer can be asserted, and the design conclusion survives both,
  // which is why this is a reduction rather than a problem: ADR-0023 Decision 8
  // rests on *you cannot rely on the container for (b)*, and a mechanism that
  // is present on some builds and absent on others is exactly something you
  // cannot rely on. The row is stronger evidence for that than a uniform
  // refusal would have been.
  //
  // It does not become unasserted, and it KEEPS ITS OWN SHAPE rather than being
  // folded into the pair vocabulary. `either` pins the contained outcome to what
  // this runner image was measured at, so a change in the container's behaviour
  // has a recorder; expressing it as a pair would delete that recorder to gain
  // uniformity across a table of thirteen.
  // EACH EXPECTATION BELOW WAS DERIVED FROM THE ROW'S `why` — its stated intent
  // — AND NEVER FROM WHAT THE ROW CURRENTLY PRINTS.
  //
  // That is the whole risk of this remap and it is invisible afterwards: reading
  // the expectation off the current output canonises any row that has silently
  // been wrong, and one of them just was. `IPC — Win32 pipe` printed `same` for
  // a transport nothing could open; its `why` says the contained host must be
  // able to talk, so its pair is allowed/allowed and the wrong reading has no
  // route into the new table.
  //
  // DENIED is written as `refused` and ALLOWED as `allowed` — the probe's own
  // vocabulary, so no third spelling of an outcome enters here (B3a).
  /** @type {ReadonlyArray<readonly [string, string, string, string, Expectation, string]>} */
  const PROPERTIES = [
    ['(b) process creation — job alone', 'spawnAtStartup', 'route', 'route-no-job',
      { withMechanism: 'refused', without: 'allowed' },
      'the job, at Medium integrity on both sides so the container cannot be the cause'],
    ['(b) process creation — LowBox alone', 'spawnAtStartup', 'lowbox-no-job', 'route-no-job', 'either',
      'the container, with no job of ours on either side — MEASURED, NOT ASSERTED, see below'],
    ['(d) filesystem, JS', 'jsReadUnhanded', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'a file the host was not handed, read through Node'],
    ['(d) filesystem, native', 'nativeReadUnhanded', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'the same file through CreateFileW — the path the adversary has'],
    ['(c) network', 'loopback', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'a loopback connection, so a refusal cannot be a runner with no network'],
    ['engine', 'loadShim', 'lowbox', 'route',
      { withMechanism: 'allowed', without: 'allowed' },
      'the MuPDF shim, loaded through koffi — it must load INSIDE the container'],
    ['document', 'openDocument', 'lowbox', 'route',
      { withMechanism: 'allowed', without: 'allowed' },
      'a document it WAS handed, which the contained host must be able to open'],
    ['IPC — Node createServer', 'namedPipe', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'a pipe Node created, which sets no DACL — the MessagePort is unreachable off this route'],
    ['IPC — Win32 pipe, container in its DACL', 'namedPipeWin32Granted', 'lowbox', 'route',
      { withMechanism: 'allowed', without: 'allowed' },
      'ADR-0023 §4’s transport. The contained host MUST be able to talk, so allowed is the ' +
        'reading on both sides — and stating the contained side is what the old `same` did ' +
        'not do, which is how two refusals satisfied this row. A red here on another Windows ' +
        'image is a finding, not a flake: unlike the LowBox spawn row, an ACE naming a SID is ' +
        'not a policy that varies by build'],
    ['IPC — Win32 pipe, the SHIPPED DACL', 'namedPipeWin32SidOnly', 'lowbox', 'route',
      { withMechanism: 'allowed', without: 'allowed' },
      'this user and the container, with no group — the exact descriptor the surface will build. ' +
        '`route` is allowed and MUST be: an AppContainer’s check is conjunctive, so the ' +
        'container’s ordinary identity has to be granted too, and any grant admitting this user ' +
        'admits every process this user runs. What it buys over `D:(A;;GA;;;BU)` is other USERS ' +
        'of the machine, which a single-account runner cannot measure'],
    ['CONTROL: the container ACE is what admits it', 'namedPipeWin32UserOnly', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'the same Win32 route with Built-in Users only — separates the ACE from the route'],
    ['the host cannot rewrite the transport’s DACL', 'dacWriteShipped', 'lowbox', 'route',
      { withMechanism: 'refused', without: 'allowed' },
      'CreateFileW for WRITE_DAC on the shipped pipe (finding BBBB-4). The contained host is ' +
        'REFUSED, which is the property. `route` is allowed and cannot be otherwise: it runs as ' +
        'the object’s OWNER, and an owner holds READ_CONTROL and WRITE_DAC implicitly whatever ' +
        'the DACL says — measured here, not assumed, because the user’s mask 0x0012019F does ' +
        'not contain WRITE_DAC and it was allowed anyway'],
    ['CONTROL: BBBB-4 demonstrated, and the probe can open something', 'dacWriteGranted',
      'lowbox', 'route', { withMechanism: 'allowed', without: 'allowed' },
      'the SAME call by the SAME cell against the BU+container pipe, which still carries GA. ' +
        'The contained host opens it for WRITE_DAC — so the old descriptor let the principal ' +
        'invariant 25 declares hostile rewrite its own trust boundary, demonstrated rather than ' +
        'argued. It is also this pair’s positive control: one cell, one access mask, two ' +
        'descriptors, and only the mask differs, so the refusal above cannot be a probe that ' +
        'opens nothing'],
    ['(b) memory — job alone', 'commitPastLimit', 'route-small-limit', 'route-no-job',
      { withMechanism: 'refused', without: 'allowed' },
      'a commit past the job’s ProcessMemoryLimit, uncontained on both sides'],
    ['CONTROL: memory is the LIMIT, not the job', 'commitPastLimit', 'route', 'route-no-job',
      { withMechanism: 'allowed', without: 'allowed' },
      'the same commit under a job carrying §9.17’s 3 GB cap — allowed on both'],
    ['CONTROL: handed', 'readHanded', 'lowbox', 'route',
      { withMechanism: 'allowed', without: 'allowed' },
      'allowed on BOTH sides, or the container was handed nothing'],
  ];

  process.stdout.write('PROPERTIES — each row against the cell that removes ONLY its own mechanism:\n\n');

  let unreadable = 0;
  for (const [label, key, withMech, without, expected, why] of PROPERTIES) {
    const contained = probe(withMech, key);
    const uncontained = probe(without, key);
    const decided = verdict(contained, uncontained);
    if (decided === 'UNREADABLE') unreadable += 1;
    // MEASURED, on this machine, 2026-08-24, by pointing `win32Granted` at a
    // name nothing created so both cells are refused it — against the version of
    // this loop that expected a VERDICT rather than a pair:
    //
    //   before  ok   same  IPC — Win32 pipe, container in its DACL   17 passed, exit 0
    //   after   FAIL same  IPC — Win32 pipe, container in its DACL   1 FAILED, exit 1
    //
    // The verdict column reads `same` in both, which is the whole defect in one
    // line: the row certifying ADR-0023 §4 across three Windows builds reported
    // the same word for a working transport and for no transport at all. The
    // control below poses that shape on every run rather than leaving it to a
    // mutation somebody remembers to make.
    const { held, containedHeld, uncontainedHeld, pinHeld } = judgeRow(
      contained,
      uncontained,
      expected,
    );
    const mark = held ? 'ok' : 'FAIL';
    process.stdout.write(
      `  ${mark.padEnd(5)}${decided.padEnd(11)} ${label}\n` +
        `              expected ${describeExpectation(expected, withMech, without)}\n` +
        `              ${why}\n` +
        `              ${withMech.padEnd(13)} ${contained.outcome.padEnd(11)} ${contained.detail}\n` +
        `              ${without.padEnd(13)} ${uncontained.outcome.padEnd(11)} ${uncontained.detail}\n\n`,
    );
    assert(
      `${label}: ${describeExpectation(expected, withMech, without)}`,
      held,
      `measured ${decided}. ${withMech} said ${contained.outcome} (${contained.detail}); ` +
        `${without} said ${uncontained.outcome} (${uncontained.detail}). ` +
        (uncontainedHeld
          ? ''
          : `\n\n      THE ${without.toUpperCase()} CELL IS NOT WHAT THIS ROW REQUIRES OF IT. ` +
            `That cell exists to remove ONE mechanism, so its outcome is half the measurement ` +
            `and not a backdrop: with it wrong, "${decided}" describes the probe rather than ` +
            `the mechanism. Repair that cell before reading anything into this row.\n\n      `) +
        (expected !== 'either' && !containedHeld
          ? `\n\n      THE ${withMech.toUpperCase()} CELL IS NOT WHAT THIS ROW REQUIRES OF IT ` +
            `— the mechanism's own side. This is the half a verdict could not state, and the ` +
            `half two dead cells used to satisfy.\n\n      `
          : '') +
        (expected === 'either'
          ? 'This row does not assert a DIRECTION — the container denies process creation on ' +
            'some Windows builds and not others — but the uncontained cell must still be able ' +
            'to spawn, or two dead cells would satisfy it, and the contained cell must match ' +
            `the pin this job passed (${LOWBOX_SPAWN_PIN ?? 'none — no --require-containment'}). ` +
            (pinHeld
              ? ''
              : `\n\n      THE PIN IS THE FINDING, NOT A BUG HERE. The AppContainer on this ` +
                `runner image now says '${contained.outcome}' where the job pinned ` +
                `'${LOWBOX_SPAWN_PIN ?? ''}'. Runner image: ImageOS=` +
                `${process.env['ImageOS'] ?? 'unknown'} ImageVersion=` +
                `${process.env['ImageVersion'] ?? 'unknown'}.\n\n      That is almost certainly a ` +
                `Microsoft image change and not a defect in this repository. ADR-0023 Decision ` +
                `8 does not depend on this row — the JOB delivers invariant 25(b) and the ` +
                `container is explicitly not relied on for it — so nothing here is broken. THE ` +
                `RECORD of the container's behaviour is what moved. Repair the pin beside this ` +
                `job's runs-on: and record the new reading; do not hunt for a bug.`)
          : decided === 'UNREADABLE'
            ? 'UNREADABLE is not a verdict — could-not-look and looked-and-found-containment do ' +
              'not share an output, so this is a broken run rather than a lost property. An ' +
              'unreadable outcome matches no expected outcome, which is why it fails here ' +
              'rather than being compared.'
            : 'This row measures ONE mechanism, and it asserts what EACH cell must report ' +
              'rather than whether they agreed. An outcome that moved is the property itself ' +
              'changing.'),
    );
  }

  // ---------------------------------------------------------------------------
  // THE PREDICATE'S CONTROL — EXHAUSTIVE OVER THE VOCABULARY, posed on every run
  // rather than by a mutation somebody remembers to make.
  //
  // WHAT IT ASSERTS IS NOT THE IMPLEMENTATION RESTATED. Re-deriving `contained
  // matches AND uncontained matches` here would be a second opinion about a rule
  // one function already owns (B3a), and it would agree with a broken `judgeRow`
  // written the same broken way. The property posed instead is DISCRIMINATION:
  //
  //   for each expectation, exactly ONE of the sixteen actual pairs holds,
  //   and it is that expectation's own pair.
  //
  // That is a statement about the vocabulary rather than about the code, and it
  // fails for every way this predicate can plausibly break: ignoring a side
  // (four pairs would hold), comparing the wrong side (one pair holds, the wrong
  // one), holding always (sixteen), holding never (zero). The last of those is
  // the vacuity guard, and it is not decoration — a predicate that refused
  // everything would satisfy a control that only asked what must NOT hold, while
  // failing every real row.
  //
  // THE ACTUAL PAIRS INCLUDE `unreadable` AND `error`, because the classifier
  // produces them and a row must fail rather than compare them. Sixteen pairs is
  // four outcomes squared; the four expectations are the three the table uses
  // plus `allowed/refused`, which nothing uses YET — it is the shape a pipe whose
  // DACL names the container SID and nothing else will need, and the reason this
  // table stopped expecting verdicts.
  //
  // `either` is posed separately below: it pins one side and requires `allowed`
  // on the other, so "exactly one pair" is the wrong question to ask of it.
  //
  // MUTATED, on this machine, 2026-08-24, and the first result is why this
  // control exists rather than being trusted to the rows:
  //
  //   containedHeld := true          this control FAILED — and all 13 rows PASSED
  //   containedHeld reads `without`  this control FAILED, 8 cases red
  //   held := false                  this control FAILED, every row red
  //
  // A predicate that ignores the mechanism's own side is invisible to every row
  // in the table, on a green run, on real readings. Nothing else here can see
  // it, because each row supplies only one actual pair and it is the matching
  // one.
  //
  // WHAT NO CONTROL HERE CAN SEE is a row whose expectation was translated
  // WRONGLY — a mistranslation is a correct predicate given a wrong claim, and
  // it passes exhaustively. That is why the expectations above were derived from
  // each row's `why` rather than from what it printed, and why a green run after
  // this remap is necessary and not sufficient.
  // ---------------------------------------------------------------------------
  {
    /** @type {ReadonlyArray<'allowed' | 'refused' | 'unreadable' | 'error'>} */
    const OUTCOMES = ['allowed', 'refused', 'unreadable', 'error'];
    /** @type {ReadonlyArray<{ withMechanism: 'allowed' | 'refused', without: 'allowed' | 'refused' }>} */
    const EXPECTATIONS = [
      { withMechanism: 'refused', without: 'allowed' },
      { withMechanism: 'allowed', without: 'allowed' },
      { withMechanism: 'allowed', without: 'refused' },
      { withMechanism: 'refused', without: 'refused' },
    ];

    /** @type {string[]} */
    const wrong = [];
    for (const expectation of EXPECTATIONS) {
      /** @type {string[]} */
      const holding = [];
      for (const containedOutcome of OUTCOMES) {
        for (const withoutOutcome of OUTCOMES) {
          const { held: doesHold } = judgeRow(
            { outcome: containedOutcome, detail: 'synthesised' },
            { outcome: withoutOutcome, detail: 'synthesised' },
            expectation,
          );
          if (doesHold) holding.push(`${containedOutcome}/${withoutOutcome}`);
        }
      }
      const itsOwn = `${expectation.withMechanism}/${expectation.without}`;
      if (holding.length !== 1 || holding[0] !== itsOwn) {
        wrong.push(
          `expecting ${itsOwn} was satisfied by [${holding.join(', ') || 'nothing'}]`,
        );
      }
    }

    // `either`, posed on its own terms: it must never hold with the uncontained
    // side anything but allowed — which is the two-dead-cells case for the one
    // row that cannot state its own contained outcome — and it must hold when
    // the uncontained side is allowed and the contained side matches the pin.
    // With no pin (a developer machine) every contained outcome matches, which
    // is what `--require-containment` exists to remove.
    /** @type {string[]} */
    const eitherWrong = [];
    for (const containedOutcome of OUTCOMES) {
      for (const withoutOutcome of OUTCOMES) {
        const { held: doesHold } = judgeRow(
          { outcome: containedOutcome, detail: 'synthesised' },
          { outcome: withoutOutcome, detail: 'synthesised' },
          'either',
        );
        const shouldHold =
          withoutOutcome === 'allowed' &&
          (LOWBOX_SPAWN_PIN === null || containedOutcome === LOWBOX_SPAWN_PIN);
        if (doesHold !== shouldHold) {
          eitherWrong.push(
            `either with ${containedOutcome}/${withoutOutcome} held ${String(doesHold)}`,
          );
        }
      }
    }

    const discriminates = wrong.length === 0 && eitherWrong.length === 0;
    process.stdout.write(
      `  ${(discriminates ? 'ok' : 'FAIL').padEnd(5)}` +
        `CONTROL: every expectation is satisfied by exactly its own pair\n` +
        `              ${String(EXPECTATIONS.length)} expectation(s) against ` +
        `${String(OUTCOMES.length * OUTCOMES.length)} actual pair(s) each, plus 'either' ` +
        `against all ${String(OUTCOMES.length * OUTCOMES.length)}\n` +
        `              exactly one must hold and it must be the expectation itself — so a ` +
        `predicate that ignores a side,\n` +
        `              reads the wrong side, holds always or holds never is red here rather ` +
        `than in a row.\n\n`,
    );
    assert(
      'CONTROL: every expectation is satisfied by exactly its own pair, and by nothing else',
      discriminates,
      `${[...wrong, ...eitherWrong].join('; ')}. Every row above is believed on the strength ` +
        `of this. Measured on this machine 2026-08-24: before the expectation was a pair, ` +
        `pointing win32Granted at a name nothing created printed 'ok same' and exited 0.`,
    );
    // No `unreadable` increment here, unlike its sibling below: a failed
    // predicate is not an unread row, and counting it as one would print
    // "N row(s) could not be read" about rows that were read fine. A failed
    // assert already exits non-zero on its own.
  }

  // ---------------------------------------------------------------------------
  // CAN NODE DRIVE THE SERVER SIDE OF A PIPE WIN32 CREATED?
  //
  // Not a row: both readings come from the same cell, because the property is
  // about this process's own stream machinery and no containment boundary is
  // crossed. Reported here rather than in the table so nothing pretends a
  // differential exists where there is none.
  //
  // The CONTROL is first and it is not decoration. A silent Win32 echo says
  // *libuv cannot adopt this handle* and *the harness is broken* in one breath,
  // and a Node pipe echoing under the identical client code separates them.
  // ---------------------------------------------------------------------------
  process.stdout.write('THE TRANSPORT’S SERVER HALF:\n\n');
  const echoNodeRead = probe('parent', 'echoNode');
  const echoWin32Read = probe('parent', 'echoWin32');
  process.stdout.write(
    `  echoNode   parent   ${echoNodeRead.outcome.padEnd(11)} ${echoNodeRead.detail}\n` +
      `  echoWin32  parent   ${echoWin32Read.outcome.padEnd(11)} ${echoWin32Read.detail}\n\n`,
  );

  assert(
    'CONTROL: a pipe Node created round-trips under this client code',
    echoNodeRead.outcome === 'allowed',
    `${echoNodeRead.outcome}: ${echoNodeRead.detail}. The reading below is a NEGATIVE result, and ` +
      `a negative result whose harness is broken is worth nothing. This is what separates "libuv ` +
      `will not adopt that handle" from "my echo does not work".`,
  );

  // THE RECORDER FOR A MEASURED LIMIT, in the shape the `either` row uses: the
  // reading is pinned, so the day it changes this goes red and somebody re-reads
  // the design rather than discovering it during integration.
  //
  // EBADF is part of the pin because it is the MECHANISM. `net.Socket({ fd })`
  // answers `Unsupported fd type: UNKNOWN` for a handle it cannot drive and for
  // a descriptor that resolves to nothing, and only the second is what happens
  // here — ucrtbase's `_get_osfhandle` gives back a handle whose `GetFileType`
  // is FILE_TYPE_PIPE, while node's own runtime answers EBADF for the same
  // number. A pin on the message alone would survive the mechanism changing.
  assert(
    'a Win32 pipe handle cannot be adopted into node, and the limit is the CRT',
    echoWin32Read.outcome === 'error' && echoWin32Read.detail.includes('EBADF'),
    `${echoWin32Read.outcome}: ${echoWin32Read.detail}. This assertion is a RECORDER, not a ` +
      `requirement: it pins a measured negative so a change becomes visible. Two ways to reach ` +
      `it. If the outcome is now 'allowed', node has gained a route this design was told it did ` +
      `not have — ADR-0023 §4's second 2026-08-24 correction rests on this, and handing a stream ` +
      `to the runtime loop is back on the table. If it is still an error but no longer EBADF, ` +
      `the failure has moved and the correction's stated mechanism is no longer what is ` +
      `happening; read the detail before believing either.`,
  );

  // ---------------------------------------------------------------------------
  // (b) MEMORY: MEASURED, AND WHAT THE MEASUREMENT IS ABOUT.
  //
  // This block went through three states and printed each of them, which is the
  // point of it existing at all:
  //
  //   was: no mechanism    — nothing set a limit, so nothing could be measured
  //   then: no probe       — the limit was in force and nothing allocated past it
  //   now: measured        — two rows above, on running processes
  //
  // The middle state arrived as a side effect of moving onto the shipped
  // surface: `applyLimits` has no undefaulted form, so using the shipped job
  // brought §9.17's cap with it. That is a coverage GAIN, and gains go
  // unrecorded because nothing goes red when they happen (audit item 2a).
  //
  // What is printed below is the SCOPE of the reading, because the two rows
  // above prove enforcement and say nothing about the number. The line
  // separating those is the whole of what was owed, and it is worth more than
  // the rows: a behavioural probe cannot check a derivation, and a derivation
  // cannot check enforcement.
  // ---------------------------------------------------------------------------
  process.stdout.write(
    '  MEASURED, WITH A STATED SCOPE  (b) memory\n' +
      '              The job’s ProcessMemoryLimit is IN FORCE on a running process: the two\n' +
      '              rows above are a refusal under a small cap beside the same commit\n' +
      '              succeeding with no job of ours, and succeeding again under a job carrying\n' +
      `              §9.17's real ${String(PROCESS_MEMORY_LIMIT)}-byte mupdf-host cap — so the\n` +
      '              refusal is the limit’s VALUE and not the mere presence of a job.\n\n' +
      '              NOT evidence about the 3 GB figure. A differential needs the uncontained\n' +
      '              side to succeed, and committing past 3 GB on a runner fails for memory\n' +
      '              pressure as readily as for the job — which would report the runner’s RAM\n' +
      '              as this project’s defect. The figure is a DERIVATION and\n' +
      '              proof:composition already requires the surface to carry §9.17’s line.\n\n',
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
