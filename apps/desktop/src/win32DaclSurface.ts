import { type Result, err, ok } from '@monstera/shared';
import koffi from 'koffi';

import type { DaclSurface } from './packageDataLock.js';

/**
 * Reading and writing a folder's DACL, and the running package's family name — the Win32 calls route D takes
 * (ADR-0023 Decision 17). `packageDataLock.ts` holds the rule; this file only speaks to Windows.
 */

const SE_FILE_OBJECT = 1;
const DACL_SECURITY_INFORMATION = 0x00000004;
/** Replaces the DACL as PROTECTED: nothing inherits into it from the folder above. */
const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
const SDDL_REVISION_1 = 1;
const ERROR_SUCCESS = 0;
const APPMODEL_ERROR_NO_PACKAGE = 15700;

type Native = (...args: unknown[]) => unknown;

interface DaclBindings {
  readonly getNamedSecurityInfo: Native;
  readonly setNamedSecurityInfo: Native;
  readonly toSddl: Native;
  readonly fromSddl: Native;
  readonly getDacl: Native;
  readonly localFree: Native;
  readonly familyName: Native;
  readonly knownFolderPath: Native;
  readonly coTaskMemFree: Native;
}

let bound: DaclBindings | undefined;

function bind(): DaclBindings {
  if (bound !== undefined) return bound;
  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');
  const shell = koffi.load('shell32.dll');
  const ole = koffi.load('ole32.dll');
  // Written from the C prototype on the adjacent line, as the other Win32 surfaces are: koffi's `func()` is
  // assignable to any signature, so the pair reading together is the review mechanism.
  bound = {
    getNamedSecurityInfo: advapi.func(
      'uint32 GetNamedSecurityInfoW(const char16_t *name, int type, uint32 info, void *owner, void *group, ' +
        '_Out_ void **dacl, void *sacl, _Out_ void **sd)',
    ) as Native,
    setNamedSecurityInfo: advapi.func(
      'uint32 SetNamedSecurityInfoW(const char16_t *name, int type, uint32 info, void *owner, void *group, ' +
        'void *dacl, void *sacl)',
    ) as Native,
    toSddl: advapi.func(
      'bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void *sd, uint32 revision, uint32 info, ' +
        '_Out_ void **text, _Out_ uint32 *length)',
    ) as Native,
    fromSddl: advapi.func(
      'bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *sddl, uint32 revision, ' +
        '_Out_ void **sd, _Out_ uint32 *size)',
    ) as Native,
    getDacl: advapi.func(
      'bool GetSecurityDescriptorDacl(void *sd, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)',
    ) as Native,
    localFree: kernel.func('void *LocalFree(void *memory)') as Native,
    familyName: kernel.func('long GetCurrentPackageFamilyName(_Inout_ uint32 *length, void *name)') as Native,
    knownFolderPath: shell.func(
      'int32 SHGetKnownFolderPath(const uint8 *id, uint32 flags, void *token, _Out_ void **path)',
    ) as Native,
    coTaskMemFree: ole.func('void CoTaskMemFree(void *memory)') as Native,
  };
  return bound;
}

/** The DACL surface `lockPackageData` takes. Throws if the calls cannot be bound — there is no degraded mode. */
export function createWin32DaclSurface(): DaclSurface {
  const api = bind();
  return {
    read: (path) => {
      const dacl: unknown[] = [null];
      const sd: unknown[] = [null];
      if (api.getNamedSecurityInfo(path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, null, null, dacl, null, sd) !== ERROR_SUCCESS) {
        return null;
      }
      try {
        const text: unknown[] = [null];
        const length: unknown[] = [0];
        if (api.toSddl(sd[0], SDDL_REVISION_1, DACL_SECURITY_INFORMATION, text, length) !== true) return null;
        try {
          return koffi.decode(text[0], 'char16_t', -1) as string;
        } finally {
          api.localFree(text[0]);
        }
      } finally {
        api.localFree(sd[0]);
      }
    },
    write: (path, sddl) => {
      const sd: unknown[] = [null];
      const size: unknown[] = [0];
      if (api.fromSddl(sddl, SDDL_REVISION_1, sd, size) !== true) return false;
      try {
        const present: unknown[] = [0];
        const dacl: unknown[] = [null];
        const defaulted: unknown[] = [0];
        if (api.getDacl(sd[0], present, dacl, defaulted) !== true || present[0] === 0) return false;
        const info = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
        return api.setNamedSecurityInfo(path, SE_FILE_OBJECT, info, null, null, dacl[0], null) === ERROR_SUCCESS;
      } finally {
        api.localFree(sd[0]);
      }
    },
  };
}

/** `FOLDERID_RoamingAppData`, `{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}`, as the GUID's in-memory bytes. */
const ROAMING_APP_DATA = Buffer.from([
  0xdb, 0x85, 0xb6, 0x3e, 0xf9, 0x65, 0xf6, 0x4c, 0xa0, 0x3a, 0xe3, 0xef, 0x65, 0x72, 0x9f, 0x3d,
]);
/** Return where the app's file-system virtualization sends the folder, rather than the name it shows. */
const KF_FLAG_RETURN_FILTER_REDIRECTION_TARGET = 0x00040000;

/**
 * Where this process's file-system virtualization sends Roaming AppData (ADR-0023 Decision 17, point 3 as corrected).
 * Inside a package it is `…\Packages\<family>\LocalCache\Roaming`, measured 2026-09-30 while a same-named real folder
 * existed; a process with no identity gets the plain path back, which the caller's rule refuses.
 */
export function roamingRedirectionTarget(): Result<string, string> {
  const api = bind();
  const path: unknown[] = [null];
  const found = api.knownFolderPath(ROAMING_APP_DATA, KF_FLAG_RETURN_FILTER_REDIRECTION_TARGET, null, path) as number;
  if (found !== 0) return err(`SHGetKnownFolderPath answered ${hresult(found)}`);
  try {
    return ok(koffi.decode(path[0], 'char16_t', -1) as string);
  } finally {
    api.coTaskMemFree(path[0]);
  }
}

function hresult(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

/** The running package's family name, or `null` for a process with no package identity — every development run. */
export function currentPackageFamilyName(): string | null {
  const api = bind();
  const length: unknown[] = [0];
  const first = api.familyName(length, null);
  if (first === APPMODEL_ERROR_NO_PACKAGE) return null;
  const buffer = Buffer.alloc(Number(length[0]) * 2);
  if (api.familyName(length, buffer) !== ERROR_SUCCESS) return null;
  return buffer.toString('utf16le').replace(/\0+$/u, '');
}
