// @ts-check
/**
 * Proves ADR-0027's provisioning grant derives, reads back, and reverses.
 *
 * ## What is proven everywhere, and what needs Windows
 *
 * The **derivation** is pure and is checked on every platform: the path set must
 * come from the resolvers that own those artefacts, and must not include the
 * per-session pair. The **round trip** needs `icacls` and an NTFS DACL, so it
 * runs on Windows and is reported as not-applicable elsewhere — said out loud,
 * because a case that silently vanishes on a platform is one nobody knows they
 * are not running.
 *
 * ## The round trip is done on a THROWAWAY file
 *
 * Never on the real paths. A proof that granted the runtime would leave the
 * machine in a state its own success depended on, and a later run could not tell
 * "the grant works" from "a previous run left it granted" — the stale-answer
 * shape, where a positive control passes on a cached result.
 *
 * Usage: node scripts/proofs/containerGrants.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { electronRoot } from '../provision/electron.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { tessdataDirectory } from '../provision/tessdata.mjs';
import {
  ALL_APPLICATION_PACKAGES,
  apply,
  grantSet,
  lostGrants,
  namesApplicationPackages,
  readAcl,
} from '../provision/containerGrants.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 17 });

/** The program a contained host runs, which the grant set must cover. */
const HOST_ENTRY = join(repoRoot(), 'packages', 'kernel', 'dist', 'host', 'hostEntry.js');

/** The two workspace groups `package.json` declares, each of which must appear. */
const workspaceGroups = [join(repoRoot(), 'packages'), join(repoRoot(), 'apps')];

/** @param {string} label @param {boolean} condition @param {string} detail @param {boolean} [ran] */
function check(label, condition, detail, ran = true) {
  const mark = roster.mark();
  if (ran && !condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label, ran);
}

try {
  const root = repoRoot();
  const set = grantSet(root);
  const paths = set.map((entry) => entry.path);

  check(
    'every entry carries a stated reason, and the set is not empty',
    set.length > 0 && set.every((entry) => entry.why.length > 0),
    `got ${set.length}: ${JSON.stringify(set.map((entry) => entry.why))}`,
  );

  // NOT A COUNT ANY MORE, and the reason is 4c's direction test rather than
  // convenience. This asserted `set.length === 4` while the set was a hand-kept
  // list of four artefacts, where a literal count is the anchor against
  // shrinkage. The set is now partly DERIVED — one entry per workspace package —
  // so a count would have to change with every package added, which makes it a
  // number people update to make a red thing green rather than a claim.
  //
  // What replaces it is the property that actually matters and that the
  // four-path set FAILED: the host's own program must be inside the set.
  // SSSS-1 measured a contained host dying at `Cannot find module
  // …dist/host/hostEntry.js` for exactly this omission.
  check(
    'the set covers the package the host ENTRY lives in',
    paths.some((path) => join(path, 'dist', 'host', 'hostEntry.js') === HOST_ENTRY),
    `paths: ${JSON.stringify(paths)}. The four-path set granted the runtime, the FFI and the ` +
      `shim, and not the application's own code — so a contained host started and could not ` +
      `read its own entry. A set that omits it again passes every other case here.`,
  );

  check(
    'and every workspace package, since the entry imports across them',
    workspaceGroups.every((group) => paths.some((path) => path.startsWith(group))),
    `paths: ${JSON.stringify(paths)}. \`hostEntry.js\` resolves @monstera/contract and ` +
      `@monstera/shared by bare specifier, which reads each package's own package.json for its ` +
      `exports map — measured: granting the dist directories instead leaves the contained cell ` +
      `dying at module-resolution.`,
  );

  check(
    'it is DERIVED — the runtime path carries the pinned version from its own resolver',
    paths.some((path) => /[\\/]\.tools[\\/]electron[\\/]\d+\.\d+\.\d+$/u.test(path)),
    `paths: ${JSON.stringify(paths)}. A literal version here would be a second opinion about ` +
      `what \`electronRoot\` already answers, and the two would drift on the next bump.`,
  );

  check(
    'the SECOND engine’s library is in the set, and derived from its own resolver',
    paths.some((path) => /[\\/]\.tools[\\/]pdfium[\\/][\d.]+[\\/]bin$/u.test(path)),
    `paths: ${JSON.stringify(paths)}. The PDFium host binds pdfium.dll at startup, before its ` +
      `first handler runs, so a token that cannot read it dies with no pipe to report on — ` +
      `SSSS-1's failure on the second engine. The version segment is what says the path came ` +
      `from \`pdfiumLibrary\` rather than being spelled here.`,
  );

  // THE FFI SIBLING NO LONGER HAS ITS OWN ENTRY, and its case is replaced
  // rather than deleted. `node_modules` is granted whole with inheritance, which
  // subsumes both koffi entries — so the platform-keyed path this used to assert
  // is now covered by containment rather than by naming, and asserting the old
  // shape would require re-adding a redundant grant to keep a case green.
  check(
    'the FFI is still reachable — node_modules is granted whole, with inheritance',
    paths.some((path) => path === join(root, 'node_modules')),
    `paths: ${JSON.stringify(paths)}. koffi and its platform sibling live under node_modules, ` +
      `and naming only the packages known today is a set that goes stale the next time a ` +
      `dependency is added.`,
  );

  check(
    'the per-session pair is NOT in it',
    !paths.some((path) => /scratch|snapshot/iu.test(path)),
    `paths: ${JSON.stringify(paths)}. \`createSessionDirectories\` passes a security descriptor ` +
      `to CreateDirectoryW, so there is no window in which those exist ungranted and no grant ` +
      `step to take. Provisioning owns durable artefacts; a session owns its own.`,
  );

  // THE CLAIM IS *NOTHING IS GRANTED WRITE*, and it read *every right is RX*
  // until 2026-09-11 — the same sentence while every entry happened to be a
  // program. The OCR models are the first entry that is **data**: a WASM engine
  // parses them and nothing executes them, so they are granted `R`, and a case
  // keyed on the string `'RX'` would have made the narrower grant the failure.
  //
  // Split into the property and its shape, because only the first is the
  // invariant: write is refused everywhere, and execute is granted only where
  // something is executed.
  check(
    'nothing durable is granted write',
    set.every((entry) => !/W/u.test(entry.rights)),
    `rights: ${JSON.stringify(set.map((entry) => entry.rights))}. A contained host that could ` +
      `write the runtime or the shim could rewrite what it next executes.`,
  );

  check(
    'execute is granted only to what the host EXECUTES, and the models are data',
    set.every((entry) => entry.rights === (entry.path === tessdataDirectory(root) ? 'R' : 'RX')),
    `rights: ${JSON.stringify(set.map((entry) => `${entry.rights} ${entry.path}`))}. Every other ` +
      `entry is a program the host runs or a library it binds; a model is bytes Tesseract reads.`,
  );

  // -------------------------------------------------------------------------
  // WHOSE ABSENCE IS A FAILURE — the distinction that reddened `main`.
  //
  // Every entry was required until 2026-09-09, and adding PDFium's library made
  // `containedStart.mjs` fail on a CI job that provisions no PDFium: an
  // acceptance test about whether **a** contained host starts was answering
  // about a different engine's availability. The MuPDF host never loads that
  // library, so its absence is a decided state the application already
  // expresses — `createPdfiumHostPlatform` answers `null` and the writer goes
  // unregistered.
  // -------------------------------------------------------------------------
  // TWO SINCE 2026-09-11, and the rule is what generalised rather than the list:
  // an entry is optional exactly when the MuPDF host does not need it to run —
  // the second engine's library, and the OCR models a machine may simply not have
  // provisioned. Both are features that are then not offered, where anything else
  // here missing is a host that dies before its first line.
  check(
    'the entries whose absence is not a failure are exactly the two a host can run without',
    set
      .filter((entry) => !entry.required)
      .map((entry) => entry.path)
      .sort()
      .join('|') === [dirname(pdfiumLibrary(root)), tessdataDirectory(root)].sort().join('|'),
    `optional: ${JSON.stringify(set.filter((entry) => !entry.required).map((e) => e.path))}. ` +
      `Everything else here is the host's OWN program — the runtime, its dependency graph, the ` +
      `shim, this application's packages — and a machine missing any of them cannot start a ` +
      `contained host at all. Marking one of those optional would restore the shape SSSS-1 ` +
      `measured: a green step on a machine where the host dies before its first line.`,
  );

  // A ROOT WITH NOTHING IN IT, which makes every path absent at once — the only
  // way to reach the branch from outside, since `apply` derives its set from the
  // root it is given and nothing can be injected.
  const bare = mkdtempSync(join(tmpdir(), 'monstera-grants-bare-'));
  let absent;
  try {
    absent = apply({ root: bare });
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }

  check(
    'an OPTIONAL path that is not provisioned is reported and NOT failed',
    absent.failed.every((line) => !line.startsWith(dirname(pdfiumLibrary(bare)))) &&
      absent.lines.some((line) => line.includes(dirname(pdfiumLibrary(bare)))),
    `failed: ${JSON.stringify(absent.failed)}\nlines: ${JSON.stringify(absent.lines)}. ` +
      `It must appear in one of them: silently dropping it would make "this machine has no ` +
      `second engine" — which is worth reading — indistinguishable from a set that never ` +
      `named it.`,
  );

  check(
    'CONTROL: a REQUIRED path that is not provisioned IS a failure',
    absent.failed.some((line) => line.startsWith(electronRoot(bare))),
    `failed: ${JSON.stringify(absent.failed)}. Without this the case above is satisfied by an ` +
      `\`apply\` that stopped failing on ANY absent path, which is the original defect — ` +
      `"absent is not done" — reintroduced while looking like the fix for it.`,
  );

  // ---- The round trip, on a throwaway ----
  const windows = process.platform === 'win32';
  let granted = false;
  let released = false;

  if (windows) {
    const directory = mkdtempSync(join(tmpdir(), 'monstera-grants-'));
    const probe = join(directory, 'probe.txt');
    writeFileSync(probe, 'probe\n', 'utf8');
    try {
      const before = readAcl(probe);
      if (before !== null && namesApplicationPackages(before)) {
        throw new Error(
          `the throwaway already names ${ALL_APPLICATION_PACKAGES} before anything was granted. ` +
            `Then a grant cannot be told from an inheritance, and the control below would pass ` +
            `on a state this proof did not create.`,
        );
      }
      spawnSync('icacls', [probe, '/grant', `*${ALL_APPLICATION_PACKAGES}:(RX)`], {
        encoding: 'utf8',
      });
      granted = namesApplicationPackages(readAcl(probe) ?? '');
      spawnSync('icacls', [probe, '/remove:g', `*${ALL_APPLICATION_PACKAGES}`], {
        encoding: 'utf8',
      });
      released = !namesApplicationPackages(readAcl(probe) ?? '');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // WHICH STATE IS A FAILURE — the decision `--check`'s exit code rests on.
  //
  // Finding ZZZZZ-2: that exit code changed on 2026-09-01 and this file was not
  // touched, so the rule had no case. These run on every platform, because the
  // rule is about `inspect`'s output and not about a DACL.
  //
  // The middle case is the load-bearing one and it is the one a careless
  // version breaks: `present === null` is *not provisioned* or *ACL
  // unreadable*, and treating either as a failure turns this red on every
  // machine that has never run a contained host, which is most of them.
  // -------------------------------------------------------------------------
  const nowhere = [{ path: 'a', present: null }, { path: 'b', present: null }];
  const rewritten = [{ path: 'a', present: true }, { path: 'b', present: false }];
  const clean = [{ path: 'a', present: true }, { path: 'b', present: true }];

  check(
    'a path that EXISTS and is not granted is a failure, and is named',
    lostGrants(rewritten).length === 1 && lostGrants(rewritten)[0]?.path === 'b',
    `lostGrants reported ${JSON.stringify(lostGrants(rewritten))}. A tree that was granted and ` +
      `now is not has been rewritten, and a contained host dies before its first line rather ` +
      `than saying so — which is exactly the diagnosis this state cost once.`,
  );
  check(
    'CONTROL: nothing provisioned is NOT a failure',
    lostGrants(nowhere).length === 0,
    `lostGrants reported ${JSON.stringify(lostGrants(nowhere))} for two absent paths. A path ` +
      `that does not exist cannot be granted; reporting it would make this red on every ` +
      `machine that has never run a contained host, and a check people expect to be red is ` +
      `one they stop reading.`,
  );
  check(
    'CONTROL: everything granted is NOT a failure',
    lostGrants(clean).length === 0,
    `lostGrants reported ${JSON.stringify(lostGrants(clean))} for a fully granted tree.`,
  );

  check(
    'a grant TAKES, unelevated, and the ACL says so rather than the exit code',
    granted,
    `the ACL did not name ${ALL_APPLICATION_PACKAGES} after granting. ADR-0027 rests on this ` +
      `working without elevation, because the user holds (I)(F) — and so WRITE_DAC — on these ` +
      `trees.`,
    windows,
  );
  check(
    'and it REVERSES, which is what makes the step safe to run',
    released,
    `the ACL still named ${ALL_APPLICATION_PACKAGES} after removal. A provisioning step that ` +
      `grants and cannot un-grant leaves ACEs behind naming a principal nothing uses.`,
    windows,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nContainer-grant proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('container-grant case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
