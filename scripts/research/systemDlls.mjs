// @ts-check
/**
 * Reads, on a Windows machine, whether every DLL `dllClosure.mjs` counts as part of Windows is there: each name in
 * `SYSTEM_DLLS` must be in `System32` or in the KnownDLLs key. The KnownDLLs half of that list was recalled, not read,
 * because it was written on Linux; this is the reading it owes. Run it on the oldest Windows the package declares
 * (10.0.17763, version 1809) and on an N edition, where `DELAY_ONLY`'s Media Foundation should be ABSENT.
 *
 * Positive control: `kernel32.dll` must be found, or the reading is refused — a lookup that could see nothing would
 * report every name present in the same voice as one that found them all.
 *
 * Usage (Windows only): node scripts/research/systemDlls.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { DELAY_ONLY, SYSTEM_DLLS } from '../release/dllClosure.mjs';

if (process.platform !== 'win32') {
  process.stderr.write('This reads System32 and the registry; run it on Windows.\n');
  process.exit(2);
}

const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');
const known = execFileSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\KnownDLLs'], {
  encoding: 'utf8',
})
  .split(/\r?\n/u)
  .map((line) => /REG_SZ\s+(\S+)/u.exec(line)?.[1]?.toLowerCase())
  .filter((name) => name !== undefined);

const present = (/** @type {string} */ name) => known.includes(name) || existsSync(join(system32, name));
if (!present('kernel32.dll')) throw new Error(`kernel32.dll was not found in ${system32}: this reading cannot see.`);

const missing = [...SYSTEM_DLLS].filter((name) => !present(name));
process.stdout.write(`Windows ${execFileSync('cmd', ['/c', 'ver'], { encoding: 'utf8' }).trim()}\n`);
process.stdout.write(`KnownDLLs read: ${String(known.length)} entries\n`);
process.stdout.write(`SYSTEM_DLLS not on this machine: ${missing.length === 0 ? 'none' : missing.join(', ')}\n`);
process.stdout.write(`DELAY_ONLY present: ${[...DELAY_ONLY].map((name) => `${name}=${String(present(name))}`).join(', ')}\n`);
process.exit(missing.length === 0 ? 0 : 1);
