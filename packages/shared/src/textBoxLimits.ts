/**
 * The bounds of a text box's style (ADR-0211): the line pitch it may be set to, as a multiple of its size, and the margin it
 * may keep, in points.
 *
 * HERE, in the package that imports nothing, because two readers need them and one of them may not load the other's package:
 * the contract's schema refuses a value outside them, and the kernel's layout clamps to them — and the kernel runs inside the
 * engine host, which loads `@monstera/contract/host` and never the contract's root (`hostLoad.proof`). The kernel's first
 * version imported the root for these four numbers and put every host over its memory budget; one definition here is read by
 * both (B3a).
 */
export const MIN_TEXT_LINE_HEIGHT = 0.8;
/** The pitch a box has until it is changed; a style that names it is not written. */
export const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
export const MAX_TEXT_LINE_HEIGHT = 3;
export const MAX_TEXT_PADDING = 72;
