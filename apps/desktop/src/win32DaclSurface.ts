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
  readonly deriveContainerSid: Native;
  readonly containerFolder: Native;
  readonly sidToString: Native;
  readonly freeSid: Native;
  readonly coTaskMemFree: Native;
}

let bound: DaclBindings | undefined;

function bind(): DaclBindings {
  if (bound !== undefined) return bound;
  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');
  const userenv = koffi.load('userenv.dll');
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
    deriveContainerSid: userenv.func(
      'int32 DeriveAppContainerSidFromAppContainerName(const char16_t *name, _Out_ void **sid)',
    ) as Native,
    containerFolder: userenv.func('int32 GetAppContainerFolderPath(const char16_t *sid, _Out_ void **path)') as Native,
    sidToString: advapi.func('bool ConvertSidToStringSidW(void *sid, _Out_ void **text)') as Native,
    freeSid: advapi.func('void *FreeSid(void *sid)') as Native,
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

/**
 * The folder Windows keeps for an AppContainer named `name` — for a package family, `…\Packages\<family>\AC` — from
 * the SID Windows derives for that name (ADR-0023 Decision 17, amended point 3). `err` carries the HRESULT: an
 * uninstalled family answers `0x80070002`, measured 2026-09-30.
 */
export function appContainerFolder(name: string): Result<string, string> {
  const api = bind();
  const sidText = derivedContainerSid(api, name);
  if (!sidText.ok) return sidText;
  const path: unknown[] = [null];
  const found = api.containerFolder(sidText.value, path) as number;
  if (found !== 0) return err(`GetAppContainerFolderPath answered ${hresult(found)} for ${sidText.value}`);
  try {
    return ok(koffi.decode(path[0], 'char16_t', -1) as string);
  } finally {
    api.coTaskMemFree(path[0]);
  }
}

/** The SID Windows derives for an AppContainer name, as text; the binary SID is freed either way. */
function derivedContainerSid(api: DaclBindings, name: string): Result<string, string> {
  const sid: unknown[] = [null];
  const derived = api.deriveContainerSid(name, sid) as number;
  if (derived !== 0) return err(`DeriveAppContainerSidFromAppContainerName answered ${hresult(derived)}`);
  try {
    const text: unknown[] = [null];
    if (api.sidToString(sid[0], text) !== true) return err('the derived SID could not be written as text');
    try {
      return ok(koffi.decode(text[0], 'char16_t', -1) as string);
    } finally {
      api.localFree(text[0]);
    }
  } finally {
    api.freeSid(sid[0]);
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
