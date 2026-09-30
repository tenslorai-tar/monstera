import { basename, dirname, join } from 'node:path';

import { type Result, err, ok } from '@monstera/shared';

import { type UserSid, isPackageDataLocked, packageDataDacl } from './hostDacl.js';

/**
 * Route D (ADR-0023 Decision 17, the owner's decision of 2026-09-30): in an installed build the engine hosts are child
 * containers of the package and hold its capability, which opens the install root they need and the package's data
 * folders they must not reach. So `main` locks those folders, at every start and before any host exists, and a check
 * reads the locks back and refuses to create a host while one does not hold.
 *
 * The five folders are every package data folder the host was measured to reach — the app's own data is under
 * `LocalCache`, and the host could write to the three State folders and read `Settings`. `AC`, `AppData` and
 * `SystemAppData` refused it already and are left as Windows made them.
 */
export const PACKAGE_DATA_FOLDERS = ['LocalCache', 'LocalState', 'RoamingState', 'TempState', 'Settings'] as const;

/** Reading and writing one folder's DACL — `win32DaclSurface.ts` in the application, a fake in the cases. */
export interface DaclSurface {
  /** The folder's DACL as SDDL, or `null` where it could not be read. */
  readonly read: (path: string) => string | null;
  /** Replaces the folder's DACL with `sddl`, protected. `false` where Windows refused. */
  readonly write: (path: string, sddl: string) => boolean;
}

/** A folder the lock does not hold on, and why. */
export interface UnlockedFolder {
  readonly folder: string;
  readonly reason: string;
}

/** What one start did. `unlocked` empty is the only state in which a host may be created. */
export interface PackageDataLock {
  /** Folders this start had to lock — empty on every start after the first unless something undid a lock. */
  readonly locked: readonly string[];
  readonly unlocked: readonly UnlockedFolder[];
}

/**
 * Locks every package data folder under `packageRoot` that is not locked, then reads each back.
 *
 * A folder already carrying the lock is not written: the common start writes nothing, and a write that propagates
 * through the app's whole data tree at every start would be a cost with no reason. A folder whose DACL cannot be read
 * or does not read back as locked is UNLOCKED — never assumed locked because the write said yes.
 */
export function lockPackageData(packageRoot: string, user: UserSid, surface: DaclSurface): PackageDataLock {
  const locked: string[] = [];
  const unlocked: UnlockedFolder[] = [];
  for (const folder of PACKAGE_DATA_FOLDERS) {
    const path = join(packageRoot, folder);
    const before = surface.read(path);
    if (before !== null && isPackageDataLocked(before)) continue;
    if (!surface.write(path, packageDataDacl(user))) {
      unlocked.push({ folder, reason: 'Windows refused the new DACL' });
      continue;
    }
    const after = surface.read(path);
    if (after === null) unlocked.push({ folder, reason: 'its DACL could not be read back' });
    else if (!isPackageDataLocked(after)) unlocked.push({ folder, reason: `it reads back as ${after}` });
    else locked.push(folder);
  }
  return { locked, unlocked };
}

/**
 * THE STARTUP CHECK: locks this package's data and answers whether a host may be created. `err` names what does not
 * hold — a root that could not be resolved, or every folder left unlocked — and is the only answer on which the
 * caller creates no platform; `ok` carries what this start had to lock, which is empty on an ordinary start.
 *
 * @param redirectedRoaming where the virtualization sends Roaming AppData, or why Windows did not say
 * @param family the running package's family name — a process with none has no package capability to take away
 */
export function gatePackageData(
  redirectedRoaming: Result<string, string>,
  family: string,
  user: UserSid,
  surface: DaclSurface,
): Result<PackageDataLock, string> {
  if (!redirectedRoaming.ok) return err(`the package's data root was not found: ${redirectedRoaming.error}`);
  const root = packageDataRoot(redirectedRoaming.value, family);
  if (!root.ok) return err(`the package's data root was not found: ${root.error}`);
  const lock = lockPackageData(root.value, user, surface);
  if (lock.unlocked.length > 0) {
    const named = lock.unlocked.map(({ folder, reason }) => `${folder} (${reason})`).join('; ');
    return err(`${root.value}: not locked: ${named}. No contained host is created while a host could reach these.`);
  }
  return ok(lock);
}

/**
 * The log line one packaged start owes, whatever the check found.
 *
 * EVERY START WRITES ONE, and silence is not one of the answers. A start that found all five locked and wrote nothing
 * would otherwise log nothing — the same log as a start where the check never ran, which is the reading the owner
 * takes after an install (measured 2026-09-30: the built 0.1.2.0 layout, run in the installed package's identity with
 * the folders already locked, left the log exactly as it found it).
 */
export function describePackageDataCheck(
  outcome: Result<PackageDataLock, string>,
): { readonly kind: 'failure' | 'notice'; readonly detail: string } {
  if (!outcome.ok) return { kind: 'failure', detail: outcome.error };
  const { locked } = outcome.value;
  return {
    kind: 'notice',
    detail:
      locked.length === 0
        ? `all ${String(PACKAGE_DATA_FOLDERS.length)} read back locked; none needed writing`
        : `locked this start: ${locked.join(', ')}; all ${String(PACKAGE_DATA_FOLDERS.length)} read back locked`,
  };
}

/**
 * The package's data root: two levels above where the file-system virtualization sends Roaming AppData (ADR-0023
 * Decision 17, point 3 as corrected).
 *
 * Twice from something that was not the authority, and each was measured when it failed. `userData`'s final path lands
 * in `LocalCache` only while no same-named folder exists in the real `%APPDATA%`; `GetAppContainerFolderPath` for a
 * SID derived from the family answers from a plain process and returns a null SID inside the identity, where `main`
 * runs. The redirection's own answer is `…\Packages\<family>\LocalCache\Roaming`, and it must have exactly that shape;
 * anything else — the plain `…\AppData\Roaming` a process with no redirection gets — is refused rather than guessed,
 * since locking the wrong folder would change something this application does not own.
 *
 * @param redirectedRoaming `SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_RETURN_FILTER_REDIRECTION_TARGET)`
 * @param family the running package's family name
 */
export function packageDataRoot(redirectedRoaming: string, family: string): Result<string, string> {
  const localCache = dirname(redirectedRoaming);
  const root = dirname(localCache);
  if (basename(redirectedRoaming).toLowerCase() !== 'roaming' || basename(localCache).toLowerCase() !== 'localcache') {
    return err(`${redirectedRoaming} is not a package's LocalCache\\Roaming — Roaming AppData is not redirected here`);
  }
  if (basename(root).toLowerCase() !== family.toLowerCase()) {
    return err(`${root} is not named after the package family ${family}`);
  }
  return ok(root);
}
