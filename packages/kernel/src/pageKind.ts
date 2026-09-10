import type { PageText } from './textStructure.js';

/**
 * What a page is made of, as far as the substrate can say.
 *
 * ## Three states, and the third is why it is not a boolean
 *
 * *Is this page scanned* invites a yes/no, and a yes/no gets the empty page
 * wrong. A page with no text and no picture is **blank** — a section divider, a
 * back cover, a page somebody left empty — and offering to recognise text on it
 * is a control that renders and does nothing, which is the wired-tools rule
 * arriving as a suggestion. Two of the three states have no text in them and
 * they need different answers, so the answer has three.
 *
 * ## `'image-only'` and not `'scanned'`, deliberately
 *
 * Nothing here can know a page came from a scanner. What is observable is that
 * the page carries at least one raster and no text — which is what a scan looks
 * like, and also what a full-page diagram or a photograph looks like. Naming the
 * observation rather than the inference keeps a claim out of a type: a label
 * saying *scanned* would travel into a message, and a reader would then be told
 * something this build cannot see.
 *
 * It is also the exact condition OCR applies to, so the honest name loses
 * nothing.
 *
 * ## No constant, which is the property to keep
 *
 * The obvious refinement is a coverage threshold — *an image over 80% of the
 * page* — and it would be a tunable constant in a substrate whose whole
 * character is that it has none (`BUILD-PROMPT.md`:547 governs one that does not
 * exist, and the E2 row says so). It would also be wrong in the direction that
 * matters: a page with no text is a page with no text, whatever fraction the
 * picture covers, and a threshold's only effect is to answer `'empty'` for a
 * page that plainly has something on it.
 *
 * So the rule is two questions with no numbers in them, and it is decidable from
 * one reading of one engine.
 */
export type PageKind = 'text' | 'image-only' | 'empty';

/**
 * The rule, in one place.
 *
 * **Whitespace is not text.** A page whose only line is a run of spaces reads as
 * text to a `length > 0` test and as blank to a person; MuPDF emits such lines
 * on pages that carry a positioning artefact and nothing else. Trimming makes
 * the two agree.
 *
 * @param page one page's parsed structured text, read with `preserve-images`
 */
export function pageKindOf(page: PageText): PageKind {
  const hasText = page.blocks.some((block) =>
    block.lines.some((line) => line.text.trim().length > 0),
  );
  if (hasText) return 'text';
  return page.images > 0 ? 'image-only' : 'empty';
}
