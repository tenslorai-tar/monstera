import { paragraphsOfLines } from '@monstera/shared';

/** What a block edit names and sends, read by both block writers: the PDFium writer's and the operator writer's. */
interface SentBlock {
  readonly lines: readonly (readonly number[])[];
  readonly soft: readonly boolean[];
  readonly text: string;
}

/**
 * Whether every block was sent exactly the words the page already shows for it, by the renderer's own join
 * (`paragraphsOfLines`, a soft wrap a space) (ADR-0260).
 *
 * Asked by a writer whose plan wrote nothing, to tell the two cases apart: true is `BlockUnchangedError`, an answer the
 * editor closes on; false is words the person changed and none of them written, a refusal that keeps the editor open.
 * ONE RULE for both writers, so a page rewritten by its operators and one rewritten by PDFium answer an untouched block
 * alike.
 *
 * ON THE WORDS ALONE, as the owner put the rule. A mark, a paragraph setting or a place that the writer's plan found
 * nothing to write for restates what the page already is (`proof:pdfiumcommand`'s restated mark and still place): the
 * page already looks as asked, so nothing the person asked for is lost by closing.
 *
 * ONE RUN OF SPACES READS AS ONE SPACE. A wrap keeps no white space after a line's last word (`layOutParagraph`), so a
 * space typed where a line wraps lays out as the line already is and the plan writes nothing. The words are the page's
 * words and there is nothing to refuse: the owner's video of 2026-11-05 was this, `set-text 0` for one space. It can only
 * be a wrap that absorbed it, since a space between two words on a line is written and never reaches this question. A
 * space REMOVED, or a line break, is still a difference.
 *
 * A run `shown` cannot name is not as shown: the writer could not compare it, so it refuses rather than closes.
 */
export function sentAsShown(blocks: readonly SentBlock[], shown: (run: number) => string | undefined): boolean {
  return blocks.every((block) => {
    const lines = block.lines.map((line) => line.map(shown));
    if (lines.some((line) => line.some((text) => text === undefined))) return false;
    const onPage = paragraphsOfLines(lines.map((line, at) => ({ text: line.join(''), soft: block.soft[at] === true })));
    return oneSpaceEach(block.text) === oneSpaceEach(onPage);
  });
}

const oneSpaceEach = (text: string): string => text.replaceAll(/ {2,}/gu, ' ');
