import type { ClientApi } from '@monstera/contract';

import type { RegisteredWriter } from '../commandSpecs.js';
import type { EngineChannels } from './engineChannels.js';
import { remoteMupdfExecution } from './remoteEngine.js';
import type { RemoteSessions } from './remoteEngine.js';
import {
  type RemoteMupdfLifecycle,
  type SessionAreaSurface,
  remoteMupdfLifecycle,
} from './remoteLifecycle.js';

/**
 * The MuPDF writer assembled for a process that does NOT hold the session —
 * `localEngine.ts`'s sibling, and the object `main` registers on the bus.
 *
 * ## Why this is a third file, for the same structural reason `localEngine.ts` is
 *
 * The two halves cannot be assembled where either of them lives.
 * `remoteEngine.ts` runs a command against a session that exists;
 * `remoteLifecycle.ts` produces that session's bytes and ends it; and
 * `RegisteredWriter` is declared in `commandSpecs.ts`, which is the routing
 * table. Naming the intersection inside either half would put the routing
 * table upstream of a module that has no business knowing about routing.
 *
 * ## The word REMOTE is the whole distinction, and it is Decision 10's
 *
 * Not "the real one" and not "the default". `localMupdfWriter` runs a command
 * against a session in **this** process and is what the host body registers;
 * this one sends the command to the process that holds one. Both are real, and
 * which is correct depends only on where the session is.
 *
 * ## What it does NOT carry, and why that is the point
 *
 * No `open` and no `close`. A registered writer supplies `serialise` plus the
 * command members
 * ([ADR-0030](../../../../docs/DECISIONS/0030-a-remote-writer-does-not-open-from-an-image.md)
 * Decision 1), because those are what `CommandBus` calls. A session comes into
 * existence through the supervisor, in the process that can create a contained
 * host, and ends the same way — so the lifecycle object stays in the
 * supervisor's hands rather than being spread onto the bus's registration.
 *
 * That is why this takes the same `client` and `sessions` the caller keeps: the
 * token this writer runs commands against is the one the supervisor adopted,
 * and there is exactly one registry (B3).
 *
 * @param client the engine host's channels, through the contract's own
 *   validating client
 * @param sessions main's token registry — the same instance the supervisor
 *   adopts into, or every call is `UnknownRemoteSession`
 * @param areas how a session's granted directories are reached and removed
 */
/**
 * What this root gets back: a writer the bus can route to, plus the one
 * function that ends a session.
 *
 * Named rather than written inline at each site, because the intersection is
 * the statement — routing and lifetime are two different jobs and this is the
 * one object that holds both.
 */
export type RemoteMupdfWriter = RegisteredWriter<'mupdf'> &
  Pick<RemoteMupdfLifecycle, 'close' | 'extract'>;

export function remoteMupdfWriter(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
  areas: SessionAreaSurface,
): RemoteMupdfWriter {
  // `close` USED TO BE DROPPED HERE, and that was the whole of the leak. This
  // line destructured `serialise` alone, so the one function that ends a
  // session on the host and removes its granted directory pair had no caller
  // anywhere — and a pair therefore outlived the document that created it,
  // leaving a readable copy of the user's document where the contained host
  // could reach it until the next launch's sweep.
  //
  // Widening the return rather than putting `close` on `RegisteredWriter`: the
  // registry's type is a statement about ROUTING — which writer runs a command —
  // and a session's lifetime is not a routing question. The composition root
  // takes it from here and registers it as the document's teardown.
  // `extract` JOINS THEM for the reason the comment above gives about `close`,
  // arriving at the same conclusion from the other direction: it is neither
  // routing nor lifetime, it is a THIRD job — producing a second document's
  // bytes — and it is here because it needs the same `client`, `sessions` and
  // granted `areas` the other two do. Widening this return is what keeps those
  // three in one place; a separate factory would need the area surface again,
  // and the granted directory reachable from two places is the one thing the
  // pair-leak comment above was about.
  const { serialise, close, extract } = remoteMupdfLifecycle(client, sessions, areas);
  return { serialise, close, extract, ...remoteMupdfExecution(client, sessions) };
}
