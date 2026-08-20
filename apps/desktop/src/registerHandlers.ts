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
 * Decides whether an IPC event came from the frame this shell created.
 *
 * Structural, like `IpcHandleTarget`, so the refusal path is exercised with a
 * plain object rather than a running window.
 */
export type IpcSenderCheck = (event: unknown) => boolean;

/**
 * Thrown when a channel is invoked by a sender the shell did not create.
 *
 * **It carries no incident id, and that is deliberate.** `IncidentLog.record` is
 * documented as the only place a thrown value becomes an id, so minting one here
 * would be a second opinion about a question the boundary already owns — and two
 * counters mean two `i1`s, which is precisely the ambiguity the single log
 * exists to prevent.
 *
 * There is also nothing to withhold. An incident id exists so a diagnostic can
 * be recorded where the path is already known while the renderer gets an opaque
 * reference. A refusal generates no diagnostic: the message is fixed, names no
 * path, and says only that the sender was not the one this shell created.
 */
export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`refused: ${channel} was invoked by a sender this shell did not create`);
    this.name = 'UntrustedSenderError';
  }
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
 * ## The sender check, which this used to only describe
 *
 * `ipcMain.handle` accepts a call from **any frame in any renderer**, so a
 * channel with no sender check is reachable by anything that gets script into
 * the process. The previous version of this comment said so, called itself "not
 * finished", and explained that the hardening keeping the shell single-window
 * lives elsewhere.
 *
 * That note was right about the trap and wrong to leave it open: it warned that
 * "a sender check added later has to be added to a loop that already looks
 * finished", which is an argument for adding it *before* the loop looks
 * finished, not for writing the warning down. It lands with the window that
 * creates the only legitimate sender, because that is the first commit in which
 * the check has something true to compare against.
 *
 * **`senderCheck` is required, not optional.** An optional one defaults to
 * trusting everything, and a default that matters is what nobody revisits (B5).
 * A refusal throws `UntrustedSenderError` and the handler never runs — the
 * arguments are not parsed, so an untrusted sender cannot reach the schema layer
 * either.
 *
 * @param target `ipcMain`, or a double in a test
 * @param handlers the assembled main-process side
 * @param sink receives every diagnostic that did not cross
 * @param senderCheck decides whether an event came from the shell's own frame
 */
export function registerContractHandlers(
  target: IpcHandleTarget,
  handlers: ContractHandlers,
  sink: IncidentSink,
  senderCheck: IpcSenderCheck,
): void {
  const wrapped = wrapHandlers(channels, handlers, sink);

  for (const id of channelIds) {
    // `args[0]`, and the params are NOT trusted here. `wrapHandler` parses them
    // against the channel's schema before the handler sees them, which is the
    // one place validation happens (C5). Casting or defaulting the value here
    // would be a second opinion about a shape the boundary already owns.
    //
    // The sender is checked BEFORE the wrapped call, so a refused event reaches
    // neither the handler nor the parse.
    target.handle(id, (event, ...args) => {
      if (!senderCheck(event)) throw new UntrustedSenderError(id);
      return wrapped[id](args[0]);
    });
  }
}
