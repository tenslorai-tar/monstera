import { describe, expect, it } from 'vitest';

import { applyParagraph, applyStyle, insertText, caret, wholeBlock } from '../editorKit/model.js';
import type { TextBlock } from '../textBlock.js';
import { editOf, joinsAsTheKernelDoes, modelOfBlock } from './blockModel.js';

const REGULAR = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false, font: 'ABCDEF+Arimo' };
const BOLD = { ...REGULAR, bold: true, font: 'ABCDEF+Arimo-Bold' };
/** A run the page names no font for. */
const STYLE_UNNAMED = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: true, italic: false, bold: false };

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** A block of lines, each a list of [index, text, style] runs, at the given top. */
function block(lines: { runs: [number, string, TextBlock['lines'][number]['runs'][number]['style']][]; soft: boolean }[]): TextBlock {
  return {
    box: box(72, 700 - 14 * lines.length, 300, 700),
    lines: lines.map((line, at) => ({
      runs: line.runs.map(([index, text, style]) => ({ index, text, style })),
      box: box(72, 700 - 14 * (at + 1), 300, 700 - 14 * at),
      soft: line.soft,
      baseline: 700 - 14 * (at + 1) + 3,
    })),
    style: REGULAR,
    shape: { align: 'left', firstIndent: 0 },
  };
}

/** A paragraph wrapped over two lines, then a line of its own with a bold word in it. */
const BLOCK = block([
  { runs: [[1, 'Words that run', REGULAR]], soft: true },
  { runs: [[2, 'and end here.', REGULAR]], soft: false },
  { runs: [[3, 'A ', REGULAR], [4, 'bold', BOLD], [5, ' close.', REGULAR]], soft: false },
]);

describe('the Edit text adapter’s model of a block', () => {
  it('opens as the kernel’s own join of the words, with the page’s line breaks kept per paragraph', () => {
    const opened = modelOfBlock(BLOCK);
    expect(joinsAsTheKernelDoes(BLOCK, opened)).toBe(true);
    expect(opened.wraps).toStrictEqual([[15], []]);
    // CONTROL: a model whose join differs (the soft wrap's space dropped) is not passed by the check.
    const [first, ...rest] = opened.model.paragraphs;
    if (first === undefined) throw new Error('no paragraph');
    const dropped = { ...opened, model: { paragraphs: [{ ...first, runs: first.runs.filter((run) => run.text !== ' ') }, ...rest] } };
    expect(joinsAsTheKernelDoes(BLOCK, dropped)).toBe(false);
  });

  it('writes the words alone when only words changed: no mark over letters as the page has them', () => {
    const { model } = modelOfBlock(BLOCK);
    const typed = insertText(model, caret({ paragraph: 1, offset: 7 }), 'very ').model;
    expect(editOf(typed)).toStrictEqual({ text: 'Words that run and end here.\nA bold very close.', formatting: {} });
  });

  it('marks only the properties the person changed, and only over the letters they changed', () => {
    const { model } = modelOfBlock(BLOCK);
    // ITALIC over "A bold": two runs of different bases, one property changed in both, so one mark.
    const italic = applyStyle(model, { anchor: { paragraph: 1, offset: 0 }, focus: { paragraph: 1, offset: 6 } }, { italic: true }).model;
    expect(editOf(italic).formatting).toStrictEqual({ marks: [{ from: 29, to: 35, set: { italic: true } }] });
    // BOLD PUT ON THE BOLD WORD changes nothing: no mark (the writer refuses an edit that changes nothing).
    const again = applyStyle(model, { anchor: { paragraph: 1, offset: 2 }, focus: { paragraph: 1, offset: 6 } }, { bold: true }).model;
    expect(editOf(again).formatting).toStrictEqual({});
    // A FONT CHOSEN for the whole block names its family over every letter, the bold word's too; a mark per paragraph,
    // since the line break between them is no letter.
    const face = applyStyle(model, wholeBlock(model), { face: 'Tinos' }).model;
    expect(editOf(face).formatting).toStrictEqual({
      marks: [
        { from: 0, to: 28, set: { family: 'Tinos' } },
        { from: 29, to: 42, set: { family: 'Tinos' } },
      ],
    });
  });

  it('keys a run the page names no font for by the run itself, and never writes that key as a family', () => {
    const unnamed = { ...STYLE_UNNAMED };
    const plain = block([{ runs: [[7, 'No name here', unnamed]], soft: false }]);
    const { model } = modelOfBlock(plain);
    // ITS OWN KEY, so the face the host rebuilds for run 7 draws it (`faceKeyOf`); CONTROL: a named run keeps its name.
    expect(model.paragraphs[0]?.runs[0]?.style.face).toBe('run:7');
    expect(modelOfBlock(BLOCK).model.paragraphs[0]?.runs[0]?.style.face).toBe('ABCDEF+Arimo');
    // A FAMILY CHOSEN over it is written; the run's own key, put back, is not.
    const chosen = applyStyle(model, wholeBlock(model), { face: 'Tinos' }).model;
    expect(editOf(chosen).formatting).toStrictEqual({ marks: [{ from: 0, to: 12, set: { family: 'Tinos' } }] });
    expect(editOf(model).formatting).toStrictEqual({});
  });

  it('sends a paragraph’s setting only where the person set it', () => {
    const { model } = modelOfBlock(BLOCK);
    const centred = applyParagraph(model, caret({ paragraph: 1, offset: 0 }), { align: 'center' }).model;
    expect(editOf(centred).formatting).toStrictEqual({ paragraphs: [{ paragraph: 1, align: 'center' }] });
  });
});
