/**
 * A font name without its subset tag: `ABCDEF+Arimo-Regular` is a subset of `Arimo-Regular`.
 *
 * ISO 32000-2 §9.9.2: a subset's name begins with six upper-case letters and a plus sign, and the tag says only which
 * subset it is. So two fonts that differ by their tag alone are subsets of one font, and the name with the tag dropped
 * is the font's: the one rule for that, which the resolver, the Word export and an edit's sibling fonts take
 * ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 4). Pure, and in a module of its own, so a caller that reads names imports no subsetter.
 */
export function withoutSubsetTag(name: string): string {
  return name.replace(/^[A-Z]{6}\+/u, '');
}
