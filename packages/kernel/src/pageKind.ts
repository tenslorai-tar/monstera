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
 * the page is made of a raster and carries little or no text over it — which is what a scan looks
 * like, and also what a full-page diagram or a photograph looks like. Naming the
 * observation rather than the inference keeps a claim out of a type: a label
 * saying *scanned* would travel into a message, and a reader would then be told
 * something this build cannot see.
 *
 * It is also the exact condition OCR applies to, so the honest name loses
 * nothing.
 *
 * ## The rule has ONE number since the owner's order of 2026-10-07, and why
 *
 * This module used to answer `'text'` for ANY page with a word on it, and said that a coverage threshold would be a tunable
 * constant in a substrate that has none. The cost of that was found in use: after one box recognition added a few invisible
 * words to a photograph, OCR pages, Searchable copy and Clean up all refused the photograph, because a page with three words
 * was *a page with text*. The owner's rule is the other one: **a page is a picture when its text covers little of it** — here,
 * when the text lines' area is under {@link SCAN_TEXT_SHARE} of the pictures' area. Words that are invisible OCR over a scan
 * cover almost nothing of it, so the page stays offered for a re-run; a page of paragraphs with a logo is `'text'` because
 * its text is most of what is on it.
 *
 * The threshold is not measured against a corpus: it is the owner's rule given a number, and the cases pin both sides of it.
 * It is applied only where there are pictures with an area, so a page with no picture, or built without areas, is decided by
 * whether it has text at all, as before.
 */
export type PageKind = 'text' | 'image-only' | 'empty';

/**
 * The share of the pictures' area the text's may reach before the page counts as text: 5%. A scan carrying three invisible
 * words covers a fraction of a percent of its photograph; a typeset page's paragraphs cover tens of percent of any picture
 * on it.
 */
export const SCAN_TEXT_SHARE = 0.05;

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
  if (!hasText) return page.images > 0 ? 'image-only' : 'empty';
  // WORDS OVER A PICTURE THAT COVER LITTLE OF IT: the owner's rule. Only where the pictures have an area to compare with.
  const imageArea = page.imageArea ?? 0;
  if (page.images > 0 && imageArea > 0) {
    const textArea = page.blocks.reduce(
      (sum, block) =>
        sum +
        block.lines
          .filter((line) => line.text.trim().length > 0)
          .reduce(
            (inner, line) =>
              inner +
              Math.max(0, line.box.bottomRight.x - line.box.topLeft.x) * Math.max(0, line.box.bottomRight.y - line.box.topLeft.y),
            0,
          ),
      0,
    );
    if (textArea < SCAN_TEXT_SHARE * imageArea) return 'image-only';
  }
  return 'text';
}
