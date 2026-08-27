// @ts-check
/**
 * The ACEs a contained engine host needs to reach what it runs (ADR-0027).
 *
 * ## Why this is provisioning and not application code
 *
 * A contained host cannot start from a development checkout at all. Measured
 * 2026-08-27: `icacls .tools\electron\<version>\electron.exe` returns SYSTEM,
 * Administrators and this user and **nothing else** — no `ALL APPLICATION
 * PACKAGES` ACE and no container SID. An AppContainer's access check is
 * conjunctive (ADR-0023 §4's 2026-08-24 correction), so the token cannot execute
 * the image and the process dies before its first line.
 *
 * In production MSIX inheritance grants that principal. In development nothing
 * does, and ADR-0027 decides who closes the gap: **the thing that installs an
 * artefact owns its state** (B3). `electron.mjs` puts the runtime in place, so
 * the ACEs that make it executable by a contained token belong beside it. A
 * grant taken by the application would be a second writer of a property
 * provisioning already establishes — and, worse, security-relevant code that
 * executes only in the configuration nobody audits.
 *
 * ## The principal is `ALL APPLICATION PACKAGES`, deliberately
 *
 * Not the container SID. Production reaches the runtime because MSIX grants
 * exactly this principal, so granting the same one here leaves **how the ACE
 * arrived** as the only difference between the two configurations. The specific
 * container SID would also work and would make them differ in the principal as
 * well — one more axis along which a development result could fail to transfer.
 *
 * ## The path set is DERIVED
 *
 * ADR-0027 refuses to list it: *"the provisioning step takes its set from what
 * the host must reach, and a list restated in this ADR would be a second
 * opinion about it"*. So every path here comes from the resolver that already
 * owns that artefact — `electronRoot`, `shimPath`, and koffi's own package
 * layout keyed by `platformKey`. Nothing is spelled out that something else
 * already answers.
 *
 * **What is NOT here:** the per-session pair. `createSessionDirectories` passes
 * a security descriptor to `CreateDirectoryW`, so there is no window in which
 * those exist ungranted and no grant step to take. Provisioning owns durable
 * artefacts; a session owns its own.
 *
 * ## Reversal is part of the step, not an afterthought
 *
 * A provisioning step that grants must be able to un-grant, or an uninstall
 * leaves ACEs behind naming a principal nothing on the machine uses. `--revoke`
 * is that, and it is the same list.
 *
 * ## The control, on every run
 *
 * `icacls` reports success on its own exit code, and a grant that did not take
 * looks exactly like one that did if nobody reads the DACL back. So each path is
 * READ BACK after the write and the outcome is decided by what the ACL says,
 * never by the exit status. That is the same rule the spike states — *its
 * positive control is the grant itself* — and the reason a report here is worth
 * anything.
 *
 * Usage: node scripts/provision/containerGrants.mjs [--revoke | --check]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { shimPath } from '../lib/shimBinary.mjs';
import { electronRoot } from './electron.mjs';

/**
 * `ALL APPLICATION PACKAGES`, by SID rather than by name.
 *
 * The display name is localised — a German Windows renders it
 * `ALLE ANWENDUNGSPAKETE` — and an `icacls` argument written as a name fails on
 * those machines with a message about an unknown principal. The SID is the same
 * everywhere, which is why the spike uses it and why this does.
 */
export const ALL_APPLICATION_PACKAGES = 'S-1-15-2-1';

/**
 * What a contained host must reach, each derived from the resolver that owns it.
 *
 * @param {string} [root]
 * @returns {Array<{ path: string, rights: string, why: string }>}
 */
export function grantSet(root = repoRoot()) {
  return [
    { path: electronRoot(root), rights: 'RX', why: 'the runtime binary and its resources' },
    // NODE_MODULES WHOLE, which subsumes the two koffi entries this list used to
    // name separately. The host's program is ordinary Node code: it resolves
    // `@monstera/contract`, `@monstera/shared`, `mupdf`, `@cantoo/pdf-lib` and
    // `zod` by walking node_modules, and a set naming only the packages known
    // today is one that goes stale the next time a dependency is added — 4c's
    // direction, since the failure to fear is a MISSING grant.
    { path: join(root, 'node_modules'), rights: 'RX', why: 'the dependency graph the host resolves' },
    { path: dirname(shimPath(root)), rights: 'RX', why: 'the engine shim' },
    // THE APPLICATION'S OWN CODE, which the four-path set omitted entirely and
    // which SSSS-1 measured the host dying on: `Cannot find module
    // …dist/host/hostEntry.js`, from a token that could not read it.
    //
    // The package ROOT rather than its `dist`, and that is measured rather than
    // reasoned: resolving a bare specifier reads the package's own
    // `package.json` for its `exports` map, and that sits beside `dist` rather
    // than inside it. Granting the `dist` directories instead — everything else
    // held fixed — leaves the contained cell dying at `module-resolution`,
    // which is the same failure the four-path set produced and one step earlier
    // than the one it was meant to fix. Measured 2026-08-27 by making exactly
    // that substitution and running the acceptance test.
    ...workspacePackages(root).map((path) => ({
      path,
      rights: /** @type {const} */ ('RX'),
      why: 'a workspace package the host loads',
    })),
  ];
}

/**
 * The workspace package directories, from the filesystem rather than a list.
 *
 * `package.json` declares `packages/*` and `apps/*`; reading the directories is
 * the same answer without a glob implementation, and it grows on its own when a
 * package is added — which is the direction 4c asks for here, because the
 * failure to fear is a package the container cannot read.
 *
 * @param {string} root
 * @returns {string[]}
 */
function workspacePackages(root) {
  /** @type {string[]} */
  const found = [];
  for (const group of ['packages', 'apps']) {
    let entries;
    try {
      entries = readdirSync(join(root, group), { withFileTypes: true });
    } catch {
      // The group is absent. Returning nothing for it would make the grant set
      // silently smaller, so the caller's own "not provisioned" refusal is what
      // reports it — but only for paths this returns, so an absent GROUP would
      // be invisible. It cannot be absent in a checkout of this repository, and
      // `proof:containergrants` asserts the set is non-empty for that reason.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) found.push(join(root, group, entry.name));
    }
  }
  return found.sort();
}

/**
 * The DACL for one path, or null when it cannot be read.
 *
 * **Null is not "no ACEs".** `icacls` answers *Access is denied* without
 * elevation on some trees, and treating that as an empty ACL would report the
 * reassuring answer for a path nobody looked at.
 *
 * @param {string} path
 * @returns {string | null}
 */
export function readAcl(path) {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ''}`;
}

/**
 * Whether a DACL names the application-package principal.
 *
 * Matched on the SID **and** on the canonical display name, because `icacls`
 * renders a known SID by name and an unknown one numerically — so a search for
 * either alone finds nothing on half the machines it runs on, and "found
 * nothing" is this function's reassuring answer.
 *
 * @param {string} acl
 * @returns {boolean}
 */
export function namesApplicationPackages(acl) {
  return acl.includes(ALL_APPLICATION_PACKAGES) || /ALL APPLICATION PACKAGES/iu.test(acl);
}

/** @param {string} path @param {string} rights */
function grantOne(path, rights) {
  return spawnSync(
    'icacls',
    [path, '/grant', `*${ALL_APPLICATION_PACKAGES}:(OI)(CI)(${rights})`],
    { encoding: 'utf8' },
  );
}

/** @param {string} path */
function revokeOne(path) {
  return spawnSync('icacls', [path, '/remove:g', `*${ALL_APPLICATION_PACKAGES}`], {
    encoding: 'utf8',
  });
}

/**
 * @typedef {{
 *   path: string,
 *   why: string,
 *   present: boolean | null,
 *   note: string,
 * }} PathState
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {PathState[]}
 */
export function inspect({ root = repoRoot() } = {}) {
  return grantSet(root).map((entry) => {
    if (!existsSync(entry.path)) {
      return { path: entry.path, why: entry.why, present: null, note: 'not provisioned' };
    }
    const acl = readAcl(entry.path);
    if (acl === null) {
      return { path: entry.path, why: entry.why, present: null, note: 'ACL unreadable' };
    }
    return {
      path: entry.path,
      why: entry.why,
      present: namesApplicationPackages(acl),
      note: '',
    };
  });
}

/**
 * Grants or revokes, then READS BACK and decides from the ACL.
 *
 * @param {{ root?: string, revoke?: boolean }} [options]
 * @returns {{ lines: string[], failed: string[] }}
 */
export function apply({ root = repoRoot(), revoke = false } = {}) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failed = [];

  for (const entry of grantSet(root)) {
    if (!existsSync(entry.path)) {
      // ABSENT IS NOT DONE. A path that is not provisioned cannot be granted,
      // and reporting it as fine would make this step green on a machine where
      // the host still cannot start.
      failed.push(`${entry.path} — not provisioned (${entry.why}). Provision it, then re-run.`);
      continue;
    }

    const result = revoke ? revokeOne(entry.path) : grantOne(entry.path, entry.rights);
    const acl = readAcl(entry.path);
    if (acl === null) {
      failed.push(`${entry.path} — ACL unreadable after ${revoke ? 'revoke' : 'grant'}`);
      continue;
    }

    // THE EXIT CODE IS NOT THE ANSWER. It is reported only when the read-back
    // disagrees with it, because that pair is the interesting diagnostic.
    const present = namesApplicationPackages(acl);
    const wanted = !revoke;
    if (present === wanted) {
      lines.push(`  ok  ${revoke ? 'released' : 'granted '}  ${entry.path}`);
    } else {
      failed.push(
        `${entry.path} — icacls exited ${String(result.status)} but the ACL ` +
          `${present ? 'still names' : 'does not name'} ${ALL_APPLICATION_PACKAGES}. ` +
          `The read-back decides, not the exit code.`,
      );
    }
  }
  return { lines, failed };
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  if (process.platform !== 'win32') {
    process.stdout.write(
      `  --  container grants are a Windows AppContainer concern; this is ${process.platform}.\n` +
        `      Nothing to do, and nothing is claimed — this is "not applicable", not "granted".\n`,
    );
    process.exit(0);
  }

  if (process.argv.includes('--check')) {
    for (const state of inspect()) {
      const mark = state.present === null ? ' -- ' : state.present ? ' ok ' : ' !! ';
      const said = state.present === null ? state.note : state.present ? 'granted' : 'NOT granted';
      process.stdout.write(` ${mark} ${said.padEnd(15)} ${state.path}\n`);
    }
    process.exit(0);
  }

  const revoke = process.argv.includes('--revoke');
  const { lines, failed } = apply({ revoke });
  process.stdout.write(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  if (failed.length > 0) {
    process.stderr.write(
      `\nContainer grants — ${failed.length} path(s) did not reach the intended state:\n\n` +
        failed.map((line) => `  - ${line}`).join('\n') +
        `\n\nA contained host cannot execute an image whose DACL does not name it, and it dies\n` +
        `before its first line rather than reporting why (ADR-0023 §4: the access check is\n` +
        `conjunctive). ADR-0027 is why this lives in provisioning rather than in the app.\n\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `\n${String(grantSet().length)} path(s) ${revoke ? 'released' : 'granted'} to ` +
      `${ALL_APPLICATION_PACKAGES}, each confirmed by reading the ACL back.\n`,
  );
}
