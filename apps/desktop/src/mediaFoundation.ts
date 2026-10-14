import { join } from 'node:path';

/**
 * Whether Windows' Media Foundation is on this computer — what the camera needs.
 *
 * Windows N and KN editions ship without it until the Media Feature Pack is added, and `Monstera.exe` (Chromium)
 * delay-loads `MF.dll`, `MFPlat.DLL` and `MFReadWrite.dll` (read from its delay-load table on 2026-10-14,
 * `scripts/release/dllClosure.mjs`), so the application starts and the camera alone fails — which the camera used to
 * report as *another app may be using it*. `mfplat.dll` is the platform library the other two need; its absence from
 * `System32` is the N edition's state. Off Windows there is no such edition, and the answer is `true`.
 */
export function hasMediaFoundation(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  exists: (path: string) => boolean,
): boolean {
  if (platform !== 'win32') return true;
  return exists(join(systemRoot ?? 'C:\\Windows', 'System32', 'mfplat.dll'));
}
