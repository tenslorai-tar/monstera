import { z } from 'zod';

import { channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';
import { commandSchema } from './commands.js';
import { docIdSchema, docVersionSchema } from './schemas.js';

/**
 * Every IPC channel, defined once.
 *
 * A channel is added here only when a real handler for it exists. The wired
 * rule (Part H) applies as much to the contract as to the UI: a declared
 * channel with nothing behind it is a call that hangs, which is worse than a
 * call that is absent. The `Handlers` mapped type enforces this mechanically —
 * adding an entry here breaks the build until something implements it.
 *
 * **Invariant L11 applies to every entry below, and is not yet mechanically
 * checked.** No channel's payload may scale with document size *per operation*;
 * the single sanctioned byte crossing is a snapshot, once per **version**. The
 * check was deliberately not written at Stage 0: with one channel carrying a
 * version string it would have inspected nothing, passed, and stayed green
 * while the channels that make L11 bite were added. It is a Stage 1 gate, owed
 * as the first document-carrying channel lands — which is this file, so whoever
 * writes that channel is the person who owes it.
 */
export const channels = {
  'app.info': channel(
    'Version and install channel of the running application.',
    z.object({}),
    z.object({
      version: z.string().min(1),
      /**
       * Baked at build time (E4). Exactly one update provider is active, and
       * the Store build must never self-update, so this is a property of the
       * artifact rather than something detected at runtime.
       */
      installChannel: z.enum(['store', 'web', 'development']),
    }),
  ),

  /**
   * Applies one command to an open document.
   *
   * **This is not a document-carrying channel**, and saying so is the L11 note
   * above being answered rather than skipped. What crosses is *intent*:
   * `{ pages, quarterTurns }` is the same size for a 2-page document and a
   * 20,000-page one, and the array scales with what the user selected, never
   * with the document. The gate the note owes is still owed, by the first
   * channel that carries bytes.
   *
   * **The result is the version and nothing else.** A log entry holds an inverse
   * or a checkpoint — a whole byte image of the document — so returning what the
   * bus produced would put the document on the wire once per operation, which is
   * exactly what L11 forbids. The version is what the renderer needs to know its
   * view is stale.
   *
   * Both failure codes are **outcomes, not defects**. A document closes while a
   * command is in flight (`document-not-open`) and a runaway caller saturates a
   * lane (`document-busy`); the renderer's answer is to drop the result or to
   * back off, neither of which is an error report. Everything else a command can
   * do wrong — an out-of-range page index, an unregistered writer, an engine
   * throw — is a defect, and defects are `internal` with the diagnostic recorded
   * main-side.
   */
  'document.execute': channel(
    'Applies one command to an open document, returning the version it produced.',
    z.object({ docId: docIdSchema, command: commandSchema }),
    z.object({ version: docVersionSchema }),
    ['document-not-open', 'document-busy'],
  ),
} as const;

export type Channels = typeof channels;
export type ChannelId = keyof Channels;

export type ChannelParams<K extends ChannelId> = ParamsOf<Channels, K>;
export type ChannelResult<K extends ChannelId> = ResultOf<Channels, K>;

/** The main-process side. Exhaustive: omitting a channel is a compile error. */
export type ContractHandlers = Handlers<Channels>;

/** The renderer side, and the shape the browser shim must implement in full. */
export type ContractClient = ClientApi<Channels>;

/** Channel ids as a runtime array, for iterating registrations. */
export const channelIds = Object.keys(channels) as readonly ChannelId[];
