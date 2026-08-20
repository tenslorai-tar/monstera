import {
  type ContractHandlers,
  type IncidentSink,
  channelIds,
  channels,
  wrapHandlers,
} from '@monstera/contract';

/**
 * The part of `ipcMain` this needs, and nothing else.
 *
 * Declared structurally rather than imported from Electron so the registration
 * can be exercised with a recording double, in a test that runs in milliseconds
 * and needs no window. Electron's own `ipcMain` satisfies it.
 */
export interface IpcHandleTarget {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
}

/**
 * Registers every declared channel with the IPC layer, exactly once.
 *
 * ## Derived from the registry, so a channel cannot be forgotten
 *
 * It iterates `channelIds` rather than naming channels here. A hand-written list
 * of `ipcMain.handle` calls is the second place a channel gets written down, and
 * the failure it produces is silent in the worst way: the build is green, the
 * type says the handler exists, and the call hangs forever because nothing is
 * listening. `channels.ts` names that outcome as worse than an absent call, and
 * this is the half of finding CC-2 that makes the handler reachable.
 *
 * ## One `IncidentLog` for the boundary
 *
 * `wrapHandlers` builds it, so incident ids are unique across the whole registry
 * and a renderer reporting `i7` identifies one line rather than one per channel.
 * Everything a handler throws is recorded here — where the path is already known
 * and discloses nothing — and the renderer gets `internal` plus the id.
 *
 * ## What the listener does NOT do
 *
 * It does not inspect the event. That is deliberate and it is **not** finished:
 * `ipcMain.handle` accepts a call from any frame in any renderer, so a sender
 * check belongs here the moment more than one window or any remote content
 * exists. Today the shell has neither, and the hardening that keeps it that way
 * — navigation locked, popups denied, `sandbox: true` — lives with the window.
 * Stated rather than implied, because a sender check added later has to be added
 * to a loop that already looks finished.
 *
 * @param target `ipcMain`, or a double in a test
 * @param handlers the assembled main-process side
 * @param sink receives every diagnostic that did not cross
 */
export function registerContractHandlers(
  target: IpcHandleTarget,
  handlers: ContractHandlers,
  sink: IncidentSink,
): void {
  const wrapped = wrapHandlers(channels, handlers, sink);

  for (const id of channelIds) {
    // `args[0]`, and the params are NOT trusted here. `wrapHandler` parses them
    // against the channel's schema before the handler sees them, which is the
    // one place validation happens (C5). Casting or defaulting the value here
    // would be a second opinion about a shape the boundary already owns.
    target.handle(id, (_event, ...args) => wrapped[id](args[0]));
  }
}
