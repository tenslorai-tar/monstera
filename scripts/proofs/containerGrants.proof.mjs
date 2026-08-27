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
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  ALL_APPLICATION_PACKAGES,
  grantSet,
  namesApplicationPackages,
  readAcl,
} from '../provision/containerGrants.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

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
    'the set names four artefacts, each with a stated reason',
    set.length === 4 && set.every((entry) => entry.why.length > 0),
    `got ${set.length}: ${JSON.stringify(set.map((entry) => entry.why))}`,
  );

  check(
    'it is DERIVED — the runtime path carries the pinned version from its own resolver',
    paths.some((path) => /[\\/]\.tools[\\/]electron[\\/]\d+\.\d+\.\d+$/u.test(path)),
    `paths: ${JSON.stringify(paths)}. A literal version here would be a second opinion about ` +
      `what \`electronRoot\` already answers, and the two would drift on the next bump.`,
  );

  check(
    'and the FFI sibling carries THIS platform, not a hard-coded one',
    paths.some((path) => path.includes(`koffi-${process.platform}-${process.arch}`)),
    `paths: ${JSON.stringify(paths)}`,
  );

  check(
    'the per-session pair is NOT in it',
    !paths.some((path) => /scratch|snapshot/iu.test(path)),
    `paths: ${JSON.stringify(paths)}. \`createSessionDirectories\` passes a security descriptor ` +
      `to CreateDirectoryW, so there is no window in which those exist ungranted and no grant ` +
      `step to take. Provisioning owns durable artefacts; a session owns its own.`,
  );

  check(
    'every right is read+execute — nothing durable is granted write',
    set.every((entry) => entry.rights === 'RX'),
    `rights: ${JSON.stringify(set.map((entry) => entry.rights))}. A contained host that could ` +
      `write the runtime or the shim could rewrite what it next executes.`,
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
