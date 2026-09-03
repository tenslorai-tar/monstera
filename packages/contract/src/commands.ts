import { z } from 'zod';

/**
 * Every mutation the renderer can ask for, declared **once** (ADR-0009 §6).
 *
 * A zod discriminated union with the TypeScript type inferred from it, so the
 * wire schema and the type cannot drift — there is no second declaration to
 * forget to update.
 *
 * Commands are **intent**, not payload. `deletePages([3, 5])` is the same size
 * whether the document is 2 pages or 20,000 (invariant L11); any design where
 * the bytes crossing scale with document size per operation is wrong.
 *
 * **Inverses are deliberately absent from this file.** They stay kernel-only:
 * they carry structural prior state the renderer must not see, and a
 * renderer-supplied inverse would let the UI dictate undo (§6).
 */

/**
 * Rotate pages by a quarter turn multiple.
 *
 * `quarterTurns` rather than degrees, and the reason is a measured engine
 * behaviour rather than taste: **MuPDF stores `/Rotate 45` verbatim**, so a
 * degrees-typed command lets an arbitrary angle reach the page tree, where the
 * PDF specification permits only multiples of 90. The kernel normalises before
 * writing; making the wire type incapable of carrying 45 means it never has to
 * reject one.
 *
 * The *inverse* is a different matter and is not constrained to quarter turns —
 * §3 requires prior state restored **verbatim**, so a page that arrived
 * carrying a raw `45` must come back carrying `45`, not a tidied `0`.
 */
export const rotatePagesSchema = z.object({
  kind: z.literal('rotatePages'),
  /** Zero-based page indices. */
  pages: z.array(z.number().int().nonnegative()).min(1),
  /** Clockwise quarter turns. 0 is not a command; it is a no-op with a log entry. */
  quarterTurns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * The command union.
 *
 * Adding a kind here is what makes the routing table below incomplete, which is
 * a compile error — see `commandSpecs.ts`. That is the mechanism: a new command
 * cannot be added without routing it and without declaring both of §3a's axes.
 */
/**
 * Show or hide one optional-content group.
 *
 * ## A COMMAND, not a view setting, and the distinction is where it is stored
 *
 * A layer's visibility lives in the document — `/OCProperties`' default
 * configuration — so turning one off and saving produces a file that opens with
 * it off, in every other reader. That makes it a mutation, and a mutation goes
 * through the bus with a capture and an inverse like every other one. A toggle
 * held in renderer state would render correctly and vanish on save, which is
 * the wired-tools rule's own example of a control that does not survive.
 *
 * ## The layer is named by INDEX, which is its position in `/OCGs`
 *
 * Naming a layer by its title instead would need a second opinion about which
 * layer a title means — two layers may share one — and would put this build in
 * the business of resolving that.
 *
 * **The index is NOT MuPDF's layer index**, and the difference is measured
 * rather than notional: a document listing *Visible* then *Hidden* in `/OCGs`
 * is reported by `countLayers`/`getLayerName` with Hidden at 0
 * (`layers.test.ts`, 2026-09-03). This said the opposite until the same day's
 * round-trip case showed that MuPDF's layer API writes session state a save
 * does not carry, so the whole command moved to the object tree — see
 * `layers.ts`, which is the one place either enumeration is read.
 */
export const setLayerVisibilitySchema = z.object({
  kind: z.literal('setLayerVisibility'),
  /** The layer's position in `/OCProperties/OCGs`. */
  layer: z.number().int().nonnegative(),
  /** What it becomes. The inverse carries what it was. */
  visible: z.boolean(),
});

export const commandSchema = z.discriminatedUnion('kind', [
  rotatePagesSchema,
  setLayerVisibilitySchema,
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandKind = Command['kind'];

/** Narrows the union to one member, for a spec's `apply` signature. */
export type CommandOfKind<K extends CommandKind> = Extract<Command, { kind: K }>;
