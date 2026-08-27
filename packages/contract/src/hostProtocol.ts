import { z } from 'zod';

/**
 * What the engine-host pipe carries, and how large one frame may be
 * (ADR-0023 §7).
 *
 * Separate from `frame.ts` deliberately. That module is a codec and takes its
 * maximum as a required argument; this is the **policy** that supplies one for
 * this protocol. Putting the number in the codec would make it a default in
 * everything but name, and the worker protocol will want the same codec with a
 * different answer.
 *
 * ## Intent and handles cross. Document images do not.
 *
 * Not a preference — it follows from a budget this repository enforces on every
 * push. §9.17 caps main at **1.5× file size**; main already holds the canonical
 * image at 1.00×, so serialising a second full copy into a pipe write puts it
 * at 2.00×, which is exactly what `perf:gate` reports for two resident images
 * and fails on both content shapes.
 *
 * An image reaches the host through a **handed path** instead. How, precisely,
 * is mechanism ADR-0023 §7 leaves to a measurement; the candidate to test first
 * is main writing its canonical image to a handed path once per version, which
 * keeps main the single source of truth and stops the host ever opening the
 * user's original.
 *
 * ## Why widening this is a decision and not an edit
 *
 * Three of the four writers of record consume and produce whole byte images, so
 * someone will eventually argue that images must cross after all. ADR-0023 §7
 * refuses that in advance: whether those JavaScript writers run in the engine
 * host at all is undecided, and invariant 25's argument is about **native**
 * memory-safety bugs. A byte-image writer running in main needs no crossing.
 *
 * So this constant is not to be raised to accommodate a payload. Raising it is
 * an ADR-0023 amendment, because the number is the only thing standing between
 * "intent crosses" and "whatever fits crosses".
 */

/**
 * The largest command payload this protocol has to carry, in bytes — the thing
 * the maximum below is derived FROM rather than a second opinion about it.
 *
 * **Measured, not calculated.** The worst legitimate case is a page-index array
 * covering an entire document: select all, then rotate or delete. This
 * project's own stated extreme is a **20,000-page** document (`CLAUDE.md`, on
 * why intent scales with selection and never with file size), and the envelope
 * for one weighs **120,057 bytes** — about 6.00 bytes per page.
 *
 * That per-page figure is the whole reason a command channel is safe to bound
 * in kilobytes: the payload scales with how many pages were *selected*, never
 * with how many megabytes each page weighs. A 20,000-page document may be two
 * gigabytes on disk and its select-all intent is still 120 KB.
 */
export const LARGEST_INTENT_PAYLOAD_BYTES = 120_057;

/**
 * The frame maximum for the engine-host pipe.
 *
 * 256 KiB — **2.18×** {@link LARGEST_INTENT_PAYLOAD_BYTES}, which is headroom
 * for the envelope, the channel id and a schema that grows, and still three
 * orders of magnitude below the smallest document image §9.17's budget cares
 * about. A frame this size cannot be a document by accident.
 *
 * The headroom is deliberately small. A generous maximum is one that quietly
 * accommodates the payload nobody decided to send.
 *
 * ## Where it binds, stated rather than discovered
 *
 * At 6.00 bytes per page this refuses a whole-document selection at about
 * **43,600 pages** — 2.2× the stated extreme, and a real number rather than an
 * open-ended promise. Measuring the derivation is what surfaced this; the
 * estimate it replaced did not.
 *
 * ## The bound is an ENCODING artefact, and that is the first thing to fix
 *
 * Finding AAA-1. The 6.00 bytes per page is what it costs to write a page set
 * as an explicit list of decimal indices. A page set has cheaper
 * representations, and the flat one removes the bound rather than moving it:
 *
 * | encoding | 20,000 pages | 43,600 pages | worst case |
 * | --- | --- | --- | --- |
 * | index list (today) | 120,057 B | ~262,000 B | — |
 * | ranges | a few bytes | a few bytes | alternating pages: one range each |
 * | bitmap | 2,500 B | 5,450 B | flat, whatever the selection |
 *
 * A bitmap is ~48× smaller at the stated extreme and does not degrade on an
 * adversarial selection, which is the property ranges lack. At one bit per page
 * a 256 KiB frame holds a selection over two million pages, so the bound stops
 * existing instead of being renegotiated — and the maximum could then *shrink*,
 * strengthening the property this constant exists to protect rather than
 * spending it.
 *
 * **Arithmetic from the measured 6.00 bytes/page. No bitmap encoding has been
 * measured here**, and changing the payload shape reaches this package's
 * schemas and how every command declares a page selection. That is its own
 * unit, decided when something needs it — not now, when the bound sits 2.2×
 * beyond any document that exists.
 *
 * ## So: payload shape first, chunking second
 *
 * **This constant is not raised either way.** Splitting the intent across
 * frames is the fallback if a set representation cannot be made to work, and it
 * is the expensive one: reassembly, ordering and partial-state handling, added
 * at a boundary whose counterparty is hostile by invariant 25's own premise —
 * the worst place in this system to grow protocol. It also leaves the maximum
 * where it is and adds surface underneath.
 *
 * The rule this follows: **prove the limit has to exist before designing around
 * it.** Removal is the first candidate, not a footnote.
 */
export const ENGINE_HOST_FRAME_MAX_BYTES = 256 * 1024;

/**
 * What one frame carries.
 *
 * ## Why the correlation id is OUTSIDE the result envelope
 *
 * `envelopeSchema(channel.result)` already describes what a call answers, and
 * `createClient` already parses exactly that. Putting a correlation id inside it
 * would give this transport its own opinion about what a result looks like —
 * B3a, and the second opinion is the finding rather than the wrong one. So the
 * wire response is a correlation id **plus** that envelope, unchanged, and the
 * client parses the same object it parses over Electron IPC.
 *
 * The request has no counterpart to reuse, because Electron's own IPC carries
 * the channel name and the renderer never needs to correlate — `invoke` returns
 * a promise the runtime pairs up. A byte stream has neither, so both must be on
 * the wire, and this is where they are declared once for both ends.
 *
 * ## The id is a string, and it is opaque to the host
 *
 * A number invites arithmetic — the next id, a range, a comparison — and none of
 * those is a property this protocol has. The host echoes what it was given and
 * never mints one, so nothing here needs it to be ordered or dense. What the
 * host DOES check is that an id is not already in flight, because two answers
 * for one id is the peer contradicting itself.
 */

/**
 * The largest a correlation id may be.
 *
 * Bounded because it is echoed: an unbounded id is a peer choosing how many
 * bytes of our response it writes, and a frame maximum that can be reached by
 * the id alone is a frame maximum spent on nothing. 64 characters is four times
 * a UUID's hex digits.
 */
export const HOST_CORRELATION_ID_MAX_CHARS = 64;

/**
 * How many calls may be outstanding on one engine host connection.
 *
 * **Declared here because both ends bound the same thing and their two answers
 * must not be able to differ.** `createHostClient` refuses the call locally at
 * this number; `createHostRuntime` in the host treats exceeding it as a
 * violation and ends the connection. If main's figure were the larger of the
 * two, an ordinarily busy main would kill its own host — a limit whose failure
 * mode is a self-inflicted `too-many-in-flight` is exactly the second opinion
 * B3a names, and it would look like a flaky host rather than a mismatch.
 *
 * 32 rather than a rounder number for a reason that is worth stating precisely,
 * since a limit nobody can justify is one somebody later raises: the lane is
 * **per document** and serial (ADR-0009 §7), so the concurrency that reaches a
 * host is bounded by open documents rather than by user actions, and 32 open
 * documents each with a call in flight is well beyond what §9.17's memory
 * budget permits main to hold. It is a backstop against a confused main, not a
 * throughput setting.
 */
export const ENGINE_HOST_MAX_IN_FLIGHT = 32;

/**
 * A request travelling from main to the engine host.
 *
 * `.strict()`, for the same reason `failureSchema` is: an extra field arriving
 * here is either a peer we do not understand or a field someone added on one
 * side only, and both are better refused than ignored. `params` is `unknown` on
 * purpose — the channel's own schema validates it one layer up, in the same
 * `wrapHandler` everything else goes through, and a second parse here would be
 * a second opinion about what a channel accepts.
 *
 * **`params` is required, not optional.** A no-argument channel declares
 * `z.object({})` and its handler is called with `{}`, so an absent field would
 * have to become something before the channel's schema saw it — this layer
 * inventing a value on the peer's behalf, which is the one thing a wire schema
 * must never do. The peer sends the field; what may be in it is not this
 * layer's question.
 */
export const hostRequestSchema = z
  .object({
    id: z.string().min(1).max(HOST_CORRELATION_ID_MAX_CHARS),
    channel: z.string().min(1),
    params: z.unknown(),
  })
  .strict();

/** @see hostRequestSchema */
export type HostRequest = z.infer<typeof hostRequestSchema>;

/**
 * A response travelling from the engine host back to main.
 *
 * `body` is deliberately untyped here and validated by the caller against
 * `envelopeSchema(channel.result)` — the channel decides what its own answer
 * looks like, and this layer does not get a vote.
 */
export const hostResponseSchema = z
  .object({
    id: z.string().min(1).max(HOST_CORRELATION_ID_MAX_CHARS),
    body: z.unknown(),
  })
  .strict();

/** @see hostResponseSchema */
export type HostResponse = z.infer<typeof hostResponseSchema>;
