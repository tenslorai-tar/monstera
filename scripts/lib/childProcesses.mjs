// @ts-check
/**
 * Which running processes are a process's children: the ONE rule, and the one Windows read it decides over.
 *
 * ## Why a recorded parent id is not enough
 *
 * `Win32_Process.ParentProcessId` is the id the creating process had at the moment of creation. Windows never clears it
 * when that parent exits, and process ids are reused, so a process whose parent has ended names whichever process is
 * given that id next. Microsoft's own page for the class says so: the process the field identifies may have ended, and
 * the field may then refer to a process that reused the identifier
 * (https://learn.microsoft.com/windows/win32/cimwin32prov/win32-process).
 *
 * A process created before us cannot be our child, whatever id it records. So a process counts as `pid`'s child only
 * when it records `pid` as its parent AND it was created at or after `pid` was. Both times come from one listing, so
 * they are read off one clock.
 *
 * Measured, run 41347349873 (2026-11-01): `hostMemoryHost.mjs` asked for "every process whose parent is this pid",
 * found 3 where the shell had made one engine host, and its teardown then killed all 3. The same job's cleanup on
 * another branch, a minute apart, listed three MSBuild worker nodes still running after the build that started them
 * (run 41346117267); this run's listed none. Worker nodes record the MSBuild process that started them, which exits
 * when the build ends, so its id is free for the next process: that is the shape this rule refuses. The log never
 * named what was counted, which is why {@link describeChildren} exists.
 *
 * ## Shape
 *
 * {@link childrenAmong} and {@link descendantsAmong} are pure, over a listing anyone can write down, so the rule runs and
 * is proven on every platform (`childProcesses.proof.mjs`). {@link listProcesses} is the Windows read.
 */

import { spawnSync } from 'node:child_process';

/**
 * One process as the listing reads it.
 *
 * @typedef {object} ListedProcess
 * @property {number} pid
 * @property {number} parent the id its creator had when it was made, which may since belong to another process
 * @property {bigint | null} created creation time in 100 ns ticks since 1601 (UTC), or `null` where it could not be read
 * @property {string} name
 * @property {string | null} [commandLine]
 * @property {string | null} [executablePath]
 * @property {number} [privateBytes] `PrivatePageCount`, the process's private commit in bytes
 */

/**
 * The processes among `listing` that are `pid`'s children, and the ones that only name it as a recorded parent.
 *
 * A process whose creation time could not be read is not counted: nothing shows it was made after `pid`. When `pid`
 * itself is not in the listing (it has ended), nothing is its child, because nothing can be shown to be younger.
 *
 * @param {number} pid
 * @param {readonly ListedProcess[]} listing
 * @returns {{ children: ListedProcess[], olderThanParent: ListedProcess[], parentListed: boolean }}
 */
export function childrenAmong(pid, listing) {
  const self = listing.find((each) => each.pid === pid);
  const claimants = listing.filter((each) => each.parent === pid && each.pid !== pid);
  if (self === undefined || self.created === null) return { children: [], olderThanParent: claimants, parentListed: self !== undefined };
  const since = self.created;
  /** @type {ListedProcess[]} */
  const children = [];
  /** @type {ListedProcess[]} */
  const olderThanParent = [];
  for (const each of claimants) (each.created !== null && each.created >= since ? children : olderThanParent).push(each);
  return { children, olderThanParent, parentListed: true };
}

/**
 * `root` and every process below it, each edge decided by {@link childrenAmong}'s rule.
 *
 * @param {number} root
 * @param {readonly ListedProcess[]} listing
 * @returns {Set<number>}
 */
export function descendantsAmong(root, listing) {
  const below = new Set([root]);
  const queue = [root];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of childrenAmong(next, listing).children) {
      if (below.has(child.pid)) continue;
      below.add(child.pid);
      queue.push(child.pid);
    }
  }
  return below;
}

/**
 * The PowerShell that lists processes as JSON, with each creation time as a decimal string of ticks: a FILETIME is past
 * 2^53, which a JSON number cannot carry exactly. `$PID` is reported so the asking PowerShell, itself a child of the
 * caller, can be left out by identity rather than by image name.
 *
 * @param {string | null} filter a WQL condition, or `null` for every process
 */
function listingScript(filter) {
  const select = filter === null ? 'Get-CimInstance Win32_Process' : `Get-CimInstance Win32_Process -Filter "${filter}"`;
  return (
    `$list = @(${select} | ForEach-Object { [ordered]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; ` +
    `created = $(if ($null -eq $_.CreationDate) { $null } else { [string]$_.CreationDate.ToFileTimeUtc() }); ` +
    `name = [string]$_.Name; commandLine = $_.CommandLine; executablePath = $_.ExecutablePath; ` +
    `privateBytes = [string]$_.PrivatePageCount } }); ` +
    `ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ asker = $PID; processes = $list })`
  );
}

/**
 * Parses {@link listingScript}'s answer. An answer that does not hold the expected shape throws: an empty listing
 * would read as "no children", which is the reassuring answer (CLAUDE.md audit item 4b).
 *
 * @param {string} text
 * @returns {{ asker: number, processes: ListedProcess[] }}
 */
export function parseListing(text) {
  /** @type {unknown} */
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('asker' in parsed) || !('processes' in parsed) || !Array.isArray(parsed.processes)) {
    throw new Error(`the process listing did not have its shape: ${text.slice(0, 200)}`);
  }
  const asker = Number(parsed.asker);
  const processes = parsed.processes.map((/** @type {Record<string, unknown>} */ each) => ({
    pid: Number(each['pid']),
    parent: Number(each['parent']),
    created: typeof each['created'] === 'string' && /^\d+$/u.test(each['created']) ? BigInt(each['created']) : null,
    name: String(each['name'] ?? ''),
    commandLine: typeof each['commandLine'] === 'string' ? each['commandLine'] : null,
    executablePath: typeof each['executablePath'] === 'string' ? each['executablePath'] : null,
    privateBytes: Number(each['privateBytes'] ?? 0),
  }));
  return { asker, processes };
}

/**
 * The running processes, read once through `Win32_Process`, less the PowerShell that read them.
 *
 * @param {{ filter?: string | null, timeoutMs?: number }} [options]
 * @returns {ListedProcess[]}
 */
export function listProcesses(options = {}) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', listingScript(options.filter ?? null)], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 20_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw new Error('could not list the running processes', { cause: result.error });
  if (result.status !== 0) throw new Error(`listing the running processes exited ${String(result.status)}: ${`${result.stderr}`.trim()}`);
  const { asker, processes } = parseListing(`${result.stdout}`);
  return processes.filter((each) => each.pid !== asker);
}

/**
 * `pid`'s children as they are now, with the processes that only record `pid` as their parent. The listing is narrowed
 * to `pid` and the processes naming it, which is everything the rule reads.
 *
 * @param {number} [pid]
 */
export function childProcesses(pid = process.pid) {
  const listing = listProcesses({ filter: `ProcessId=${String(pid)} OR ParentProcessId=${String(pid)}` });
  const answer = childrenAmong(pid, listing);
  if (pid === process.pid && !answer.parentListed) {
    // The asking process is running, so a listing without it is a broken read, never "no children".
    throw new Error(`the process listing did not contain this process (${String(pid)}), so it cannot say which are its children`);
  }
  return answer;
}

/**
 * The ids of `pid`'s children.
 *
 * @param {number} [pid]
 * @returns {number[]}
 */
export function childProcessIds(pid = process.pid) {
  return childProcesses(pid).children.map((each) => each.pid);
}

/**
 * `root` and every process below it as `listing` shows them, each edge decided by {@link childrenAmong}'s rule: the
 * processes {@link endProcesses} is to end. Read it while `root` is running — once `root` has ended nothing can be shown
 * to be its child, so its children are out of reach, which is why a caller reads the tree BEFORE anything may end it.
 *
 * @param {number} root
 * @param {readonly ListedProcess[]} listing
 * @returns {ListedProcess[]}
 */
export function treeOf(root, listing) {
  const below = descendantsAmong(root, listing);
  return listing.filter((each) => below.has(each.pid));
}

/**
 * Which of `targets` are still running in `listing`. A process is the same one only when its id AND its creation time
 * match: an id Windows has given to a new process since is not a target that survived.
 *
 * @param {readonly ListedProcess[]} targets
 * @param {readonly ListedProcess[]} listing
 * @returns {ListedProcess[]}
 */
export function stillRunning(targets, listing) {
  return targets.filter((target) => target.created !== null && listing.some((each) => each.pid === target.pid && each.created === target.created));
}

/**
 * Ends each of `targets` that is still running, and waits until none is, or `timeoutMs` passes.
 *
 * ## Each process by its own id, never `taskkill /T`
 *
 * Ending a process ends that process: Windows does not end its children with it. A walk that ended the one process
 * Playwright launched left the application's own five processes running, and the walk waited on them for an hour and 41
 * minutes (2026-11-12). `taskkill /T` follows the recorded parent id, which {@link childrenAmong} exists because Windows
 * reuses — so it can end a stranger. So the tree is read by the rule, and each member is ended by id.
 *
 * Termination is requested, not finished, when the call returns, so this re-reads until the targets are gone. What is
 * left is RETURNED, never thrown, and never claimed ended: the caller says what happened.
 *
 * @param {readonly ListedProcess[]} targets
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ended: ListedProcess[], left: ListedProcess[] }>}
 */
export async function endProcesses(targets, options = {}) {
  const running = stillRunning(targets, listProcesses());
  for (const each of running) {
    try {
      process.kill(each.pid);
    } catch (error) {
      // ESRCH: it ended between the listing and this call, which is the state this wanted. Anything else is reported.
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  }
  const until = Date.now() + (options.timeoutMs ?? 10_000);
  let left = running.length === 0 ? [] : stillRunning(running, listProcesses());
  while (left.length > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    left = stillRunning(left, listProcesses());
  }
  return { ended: running.filter((each) => !left.includes(each)), left };
}

/**
 * Ends `root` and every process below it ({@link treeOf}, then {@link endProcesses}). `root` must still be running.
 *
 * @param {number} root
 * @param {{ timeoutMs?: number }} [options]
 */
export function endTree(root, options = {}) {
  return endProcesses(treeOf(root, listProcesses()), options);
}

/**
 * What a child count was made of, for a failure message: each child, and each process left out as older than `pid`.
 *
 * @param {number} [pid]
 */
export function describeChildren(pid = process.pid) {
  const { children, olderThanParent } = childProcesses(pid);
  /** @param {ListedProcess} each */
  const shown = (each) => `${String(each.pid)} ${each.name} (created ${each.created === null ? 'unreadable' : String(each.created)})`;
  return (
    `children of ${String(pid)}: ${children.length === 0 ? 'none' : children.map(shown).join(', ')}; ` +
    `left out as older than it: ${olderThanParent.length === 0 ? 'none' : olderThanParent.map(shown).join(', ')}`
  );
}
