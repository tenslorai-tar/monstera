// @ts-check
/**
 * The running application's processes and the private memory each holds, by role: the ONE reader of that, which
 * `appMemory.mjs` and the memory walk both call (B3a), so the two can never classify a process differently.
 *
 * Windows only: every process is read with `Get-CimInstance Win32_Process` (private bytes, `PrivatePageCount`) and
 * classified by its command line: `main`, `renderer`, `gpu`, `utility`, `crashpad`, and the engine hosts, which are
 * named by the entry file they run (`host mupdf`, `host pdfium`, `host compose`).
 */

import { descendantsAmong, listProcesses } from './childProcesses.mjs';

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
  const all = listProcesses();
  const dump = options.dump ?? null;
  if (dump !== null) {
    for (const each of all.filter((p) => p.name.toLowerCase() === dump.toLowerCase())) {
      console.error(`DUMP pid=${String(each.pid)} parent=${String(each.parent)} private=${String(each.privateBytes)} cmd=${(each.commandLine ?? '<unreadable>').slice(-90)}`);
    }
  }
  const isHost = (/** @type {{ commandLine?: string | null }} */ process) =>
    /(?:hostEntry|pdfiumHostEntry|composeHostEntry)\.js/iu.test(process.commandLine ?? '');
  // EACH EDGE BY childProcesses.mjs' RULE: a recorded parent id alone can name a process whose parent ended before `root`
  // began and whose id `root` was then given.
  const inTree = descendantsAmong(root, all);
  // A HOST WHOSE PARENT IS GONE is still this application's when it runs THIS tree's binary, and another application's
  // when it runs a different one: the first reading of the walk counted the installed Store app's three hosts at the
  // start screen (2026-10-13), because every process running a host entry file was taken wherever it ran.
  const binaries = new Set(all.filter((p) => inTree.has(p.pid) && /--type=/u.test(p.commandLine ?? '')).map((p) => p.executablePath));
  for (const process of all) {
    if (!inTree.has(process.pid) && isHost(process) && binaries.has(process.executablePath)) inTree.add(process.pid);
  }
  // `root` IS A WRAPPER when a process that is neither a typed child nor a host runs beneath it (the launcher the walk
  // harness is handed): the wrapper is `launcher`, and that process is `main`. Without one, `root` is `main`.
  const mainProcess = all.find((p) => p.pid !== root && inTree.has(p.pid) && !isHost(p) && !/--type=/u.test(p.commandLine ?? ''));
  const mainPid = mainProcess?.pid ?? root;
  return all
    .filter((process) => inTree.has(process.pid))
    .map((process) => {
      const line = process.commandLine ?? '';
      const type = /--type=([a-z-]+)/u.exec(line)?.[1];
      // CASE-INSENSITIVE: the entry file is `hostEntry.js` in one build's command line and `HostEntry.js` in another's.
      const host = /(hostEntry|pdfiumHostEntry|composeHostEntry)\.js/iu.exec(line)?.[1]?.toLowerCase();
      const role =
        process.pid === mainPid
          ? 'main'
          : process.pid === root
            ? 'launcher'
            : host !== undefined
              ? `host ${host === 'hostentry' ? 'mupdf' : host === 'pdfiumhostentry' ? 'pdfium' : 'compose'}`
              : type === 'renderer'
                ? 'renderer'
                : type === 'gpu-process'
                  ? 'gpu'
                  : type === 'utility'
                    ? 'utility'
                    : type === 'crashpad-handler'
                      ? 'crashpad'
                      : (type ?? 'unclassified');
      return { pid: process.pid, parent: process.parent, role, privateBytes: process.privateBytes ?? 0 };
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
