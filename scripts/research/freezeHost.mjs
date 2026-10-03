// @ts-check
/**
 * Suspends every thread of a process: a harness's fault injection, never the product's. `NtSuspendProcess` is what a
 * debugger's break does.
 *
 * Two children use it, for the same purpose: to hold a document's call ON THE WIRE. A frozen host reads nothing and
 * answers nothing, so a call sent to it stays the one call main has sent and not had answered — which is what a host
 * looping inside a document looks like (`hostDeadlineHost.mjs`), and what a host crashing inside one looks like once
 * the harness then kills it (`hostRecoveryHost.mjs`). An ending counts against the document whose call the host was
 * running (ADR-0023's correction of 2026-10-03), so a kill with no call held this way would count against nobody.
 *
 * Shared rather than copied: two copies of a fault are two opinions about what the fault is.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

/** @param {number} pid the host's process id */
export function freezeHost(pid) {
  const koffi = createRequire(join(repoRoot(), 'package.json'))('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const ntdll = koffi.load('ntdll.dll');
  const openProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const suspend = ntdll.func('int32 NtSuspendProcess(void *process)');
  const closeHandle = kernel32.func('bool CloseHandle(void *handle)');
  const PROCESS_SUSPEND_RESUME = 0x0800;
  const handle = openProcess(PROCESS_SUSPEND_RESUME, false, pid);
  if (koffi.address(handle) === 0n) throw new Error(`OpenProcess refused the host ${String(pid)}`);
  const status = suspend(handle);
  closeHandle(handle);
  if (status !== 0) throw new Error(`NtSuspendProcess answered 0x${(status >>> 0).toString(16)}`);
}
