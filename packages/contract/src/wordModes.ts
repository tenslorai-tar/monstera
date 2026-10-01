/**
 * The Word export's modes (ADR-0072): `text` is the words only, `layout` keeps each line and picture at its box,
 * `rich` reflows with fonts and carries pictures inline.
 *
 * **One list for three processes** — the renderer asks for a mode, `main` passes it on, and the MuPDF host composes
 * it — so a mode none of them agree on cannot be spelt. Its own module because the host takes contract values only
 * through `host.ts`, which leaves the renderer's channel map out.
 */
export const WORD_MODES = ['text', 'layout', 'rich'] as const;

/** One of {@link WORD_MODES}. */
export type WordMode = (typeof WORD_MODES)[number];
