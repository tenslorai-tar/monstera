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
}

let bound: DaclBindings | undefined;

function bind(): DaclBindings {
  if (bound !== undefined) return bound;
  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');
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
