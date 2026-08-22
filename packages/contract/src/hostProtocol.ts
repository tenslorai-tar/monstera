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
