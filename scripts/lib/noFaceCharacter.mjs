// @ts-check
/**
 * The character an instrument uses when it needs one that NO face Monstera reaches can draw, so an edit or an import
 * holding it must set it as the box: a plane-15 private-use point
 * ([ADR-0270](../../docs/DECISIONS/0270-edit-text-writes-what-the-person-typed-and-never-refuses-it.md)'s correction of
 * 2026-10-25, Decision 2).
 *
 * GNU Unifont, the resolver's last face, draws every point of the Basic Multilingual Plane — unassigned ones included,
 * as their hex digits in a dashed box — and nothing beyond it. So U+0378, which these instruments named before Unifont
 * shipped, is drawn rather than boxed, and a case expecting its box failed for the right reason only while the chain
 * ended earlier. One spelling for every instrument that asks for the box, so the next change to the chain moves a line
 * rather than five. The kernel's own tests spell the same point, since a package cannot import from `scripts/`.
 */
export const NO_FACE_CHARACTER = String.fromCodePoint(0xf0000);
