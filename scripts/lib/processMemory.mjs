// @ts-check
/**
 * The running application's processes and the private memory each holds, by role: the ONE reader of that, which
 * `appMemory.mjs` and the memory walk both call (B3a), so the two can never classify a process differently.
 *
 * Windows only: every process is read with `Get-CimInstance Win32_Process` (private bytes, `PrivatePageCount`) and
 * classified by its command line: `main`, `renderer`, `gpu`, `utility`, `crashpad`, and the engine hosts, which are
 * named by the entry file they run (`host mupdf`, `host pdfium`, `host compose`).
 */

import { execFileSync } from 'node:child_process';

/**
 * @typedef {{ pid: number, parent: number, role: string, privateBytes: number }} ProcessMemory
 */

/**
 * Every process in the tree under `root` and every engine host, wherever its parent is: a host is a process `main`
 * creates itself (ADR-0022), and the first reading found none under `main` in the tree, so hosts are named by what they
 * run.
 *
 * @param {number} root `main`'s process id
 * @param {{ readonly dump?: string | null }} [options] `dump`: an executable name whose every process is written to
 *   stderr, wherever it hangs and whether its command line is readable
 * @returns {ProcessMemory[]}
 */
export function processTreeMemory(root, options = {}) {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, PrivatePageCount, CommandLine, Name | ConvertTo-Json -Compress';
  const all = /** @type {{ ProcessId: number, ParentProcessId: number, PrivatePageCount: number, CommandLine: string | null, Name: string }[]} */ (
    JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 << 20 }))
  );
  const dump = options.dump ?? null;
  if (dump !== null) {
    for (const each of all.filter((p) => p.Name.toLowerCase() === dump.toLowerCase())) {
      console.error(`DUMP pid=${String(each.ProcessId)} parent=${String(each.ParentProcessId)} private=${String(each.PrivatePageCount)} cmd=${(each.CommandLine ?? '<unreadable>').slice(-90)}`);
    }
  }
  const inTree = new Set([root]);
  for (const process of all) {
    if (/(?:hostEntry|pdfiumHostEntry|composeHostEntry)\.js/u.test(process.CommandLine ?? '')) inTree.add(process.ProcessId);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const process of all) {
      if (!inTree.has(process.ProcessId) && inTree.has(process.ParentProcessId)) {
        inTree.add(process.ProcessId);
        grew = true;
      }
    }
  }
  return all
    .filter((process) => inTree.has(process.ProcessId))
    .map((process) => {
      const line = process.CommandLine ?? '';
      const type = /--type=([a-z-]+)/u.exec(line)?.[1];
      const host = /(hostEntry|pdfiumHostEntry|composeHostEntry)\.js/u.exec(line)?.[1];
      const role =
        process.ProcessId === root
          ? 'main'
          : host !== undefined
            ? `host ${host === 'hostEntry' ? 'mupdf' : host === 'pdfiumHostEntry' ? 'pdfium' : 'compose'}`
            : type === 'renderer'
              ? 'renderer'
              : type === 'gpu-process'
                ? 'gpu'
                : type === 'utility'
                  ? 'utility'
                  : type === 'crashpad-handler'
                    ? 'crashpad'
                    : (type ?? 'unclassified');
      return { pid: process.ProcessId, parent: process.ParentProcessId, role, privateBytes: Number(process.PrivatePageCount) };
    });
}

/**
 * Private bytes summed per role.
 *
 * @param {readonly { role: string, privateBytes: number }[]} processes
 * @returns {Record<string, number>}
 */
export function byRole(processes) {
  /** @type {Record<string, number>} */
  const sums = {};
  for (const { role, privateBytes } of processes) sums[role] = (sums[role] ?? 0) + privateBytes;
  return sums;
}
