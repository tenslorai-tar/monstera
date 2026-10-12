/**
 * The base 14's three text families by name, and which a family is or falls back to.
 *
 * Its own module because it is a question about NAMES, and the text box's typesetter beside which it was written imports
 * the bidirectional orderer: a field edit on `main`'s barrel that asked *is this a standard family* reached the shaper with
 * it, which ADR-0172 Decision 5 keeps in a host (`proof:kernelload`). This module imports nothing.
 */

/** A family, by the name a person chose it under: one of the base 14's three, or a face the resolver knows (K2). */
export type Family = string;

/** The base 14's three text families, by the names the font picker lists them under. */
export const BASE14_FAMILIES = ['Helvetica', 'Times', 'Courier'] as const;
export type Base14Family = (typeof BASE14_FAMILIES)[number];

/** The base-14 family a name is, ignoring case, or `undefined` for any other family. */
export function base14Of(family: Family): Base14Family | undefined {
  const lower = family.trim().toLowerCase();
  return BASE14_FAMILIES.find((each) => each.toLowerCase() === lower);
}

/**
 * The base-14 family a family falls back to where a reader draws the words itself (ADR-0228 Decision 3): the family where it
 * is one, else the one nearest its class. The ONE rule a text box's `/DA` and a form field's (ADR-0229) both take.
 */
export function nearestBase14(family: Family, classOf: (family: Family) => 'sans' | 'serif' | 'mono'): Base14Family {
  return base14Of(family) ?? ({ sans: 'Helvetica', serif: 'Times', mono: 'Courier' } as const)[classOf(family)];
}
