import { z } from 'zod';

import { channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';

/**
 * Every IPC channel, defined once.
 *
 * A channel is added here only when a real handler for it exists. The wired
 * rule (Part H) applies as much to the contract as to the UI: a declared
 * channel with nothing behind it is a call that hangs, which is worse than a
 * call that is absent. The `Handlers` mapped type enforces this mechanically —
 * adding an entry here breaks the build until something implements it.
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
