import { commandSchema, channel } from '@monstera/contract';
import { z } from 'zod';

/**
 * The engine host's channels (ADR-0023 Decision 11).
 *
 * ## Why these are declared HERE and not in `packages/contract`
 *
 * `engine/capture` **answers with prior state**, and
 * `packages/contract/src/commands.ts` states in its own header why a schema for
 * that cannot live beside the renderer's channels: *"Inverses are deliberately
 * absent from this file. They stay kernel-only: they carry structural prior
 * state the renderer must not see, and a renderer-supplied inverse would let the
 * UI dictate undo."* `packages/ui` imports `packages/contract`; it may not
 * import this package, and that is a red build rather than a convention.
 *
 * So the *discipline* is shared and the *declaration* sits where its schemas may
 * live — `channel()` from the contract package, one declaration, validated in
 * the same `wrapHandler` everything else goes through.
 * `ARCHITECTURE.md` §5 carries the amendment.
 *
 * ## The session is a STRING here, and that is 10b
 *
 * The host mints and owns session identity; main holds an opaque handle it
 * cannot dereference. A branded `MupdfSession` never crosses — it could not,
 * being a token whose meaning is membership of an adapter's `WeakMap` in one
 * process. What crosses is the id that adapter recorded beside it.
 *
 * ## What is NOT here
 *
 * `open`, `serialise` and `close`. Those exchange **files** in the two handed
 * directories rather than payloads (Decision 7's verb split, measured), so they
 * need the handed-directory plumbing and are their own unit. Splitting there is
 * Decision 10's own line: execution is one half, session lifecycle is the other.
 */

/** How long a session handle may be. Bounded for the reason a correlation id is:
 * an unbounded id is a peer deciding how many bytes of our frame it spends. */
export const ENGINE_SESSION_ID_MAX_CHARS = 64;

const sessionSchema = z.string().min(1).max(ENGINE_SESSION_ID_MAX_CHARS);

/**
 * One page's prior `/Rotate`, verbatim (ADR-0009 §3).
 *
 * `present: false` is a page that **inherited**, and its inverse is a delete
 * rather than a write — which is why absence is a case in the union rather than
 * a sentinel value. `raw` is the number as MuPDF stored it, unnormalised: §3
 * requires prior state restored verbatim, and a page carrying `45` is restored
 * to `45`.
 */
const priorRotationSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z.object({ present: z.literal(true), raw: z.number() }).strict(),
]);

const priorPageRotationSchema = z
  .object({ page: z.number().int().nonnegative(), prior: priorRotationSchema })
  .strict();

/**
 * Prior state, tagged by the command kind it belongs to.
 *
 * The tag is not redundant with the request's own `command.kind`. A response is
 * validated on its own terms — the correlation id says which call it answers,
 * and nothing else about the request is in scope at the point the body is
 * parsed. A kernel that narrowed by the kind it *sent* would be trusting the
 * peer to have answered the question it was asked.
 */
const capturedPriorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('rotatePages'),
      // `.readonly()` so the inferred wire type IS `CommandPrior['rotatePages']`
      // rather than a mutable neighbour of it. Without it the two differ only in
      // mutability, and every crossing needs a cast that reads as a formality
      // while being the only thing standing between them.
      prior: z.array(priorPageRotationSchema).readonly(),
    })
    .strict(),
]);

/**
 * What a capture answers.
 *
 * `captured: false` is an **outcome, not a failure** (ADR-0009's 2026-08-19
 * decision): the bus answers it by taking a checkpoint and applying anyway. So
 * it travels in the result rather than in a failure code, and a `reason` is
 * required — a refusal nobody can explain is one nobody can act on.
 *
 * **It is also the ordinary outcome at scale, measured 2026-08-26** (ADR-0023,
 * Decision 10's correction): a select-all `rotatePages` inverse on this
 * project's stated 20,000-page extreme weighs 809,018 bytes absent and 969,018
 * present — three to four times the whole frame. So this branch is a live path,
 * not a defensive one.
 */
const captureResultSchema = z.discriminatedUnion('captured', [
  z.object({ captured: z.literal(true), value: capturedPriorSchema }).strict(),
  z.object({ captured: z.literal(false), reason: z.string().min(1) }).strict(),
]);

/**
 * The inverse travelling back to be applied.
 *
 * Carries its `kind` and nothing of the command, which is §3's rule in the
 * schema: an inverse that could see the intent could be computed *from* the
 * intent — rotate back by the same quarter turns — and that is the one
 * implementation §3 forbids, because a page that inherited its rotation is
 * restored by deleting the key and no amount of rotating backwards reaches that
 * state.
 */
const inverseSchema = capturedPriorSchema;

export const engineChannels = {
  'engine/apply': channel(
    'Applies one command to a session this host holds.',
    z.object({ session: sessionSchema, command: commandSchema }).strict(),
    z.object({}).strict(),
    ['no-such-session'],
  ),

  'engine/capture': channel(
    'Reads prior state for one command, before it is applied.',
    z.object({ session: sessionSchema, command: commandSchema }).strict(),
    captureResultSchema,
    ['no-such-session'],
  ),

  'engine/invert': channel(
    'Restores prior state recorded by an earlier capture.',
    z.object({ session: sessionSchema, inverse: inverseSchema }).strict(),
    z.object({}).strict(),
    ['no-such-session'],
  ),
} as const;

export type EngineChannels = typeof engineChannels;

/**
 * The one declared failure: a session id this host does not hold.
 *
 * **An outcome rather than a defect**, and named rather than left to `internal`,
 * because it is reachable without anything being wrong: a host dies, main
 * rebuilds it, and a call issued against the old session arrives at the new
 * process. The supervisor's answer to that is a rebuild, which it cannot decide
 * from an opaque `internal`.
 */
export type EngineFailureCode = 'no-such-session';
