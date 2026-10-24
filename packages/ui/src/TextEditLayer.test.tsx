// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { BlockFormatting, EditedBlock, PageInsert } from '@monstera/contract';
import { asDocVersion, type MessageKey } from '@monstera/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type BlockCommit,
  type BlocksRead,
  NO_RUN_FONTS,
  type RunFonts,
  type TextBlock,
} from './commands/documentCommands.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN, SPELLING_DICTIONARY_FULL } from './messages/en.js';
import { type PageBlocks, TextEditLayer, fontsOfPage, nearbyStyle } from './TextEditLayer.js';
import { TextFormatPanel } from './TextFormatPanel.js';
import { readEditor } from './textFormatting.js';
import { panelControlsOutsideCards } from './propertyCards.js';

afterEach(() => {
  // THE EDIT TEXT VIEW OF THE PROPERTIES TAB, wherever a case rendered it: every property group in a card (Addendum 3).
  expect(panelControlsOutsideCards(document)).toStrictEqual([]);
});

/**
 * The in-place editor's surface (ADR-0096), cased on what a person does: sees
 * every block outlined, clicks one, types, and presses Escape or clicks away.
 *
 * The write itself is `commitTextBlock`'s, whose cases in `documentCommands.test.ts`
 * assert the command it sends; these assert what reaches it — the block the
 * person opened and the words they typed — and what the surface does with each
 * answer.
 */

/** The one element a selector names, or a named failure — never a cast over `null`. */
function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`nothing on the page matches ${selector}`);
  return found;
}

/** The open editor, checked to be the plain-text editable element it is (ADR-0145). */
function editorIn(root: ParentNode): HTMLElement {
  const found = root.querySelector('[data-text-editor]');
  if (!(found instanceof HTMLElement) || found.getAttribute('contenteditable') !== 'plaintext-only') {
    throw new Error('no plain-text editor is open');
  }
  return found;
}

/**
 * What a person typing leaves: the editor's lines replaced by `text`'s, a line per `div` as the browser keeps them,
 * and the `input` event the browser fires.
 */
function typeInto(editor: HTMLElement, text: string): void {
  editor.replaceChildren(
    ...text.split('\n').map((line) => {
      const row = editor.ownerDocument.createElement('div');
      row.textContent = line;
      return row;
    }),
  );
  fireEvent.input(editor);
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const GEOMETRY = { crop: [0, 0, 612, 792] as const, rotation: 0, zoom: 1 };

const STYLE = { size: 11, colour: { r: 20, g: 40, b: 60 }, serif: true, mono: false, italic: false, bold: true };
/** A run set apart inside its line: smaller, grey, upright, sans. */
const OTHER = { size: 9, colour: { r: 64, g: 64, b: 64 }, serif: false, mono: false, italic: true, bold: false };

/** A left-aligned block with no first-line indent, which is what a block no case is about reads as. */
const LEFT = { align: 'left', firstIndent: 0 } as const;

/** A block that pushes nothing when it grows (ADR-0249): what a block no case about the push reads as. */
const NO_PUSH = { below: [], room: 0 } as const;

/** Two blocks: a paragraph of two lines, and a heading far above it. */
const BLOCKS: PageBlocks = {
  version: asDocVersion(7),
  blocks: [
    {
      box: { x0: 72, y0: 700, x1: 300, y1: 740 },
      lines: [
        { runs: [{ index: 5, text: 'WORK EXPERIENCE', style: STYLE }], box: { x0: 72, y0: 700, x1: 300, y1: 740 }, soft: false, baseline: 703 },
      ],
      style: STYLE,
      shape: LEFT,
      push: NO_PUSH,
    },
    {
      box: { x0: 72, y0: 600, x1: 400, y1: 650 },
      lines: [
        {
          runs: [
            { index: 8, text: 'Helps with care ', style: STYLE },
            { index: 9, text: 'and support', style: OTHER },
          ],
          box: { x0: 72, y0: 636, x1: 400, y1: 650 },
          soft: false,
          baseline: 639,
        },
        {
          runs: [{ index: 11, text: 'at every stage.', style: STYLE }],
          box: { x0: 72, y0: 622, x1: 260, y1: 636 },
          soft: false,
          baseline: 625,
        },
      ],
      style: STYLE,
      shape: LEFT,
      push: NO_PUSH,
    },
  ],
  truncated: false,
  rotated: 0,
  angled: { turned: 0, vertical: 0, slanted: 0, mirrored: 0 },
  unaddressable: 0,
  rewrite: 'objects',
};

function mount(overrides: Partial<Parameters<typeof TextEditLayer>[0]> = {}) {
  const commits: { block: TextBlock; text: string; version: number; rewrite: BlocksRead['rewrite'] }[] = [];
  let answer: BlockCommit = 'written';
  const onCommit = vi.fn((block: TextBlock, text: string, read: BlocksRead) => {
    commits.push({ block, text, version: read.version, rewrite: read.rewrite });
    return Promise.resolve(answer);
  });
  const onLeave = vi.fn();
  const onPromote = vi.fn();
  const layer = (blocks: PageBlocks) => (
    <Wrapped>
      <TextEditLayer
        blocks={blocks}
        geometry={GEOMETRY}
        onCommit={onCommit}
        onLeave={onLeave}
        onPromote={onPromote}
        page={2}
        paperAt={() => 'rgb(250, 250, 250)'}
        runFonts={() => Promise.resolve(NO_RUN_FONTS)}
        {...overrides}
      />
      {/* THE PROPERTIES PANEL'S TEXT SECTION beside the page, as the app draws it while an editor is open (K11). */}
      <TextFormatPanel fonts={undefined} documentFonts={[]} />
    </Wrapped>
  );
  const view = render(layer(overrides.blocks ?? BLOCKS));
  return {
    view,
    commits,
    onLeave,
    onPromote,
    answerWith: (next: BlockCommit) => {
      answer = next;
    },
    /** The read after a write, as `TextEditPage` hands it down: a new version of the page's blocks. */
    show: (blocks: PageBlocks) => {
      view.rerender(layer(blocks));
    },
  };
}

describe('Edit text on the page (ADR-0096)', () => {
  it('OUTLINES every block in place, named by its own first words — nothing is listed in a dialog', () => {
    const { view } = mount();
    const outlines = view.container.querySelectorAll('[data-text-block]');
    expect(outlines).toHaveLength(2);
    // PLACED THROUGH THE PAGE'S TRANSFORM: the paragraph's top-left in PDF space
    // (72, 650) lands 142 CSS pixels down a 792-point page at zoom 1.
    const paragraph = find(view.container, '[data-text-block="1"]');
    expect(paragraph.style.left).toBe('72px');
    expect(paragraph.style.top).toBe('142px');
    expect(paragraph.style.width).toBe('328px');
    expect(paragraph.getAttribute('aria-label')).toContain('Helps with care and support');
  });

  it('a click OPENS an editor over the block holding its words, line by line, set like the page', () => {
    const { view } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    expect(editor.innerText).toBe('Helps with care and support\nat every stage.');
    expect(editor.style.color).toBe('rgb(20, 40, 60)');
    // NO PAPER while nothing is changed (`AS_DRAWN`): every row is laid out as the page drew it and the page shows.
    expect(editor.style.backgroundColor).toBe('');
    expect(view.container.querySelectorAll('.m-text-editor-cover')).toHaveLength(0);
    expect([...editor.querySelectorAll('.m-text-editor__line')].every((row) => row.classList.contains('m-text-editor__line--as-drawn'))).toBe(true);
    expect(editor.style.fontWeight).toBe('700');
    expect(editor.classList.contains('m-text-editor--serif')).toBe(true);
    // THE HANDLES MARK THE OPEN BLOCK, and they take no pointer.
    expect(view.container.querySelectorAll('.m-text-editor-handle')).toHaveLength(8);
    // The other block stays an outline.
    expect(view.container.querySelectorAll('[data-text-block]')).toHaveLength(1);
  });

  it('a soft-wrapped line runs on into the next in ONE paragraph, with a space in the style of the run before it (ADR-0179)', () => {
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost a block');
    const [first, second] = paragraph.lines;
    if (first === undefined || second === undefined) throw new Error('the fixture lost a line');
    const soft: PageBlocks = {
      ...BLOCKS,
      blocks: [heading, { ...paragraph, lines: [{ ...first, soft: true }, second] }],
    };
    const { view } = mount({ blocks: soft });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    // ONE PARAGRAPH: one line element, the two lines' words joined by the space the soft wrap stands for.
    expect(editor.querySelectorAll('.m-text-editor__line')).toHaveLength(1);
    expect(editor.innerText).toBe('Helps with care and support at every stage.');
    // BROKEN WHERE THE PAGE BROKE IT (`AS_DRAWN`), by a wrap the words sent to the writer do not see: the text is the
    // paragraph's, one space where the line ended, exactly as before the editor drew the page's breaks.
    expect(editor.querySelectorAll('br[data-soft-wrap]')).toHaveLength(1);
    expect(readEditor(editor).text).toBe('Helps with care and support at every stage.');
    // THE SPACE IS THE PREVIOUS RUN'S, so it measures as it was set: the run before it is `and support`, in OTHER.
    const spans = [...editor.querySelectorAll<HTMLElement>('.m-text-editor__run')];
    expect(spans.map((span) => span.textContent)).toStrictEqual(['Helps with care ', 'and support', ' ', 'at every stage.']);
    expect(spans[2]?.style.color).toBe('rgb(64, 64, 64)');
  });

  it('CONTROL: lines the read found HARD stay two paragraphs, which is what the same words read as before ADR-0179', () => {
    const { view } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    expect(editorIn(view.container).querySelectorAll('.m-text-editor__line')).toHaveLength(2);
  });

  /**
   * The fixture's paragraph block as ONE paragraph whose first line starts `first` points from the second's: its lines say
   * the indent, as the page's do, and the editor reads it from them (`paragraphEdges`, ADR-0179's correction of 2026-10-24).
   */
  const indentedBy = (paragraph: TextBlock, first: number): TextBlock => {
    const [one, two] = paragraph.lines;
    if (one === undefined || two === undefined) throw new Error('the fixture lost a line');
    const left = paragraph.box.x0;
    return {
      ...paragraph,
      lines: [
        { ...one, box: { ...one.box, x0: left + Math.max(first, 0) }, soft: true },
        { ...two, box: { ...two.box, x0: left + Math.max(-first, 0) } },
      ],
      shape: { align: 'left', firstIndent: first },
    };
  };
  /** The editor's row for its first paragraph, which carries that paragraph's own edges. */
  const firstRow = (container: HTMLElement): HTMLElement => {
    const row = editorIn(container).querySelector<HTMLElement>('.m-text-editor__line');
    if (row === null) throw new Error('the editor holds no paragraph');
    return row;
  };

  it('sets the editor in the SHAPE the read found: a centred block is centred, an indented first line is indented (ADR-0179)', async () => {
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost a block');
    const shaped: PageBlocks = {
      ...BLOCKS,
      blocks: [{ ...heading, shape: { align: 'center', firstIndent: 0 } }, indentedBy(paragraph, 24)],
    };
    const { view, answerWith } = mount({ blocks: shaped });
    // NOTHING TYPED, so the open block writes nothing and the next opens at once.
    answerWith('unchanged');
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    expect(editorIn(view.container).style.textAlign).toBe('center');
    // THE OPEN BLOCK IS WRITTEN FIRST, even when there is nothing to write, and the next opens after it (ADR-0180 Decision 8).
    await act(async () => {
      fireEvent.click(find(view.container, '[data-text-block="1"]'));
      await Promise.resolve();
    });
    expect(editorIn(view.container).style.textAlign).toBe('left');
    // THE INDENT IS THE PARAGRAPH'S, on its own row.
    expect(firstRow(view.container).style.textIndent).toBe('24px');
  });

  it('a HANGING indent pads the paragraph in and takes its first line back out, since the box starts at that line', () => {
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost a block');
    // EIGHTEEN POINTS, half as much again as a character of these lines (12): one character is within what agreeing
    // edges allow, and a hang that small is read as none.
    const { view } = mount({ blocks: { ...BLOCKS, blocks: [heading, indentedBy(paragraph, -18)] } });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const row = firstRow(view.container);
    expect(row.style.paddingLeft).toBe('18px');
    expect(row.style.textIndent).toBe('-18px');
  });

  it('sets EACH PARAGRAPH at its own left: a second paragraph standing 20 points in starts 20 in, the first at the edge', () => {
    // The block's two one-line paragraphs, the second moved right as a bulleted item's words are beside a plain line
    // (the owner's document 8, 2026-10-24). One shape for the block put both at its left.
    const [heading, paragraph] = BLOCKS.blocks;
    const [one, two] = paragraph?.lines ?? [];
    if (heading === undefined || paragraph === undefined || one === undefined || two === undefined) throw new Error('the fixture lost a line');
    const moved: TextBlock = { ...paragraph, lines: [one, { ...two, box: { ...two.box, x0: paragraph.box.x0 + 20 } }] };
    const { view } = mount({ blocks: { ...BLOCKS, blocks: [heading, moved] } });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    // WHERE EACH PARAGRAPH'S FIRST LINE STARTS: its padding and its first-line indent together.
    const starts = [...editorIn(view.container).querySelectorAll<HTMLElement>('.m-text-editor__line')].map(
      (row) => Number.parseFloat(row.style.paddingLeft || '0') + Number.parseFloat(row.style.textIndent || '0'),
    );
    expect(starts).toStrictEqual([0, 20]);
  });

  it('lays each paragraph out in the direction its own letters say, so Hebrew and Arabic are typed right to left (ADR-0181)', () => {
    const { view } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    // `unicode-bidi: plaintext` is per paragraph, which a `dir` on the one element is not.
    expect(editorIn(view.container).getAttribute('style')).toMatch(/unicode-bidi:\s*plaintext/u);
  });

  it('CONTROL: a block with no indent has none, so the case above is the shape and not a default', () => {
    const { view } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    expect(editor.style.textAlign).toBe('left');
    expect(editor.style.textIndent).toBe('');
  });

  it('opens with the caret WHERE THE PERSON CLICKED, and at the end for a key', () => {
    const where = vi.fn(() => {
      const spans = [...document.querySelectorAll('.m-text-editor__run')];
      const span = spans.at(-1);
      if (span?.firstChild === null || span?.firstChild === undefined) throw new Error('the editor holds no words');
      return { offsetNode: span.firstChild, offset: 3 };
    });
    Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: where });
    try {
      const { view } = mount();
      fireEvent.click(find(view.container, '[data-text-block="1"]'), { detail: 1, clientX: 10, clientY: 20 });
      expect(where).toHaveBeenCalledWith(10, 20);
      const selection = document.getSelection();
      expect(selection?.anchorNode?.textContent).toBe('at every stage.');
      expect(selection?.anchorOffset).toBe(3);
      view.unmount();
      // CONTROL: a key's activation reports no point (`detail` 0), and the browser is not asked; the caret is at the end.
      where.mockClear();
      const keyed = mount();
      fireEvent.click(find(keyed.view.container, '[data-text-block="1"]'), { detail: 0 });
      expect(where).not.toHaveBeenCalled();
      expect(document.getSelection()?.anchorNode).toBe(editorIn(keyed.view.container));
    } finally {
      Reflect.deleteProperty(document, 'caretPositionFromPoint');
    }
  });

  it('draws the paper over a changed row as a gradient where the page behind it is shaded, and flat where it is not', () => {
    /** Opens the paragraph, changes its first row's words and answers the paper laid over the page's copy of that row. */
    const coverAfterTyping = (container: HTMLElement): { style: { backgroundImage: string; backgroundColor: string } } => {
      fireEvent.click(find(container, '[data-text-block="1"]'));
      const editor = editorIn(container);
      const run = editor.querySelector('.m-text-editor__run');
      if (run === null) throw new Error('no run');
      run.textContent = `${run.textContent}x`;
      fireEvent.input(editor);
      // ONLY THE CHANGED ROW IS DRAWN, and nothing behind the editor itself.
      expect([...editor.querySelectorAll('.m-text-editor__line')].map((row) => row.classList.contains('m-text-editor__line--as-drawn'))).toStrictEqual([false, true]);
      expect(editor.style.backgroundColor).toBe('');
      // TWO COVERS for the one row, its band where the page drew it and its box where it is now, in one paper.
      const covers = [...container.querySelectorAll<HTMLElement>('.m-text-editor-cover')];
      expect(covers).toHaveLength(2);
      const looks = new Set(covers.map((each) => `${each.style.backgroundImage}|${each.style.backgroundColor}`));
      expect(looks.size).toBe(1);
      const [backgroundImage = '', backgroundColor = ''] = [...looks][0]?.split('|') ?? [];
      return { style: { backgroundImage, backgroundColor } };
    };
    const shaded = mount({ paperAt: (_x, y) => (y < 170 ? 'rgb(200, 200, 200)' : 'rgb(100, 100, 100)') });
    const cover = coverAfterTyping(shaded.view.container);
    expect(cover.style.backgroundImage).toBe('linear-gradient(to bottom, rgb(200, 200, 200), rgb(100, 100, 100))');
    expect(cover.style.backgroundColor).toBe('');
    shaded.view.unmount();
    // CONTROL: three of four agreeing is flat paper with a stray neighbour, as before.
    const flat = mount({ paperAt: (x, y) => (x < 70 && y < 140 ? 'rgb(0, 0, 0)' : 'rgb(250, 250, 250)') });
    const flatCover = coverAfterTyping(flat.view.container);
    expect(flatCover.style.backgroundColor).toBe('rgb(250, 250, 250)');
    expect(flatCover.style.backgroundImage).toBe('');
  });

  it('stacks the outlines by area, the smallest on top, so a block inside another is the one clicked', () => {
    const { view } = mount();
    const heading = find(view.container, '[data-text-block="0"]');
    const paragraph = find(view.container, '[data-text-block="1"]');
    expect(Number(heading.style.zIndex)).toBeGreaterThan(Number(paragraph.style.zIndex));
  });

  it('EACH RUN is drawn in its own style, at the zoom — not the block’s one (ADR-0145)', () => {
    const { view } = mount({ geometry: { ...GEOMETRY, zoom: 2 } });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const runs = [...editorIn(view.container).querySelectorAll<HTMLElement>('.m-text-editor__run')];
    expect(
      runs.map((run) => [
        run.textContent,
        run.style.fontSize,
        run.style.fontWeight,
        run.style.fontStyle,
        run.style.color,
        run.classList.contains('m-text-editor--serif'),
      ]),
    ).toStrictEqual([
      ['Helps with care ', '22px', '700', 'normal', 'rgb(20, 40, 60)', true],
      ['and support', '18px', '400', 'italic', 'rgb(64, 64, 64)', false],
      ['at every stage.', '22px', '700', 'normal', 'rgb(20, 40, 60)', true],
    ]);
  });

  it('a COMPOSITION’S Escape cancels the candidate and writes nothing (CR-COR-07)', async () => {
    const { view, commits } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'にほんご');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });
      await Promise.resolve();
    });
    expect(commits).toHaveLength(0);
    // CONTROL: with the composition closed, Escape writes.
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(commits).toHaveLength(1);
  });

  it('ESCAPE WRITES what was typed, for the block that was open, at the version it was read at', async () => {
    const { view, commits, show } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'Helps with care and support\nat every single stage.');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]?.text).toBe('Helps with care and support\nat every single stage.');
    // THE BLOCK AS READ: its runs' own indices travel to the write, not a position.
    expect(commits[0]?.block.lines.map((line) => line.runs.map((run) => run.index))).toStrictEqual([[8, 9], [11]]);
    expect(commits[0]?.version).toBe(7);
    // AND THE WRITER THE SAME READ NAMED, carried with its version rather than looked up beside it.
    expect(commits[0]?.rewrite).toBe('objects');
    // HELD, LOCKED, until the read after the write (ADR-0261 Decision 7), and gone with it.
    expect(find(view.container, '[data-text-editor]').getAttribute('contenteditable')).toBe('false');
    show({ ...BLOCKS, version: asDocVersion(8) });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
  });

  it('a page read as needing the operator writer commits with that writer (ADR-0176 Decision 1)', async () => {
    // CONTROL for the case above: the same block and words on a page the read named `operators`, so a layer that sent
    // a constant would answer `objects` here.
    const { view, commits } = mount({ blocks: { ...BLOCKS, rewrite: 'operators' } });
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'WORK HISTORY');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(commits.map((commit) => [commit.text, commit.rewrite])).toStrictEqual([['WORK HISTORY', 'operators']]);
  });

  it('A CLICK AWAY writes too — the editor losing focus is the person finishing', async () => {
    const { view, commits } = mount();
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'WORK HISTORY');
    await act(async () => {
      fireEvent.blur(editor);
      await Promise.resolve();
    });
    expect(commits.map((commit) => commit.text)).toStrictEqual(['WORK HISTORY']);
  });

  it('A FONT THAT CANNOT CARRY THE WORDS keeps the editor open and SAYS so beside them, naming the characters', async () => {
    const { view, answerWith } = mount();
    answerWith({ refused: { code: 'text-not-writable', detail: { characters: '中é' } } });
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'WORK 中é');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).not.toBeNull();
    const said = view.container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(said).toContain('Nothing was changed');
    // ONE AT A TIME, so an accent beside a letter reads as two characters.
    expect(said).toContain('中 é');
    expect(said).toContain('Change the words, or press Esc to put the text back');
    // AND A SECOND ESCAPE PUTS THE TEXT BACK rather than sending it again.
    await act(async () => {
      fireEvent.keyDown(find(view.container, '[data-text-editor]'), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
  });

  it('ANY REFUSAL keeps the editor and the WORDS TYPED, with its own sentence and reference (ADR-0169 Decision 5)', async () => {
    // THE DEFECT: only the font's refusal and the signatures question kept the editor, so every other refusal closed it
    // and the words a person typed were gone. A step PDFium refused is the case the owner met.
    const { view, answerWith } = mount();
    answerWith({ refused: { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } } });
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'WORK EXPERIENCE');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    const kept = view.container.querySelector('[data-text-editor]');
    expect(kept?.textContent).toBe('WORK EXPERIENCE');
    const said = view.container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(said).toContain('Monstera couldn’t make this change without disturbing other text on the page, so nothing was changed.');
    expect(said).toContain('read-back 0');
    // NO CHANGE OF WORDS PASSES IT, so the editor offers only the way back (RRRRRRR-16); the font's refusal above, which
    // other words can pass, is the control that still says *Change the words*.
    expect(said).toContain('Press Esc to put the text back.');
    expect(said).not.toContain('Change the words');
  });

  describe('a write that rejects frees the editor (CR-COR-13)', () => {
    it('a commit that REJECTS keeps the editor and the words, says so beside them, and a second Escape still closes it', async () => {
      const onCommit = vi.fn((_block: TextBlock, _text: string, _read: BlocksRead) =>
        Promise.reject<BlockCommit>(new Error('the host went away')),
      );
      const made = mount({ onCommit });
      fireEvent.click(find(made.view.container, '[data-text-block="0"]'));
      const editor = editorIn(made.view.container);
      typeInto(editor, 'WORK EXPERIENCE');
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      const kept = made.view.container.querySelector('[data-text-editor]');
      expect(kept?.textContent).toBe('WORK EXPERIENCE');
      expect(made.view.container.querySelector('[role="alert"]')?.textContent ?? '').not.toBe('');
      // CONTROL: before the fix `writing` stayed true after the rejection, the editor was locked, and this Escape did nothing.
      await act(async () => {
        fireEvent.keyDown(find(made.view.container, '[data-text-editor]'), { key: 'Escape' });
        await Promise.resolve();
      });
      expect(made.view.container.querySelector('[data-text-editor]')).toBeNull();
    });
  });

  describe('placing a block with its handles (ADR-0180, corrected 2026-10-06)', () => {
    /** The editor open on block 0 (box 72..300 by 700..740 at zoom 1), with every commit's formatting kept. */
    function openForPlacing() {
      const sent: { text: string; formatting: BlockFormatting | undefined }[] = [];
      const onCommit = vi.fn((_block: TextBlock, text: string, _read: BlocksRead, formatting?: BlockFormatting) => {
        sent.push({ text, formatting });
        return Promise.resolve<BlockCommit>('written');
      });
      const made = mount({ onCommit });
      fireEvent.click(find(made.view.container, '[data-text-block="0"]'));
      const editor = editorIn(made.view.container);
      /** A drag of the handle `name` by (dx, dy) screen pixels, as a pointer does it. */
      const drag = (name: string, dx: number, dy: number) => {
        const handle = find(made.view.container, `[data-handle="${name}"]`);
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
        fireEvent.pointerMove(handle, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
      };
      const finish = async () => {
        await act(async () => {
          fireEvent.keyDown(editor, { key: 'Escape' });
          await Promise.resolve();
        });
      };
      return { ...made, editor, sent, drag, finish };
    }

    it('dragging a side sets the measure the words are laid out at, and writes it with the words', async () => {
      const { sent, drag, finish } = openForPlacing();
      drag('e', 40, 0);
      await finish();
      // THE BLOCK IS 228 WIDE (72 to 300) and the side was dragged 40 points out.
      expect(sent).toHaveLength(1);
      expect(sent[0]?.formatting?.place).toStrictEqual({ width: 268 });
    });

    it('the top grip moves the block, the screen’s y running down where the page’s runs up', async () => {
      const { sent, drag, finish } = openForPlacing();
      drag('n', 10, -5);
      await finish();
      expect(sent[0]?.formatting?.place).toStrictEqual({ move: { x: 10, y: 5 } });
    });

    it('a corner scales and the handle to the right turns, each as one placement', async () => {
      const scaled = openForPlacing();
      scaled.drag('se', 114, 0);
      await scaled.finish();
      expect(scaled.sent[0]?.formatting?.place?.scale).toBeCloseTo(1.5, 6);
      scaled.view.unmount();
      const turned = openForPlacing();
      // THE HANDLE STARTS 20 BEYOND THE RIGHT EDGE, 134 from the middle of a block 228 wide; straight up from there is a
      // quarter turn once it has come over the middle.
      turned.drag('r', -134, -134);
      await turned.finish();
      expect(turned.sent[0]?.formatting?.place?.rotate).toBeCloseTo(90, 6);
    });

    it('CONTROL: with no handle touched the write carries no place, so the cases above are the handles’', async () => {
      const { sent, finish } = openForPlacing();
      await finish();
      expect(sent[0]?.formatting?.place).toBeUndefined();
    });

    it('shows the placement over the editor while it is made, and not before', () => {
      const { view, drag } = openForPlacing();
      const placer = find(view.container, '.m-text-editor-placer');
      expect(placer.getAttribute('data-placed')).toBeNull();
      drag('e', 40, 0);
      expect(placer.getAttribute('data-placed')).toBe('');
      // THE MEASURE IS THE PLACER'S WIDTH, so the browser wraps the words at it while they are typed.
      expect(placer.style.width).toBe('268px');
    });

    it('a key places the block the way a drag does: Alt with an arrow moves it, with Shift ten times as far', async () => {
      const { sent, editor, finish } = openForPlacing();
      fireEvent.keyDown(editor, { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(editor, { key: 'ArrowUp', altKey: true, shiftKey: true });
      await finish();
      expect(sent[0]?.formatting?.place).toStrictEqual({ move: { x: 1, y: 10 } });
    });

    it('the Properties panel’s Remove empties the block and writes it, which is what removes a block', async () => {
      const { view, sent } = openForPlacing();
      const remove = within(find(view.container, '[data-text-properties]')).getByRole('button', { name: 'Remove this text' });
      await act(async () => {
        fireEvent.click(remove);
        await Promise.resolve();
      });
      expect(sent.map((one) => one.text)).toStrictEqual(['']);
    });

    it('Remove is a button WITH ITS WORDS, in the danger tone, not a bin whose name only a tooltip shows (the owner R14)', () => {
      const { view } = openForPlacing();
      const remove = within(find(view.container, '[data-text-properties]')).getByRole('button', { name: 'Remove this text' });
      // DRAWN, not only named: the words are the button's own text outside any visually hidden span, and it carries no
      // tooltip standing in for them. The icon-only control it replaced passed the name check above and failed this one.
      const drawn = [...remove.childNodes]
        .filter((node) => !(node instanceof HTMLElement && node.classList.contains('m-visually-hidden')))
        .map((node) => node.textContent)
        .join('');
      expect(drawn).toBe('Remove this text');
      expect(remove.getAttribute('title')).toBeNull();
      expect(remove.classList.contains('m-button--danger')).toBe(true);
    });
  });

  describe('the right-click menu (ADR-0180 Decision 8)', () => {
    const NO_ANSWER = Promise.resolve(undefined);
    /** The editor open on block 1 with `text` typed, the caret at `at`, and the menu's two halves recorded. */
    function openWithCaret(text: string, at: number) {
      const looked: string[] = [];
      const kept: string[] = [];
      const native: string[] = [];
      let refusal: MessageKey | undefined;
      const spell = {
        look: (word: string) => {
          looked.push(word);
          return word === 'quikc' ? Promise.resolve({ suggestions: ['quick', 'quirk'] }) : NO_ANSWER;
        },
        keep: (word: string) => {
          kept.push(word);
          return refusal;
        },
      };
      const made = mount({ spell, native: (action) => native.push(action) });
      fireEvent.click(find(made.view.container, '[data-text-block="1"]'));
      const editor = editorIn(made.view.container);
      typeInto(editor, text);
      const node = editor.querySelector('div')?.firstChild;
      if (!(node instanceof Text)) throw new Error('no text typed');
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return { ...made, editor, looked, kept, native, refuseWith: (message: MessageKey | undefined) => (refusal = message) };
    }
    const rightClick = async (editor: HTMLElement) => {
      await act(async () => {
        fireEvent.contextMenu(editor, { clientX: 10, clientY: 10 });
        await Promise.resolve();
      });
    };

    it('over a misspelt word offers its replacements, and choosing one replaces that word and no other', async () => {
      const { editor, looked } = openWithCaret('the quikc fox', 6);
      await rightClick(editor);
      expect(looked).toStrictEqual(['quikc']);
      const choice = await screen.findByRole('menuitem', { name: 'quick' });
      expect(await screen.findByRole('menuitem', { name: 'quirk' })).toBeDefined();
      await act(async () => {
        fireEvent.click(choice);
        await Promise.resolve();
      });
      expect(editor.textContent).toBe('the quick fox');
    });

    it('CONTROL: over a correct word the menu has no replacements, only the editing verbs', async () => {
      const { editor } = openWithCaret('the quikc fox', 1);
      await rightClick(editor);
      await screen.findByRole('menuitem', { name: 'Paste' });
      expect(screen.queryByRole('menuitem', { name: 'quick' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /Add .* to the dictionary/u })).toBeNull();
    });

    it('Add to the dictionary keeps the word, and says why when the dictionary refuses', async () => {
      const { editor, kept, refuseWith, view } = openWithCaret('the quikc fox', 6);
      await rightClick(editor);
      await act(async () => {
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Add “quikc” to the dictionary' }));
        await Promise.resolve();
      });
      expect(kept).toStrictEqual(['quikc']);
      expect(view.container.querySelector('[role="status"]')).toBeNull();
      // THE SENTENCE OF A REFUSAL, beside the words, until the next thing is typed.
      refuseWith(SPELLING_DICTIONARY_FULL);
      await rightClick(editor);
      await act(async () => {
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Add “quikc” to the dictionary' }));
        await Promise.resolve();
      });
      expect(view.container.querySelector('[role="status"]')?.textContent).toContain('dictionary is full');
    });

    it('the verbs are the browser’s own through the one native call: Paste always, Cut and Copy only over a selection', async () => {
      const { editor, native } = openWithCaret('the quikc fox', 1);
      await rightClick(editor);
      expect(screen.getByRole('menuitem', { name: 'Cut' }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('true');
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
        await Promise.resolve();
      });
      expect(native).toStrictEqual(['paste']);
    });

    it('does not finish the words while the menu has the focus, and the page’s own menu is not opened over them', async () => {
      const committed: string[] = [];
      const onCommit = vi.fn((_block: TextBlock, text: string) => {
        committed.push(text);
        return Promise.resolve<BlockCommit>('written');
      });
      const pageMenu = vi.fn();
      render(
        <div onContextMenu={pageMenu}>
          <Wrapped>
            <TextEditLayer
              blocks={BLOCKS}
              geometry={GEOMETRY}
              onCommit={onCommit}
              onLeave={vi.fn()}
              onPromote={vi.fn()}
              page={2}
              paperAt={() => undefined}
              runFonts={() => Promise.resolve(NO_RUN_FONTS)}
            />
          </Wrapped>
        </div>,
      );
      fireEvent.click(find(document.body, '[data-text-block="1"]'));
      const editor = editorIn(document.body);
      await act(async () => {
        fireEvent.contextMenu(editor, { clientX: 10, clientY: 10 });
        await Promise.resolve();
      });
      await screen.findByRole('menuitem', { name: 'Paste' });
      // THE POPUP HAS THE FOCUS, which blurs the editor: a write now would finish the words under the menu.
      await act(async () => {
        fireEvent.blur(editor);
        await Promise.resolve();
      });
      expect(committed).toStrictEqual([]);
      expect(pageMenu).not.toHaveBeenCalled();
    });
  });

  describe('join and split from the menu (ADR-0180 Decision 7)', () => {
    const REGULAR = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
    const line = (index: number, text: string, soft: boolean, top: number) => ({
      runs: [{ index, text, style: REGULAR }],
      box: { x0: 72, y0: top - 14, x1: 300, y1: top },
      soft,
      baseline: top - 11,
    });
    /** Two blocks one above the other, the upper of two paragraphs, close enough to be one text's continuation. */
    const STACKED: PageBlocks = {
      ...BLOCKS,
      blocks: [
        {
          box: { x0: 72, y0: 686, x1: 300, y1: 728 },
          lines: [line(1, 'First paragraph.', false, 728), line(2, 'Second paragraph.', false, 714), line(3, 'Third.', false, 700)],
          style: REGULAR,
          shape: { align: 'left', firstIndent: 0 },
          push: NO_PUSH,
        },
        {
          box: { x0: 72, y0: 650, x1: 300, y1: 664 },
          lines: [line(4, 'The block below.', false, 664)],
          style: REGULAR,
          shape: { align: 'left', firstIndent: 0 },
          push: NO_PUSH,
        },
      ],
    };
    function mountStacked() {
      const sent: { edits: EditedBlock[]; version: number }[] = [];
      const onRestructure = vi.fn((edits: EditedBlock[], read: BlocksRead) => {
        sent.push({ edits, version: read.version });
        return Promise.resolve<BlockCommit>('written');
      });
      const made = mount({ blocks: STACKED, onRestructure });
      fireEvent.click(find(made.view.container, '[data-text-block="0"]'));
      const editor = editorIn(made.view.container);
      /** The caret in the paragraph `at` of the editor (a `div` each), then a right-click. */
      const rightClickIn = async (paragraph: number) => {
        const row = editor.children[paragraph];
        const node = row === undefined ? null : document.createTreeWalker(row, 4).nextNode();
        if (!(node instanceof Text)) throw new Error('no such paragraph');
        const range = document.createRange();
        range.setStart(node, 1);
        range.collapse(true);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        await act(async () => {
          fireEvent.contextMenu(editor, { clientX: 10, clientY: 10 });
          await Promise.resolve();
        });
      };
      return { ...made, editor, sent, rightClickIn };
    }

    it('joins with the block below as two entries of ONE command: the words extended and the lower block emptied', async () => {
      const { sent, rightClickIn } = mountStacked();
      await rightClickIn(0);
      await act(async () => {
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Join with the text below' }));
        await Promise.resolve();
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.edits.map((edit) => edit.text)).toStrictEqual(['First paragraph.\nSecond paragraph.\nThird. The block below.', '']);
      expect(sent[0]?.version).toBe(7);
    });

    it('splits before the paragraph the caret is in, the second half moved down, and not before the first paragraph', async () => {
      const { sent, rightClickIn } = mountStacked();
      await rightClickIn(1);
      await act(async () => {
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Split the text before this paragraph' }));
        await Promise.resolve();
      });
      expect(sent[0]?.edits.map((edit) => edit.text)).toStrictEqual(['First paragraph.', 'Second paragraph.\nThird.']);
      expect(sent[0]?.edits[1]?.place).toStrictEqual({ move: { x: 0, y: -14 } });
    });

    it('CONTROL: there is nothing to split before the first paragraph, and nothing to join above the top block', async () => {
      const { rightClickIn } = mountStacked();
      await rightClickIn(0);
      await screen.findByRole('menuitem', { name: 'Paste' });
      expect(screen.queryByRole('menuitem', { name: 'Split the text before this paragraph' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Join with the text above' })).toBeNull();
    });

    it('is not offered once words are typed, since a join writes the block as the page has it and would drop them', async () => {
      const { editor, rightClickIn } = mountStacked();
      typeInto(editor, 'Typed over.');
      await rightClickIn(0);
      await screen.findByRole('menuitem', { name: 'Paste' });
      expect(screen.queryByRole('menuitem', { name: 'Join with the text below' })).toBeNull();
    });
  });

  describe('adding a box of new text (ADR-0180 Decision 6)', () => {
    function mountAdding(blocks?: PageBlocks) {
      const inserts: { insert: PageInsert; version: number }[] = [];
      const onInsert = vi.fn((insert: PageInsert, read: BlocksRead) => {
        inserts.push({ insert, version: read.version });
        return Promise.resolve<BlockCommit>('written');
      });
      const onAdded = vi.fn();
      const made = mount({ adding: true, onInsert, onAdded, ...(blocks === undefined ? {} : { blocks }) });
      return { ...made, inserts, onAdded };
    }

    it('offers the empty page as a surface only while adding', () => {
      const adding = mountAdding();
      expect(adding.view.container.querySelector('[data-text-add-surface]')).not.toBeNull();
      adding.view.unmount();
      // CONTROL: plain Edit text has no such surface, so a press on the empty page is nothing there.
      const plain = mount();
      expect(plain.view.container.querySelector('[data-text-add-surface]')).toBeNull();
    });

    it('a press on the page opens a box there, and what is typed is added at that place, in the page’s points', async () => {
      const { view, inserts, onAdded } = mountAdding();
      fireEvent.click(find(view.container, '[data-text-add-surface]'), { clientX: 100, clientY: 200, detail: 1 });
      const editor = editorIn(view.container);
      typeInto(editor, 'A new note');
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      // THE PAGE IS 792 HIGH AT ZOOM 1: a press 200 down is 592 up, eight points under the paragraph (its box starts at
      // 600), so the box takes that paragraph's style (B4.3): 11 points, bold serif, its blue. The first baseline is an
      // ascent (0.8 of 11) below the press.
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.insert).toStrictEqual({
        left: 100,
        baseline: 583.2,
        measure: 360,
        size: 11,
        base: { family: 'Times New Roman', bold: true, italic: false, colour: { r: 20, g: 40, b: 60 } },
        text: 'A new note',
      });
      expect(inserts[0]?.version).toBe(7);
      expect(onAdded).toHaveBeenCalledTimes(1);
    });

    it('a box beside words whose font the page names is set in THAT font, by its name, and the page’s fonts are listed once each', async () => {
      const named = { ...STYLE, font: 'ABCDEF+Garamond' };
      const blocks: PageBlocks = {
        ...BLOCKS,
        blocks: BLOCKS.blocks.map((block) => ({
          ...block,
          style: named,
          lines: block.lines.map((line) => ({ ...line, runs: line.runs.map((run) => ({ ...run, style: named })) })),
        })),
      };
      expect(fontsOfPage(blocks.blocks)).toStrictEqual(['ABCDEF+Garamond']);
      const { view, inserts } = mountAdding(blocks);
      fireEvent.click(find(view.container, '[data-text-add-surface]'), { clientX: 100, clientY: 200, detail: 1 });
      const editor = editorIn(view.container);
      typeInto(editor, 'Beside it');
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(inserts[0]?.insert.base?.family).toBe('ABCDEF+Garamond');
    });

    it('CONTROL: on a page with no words the box starts in 12-point black Arial, so the case above is the nearby style', async () => {
      expect(nearbyStyle([], { x: 100, y: 592 })).toBeUndefined();
      // THE SAME PRESS AND WORDS on a page with no blocks: the size, the family and the colour the claim names, each read
      // from what is sent, since a default that was the paragraph's style above would differ from it in all three.
      const { view, inserts } = mountAdding({ ...BLOCKS, blocks: [] });
      fireEvent.click(find(view.container, '[data-text-add-surface]'), { clientX: 100, clientY: 200, detail: 1 });
      const editor = editorIn(view.container);
      typeInto(editor, 'A new note');
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.insert).toMatchObject({
        size: 12,
        base: { family: 'Arial', bold: false, italic: false, colour: { r: 0, g: 0, b: 0 } },
        text: 'A new note',
      });
      // AND THE NEAREST WINS, not the first: a press beside the heading takes the heading's.
      const [heading, paragraph] = BLOCKS.blocks;
      if (heading === undefined || paragraph === undefined) throw new Error('the fixture has two blocks');
      const near = (style: typeof STYLE, top: number) => ({ ...paragraph, box: { ...paragraph.box, y0: top - 10, y1: top }, style });
      expect(nearbyStyle([near(STYLE, 700), near(OTHER, 400)], { x: 100, y: 395 })?.size).toBe(9);
    });

    it('carries the marks the person gave the words, and has no handles of its own', async () => {
      const { view, inserts } = mountAdding();
      fireEvent.click(find(view.container, '[data-text-add-surface]'), { clientX: 100, clientY: 200, detail: 1 });
      expect(view.container.querySelectorAll('[data-handle]')).toHaveLength(0);
      const editor = editorIn(view.container);
      typeInto(editor, 'plain heavy');
      const text = editor.querySelector('div')?.firstChild;
      if (!(text instanceof Text)) throw new Error('no text typed');
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 11);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      fireEvent(document, new Event('selectionchange'));
      fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      // THE BOX OPENED IN THE NEARBY WORDS' STYLE, which is bold here (`STYLE`), so its words are bold by `base` and Ctrl+B
      // takes the bold OFF the chosen word. Until W4 the words typed beside the empty run were read as in no style at all,
      // so the press sent `bold: true` over bold words and changed nothing on the page.
      expect(inserts[0]?.insert.base?.bold).toBe(true);
      expect(inserts[0]?.insert.marks).toStrictEqual([{ from: 6, to: 11, set: { bold: false } }]);
    });

    it('and over words that are not bold, the same chord puts bold ON (EEEEEEEE-4)', async () => {
      // A PAGE WITH NO WORDS, so the box opens in regular Arial (the control above it): the opposite of the case before,
      // so a chord that always sent `false`, or always the opposite of `base`, could not pass both.
      const { view, inserts } = mountAdding({ ...BLOCKS, blocks: [] });
      fireEvent.click(find(view.container, '[data-text-add-surface]'), { clientX: 100, clientY: 200, detail: 1 });
      const editor = editorIn(view.container);
      typeInto(editor, 'plain heavy');
      const text = editor.querySelector('div')?.firstChild;
      if (!(text instanceof Text)) throw new Error('no text typed');
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 11);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      fireEvent(document, new Event('selectionchange'));
      fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(inserts[0]?.insert.base?.bold).toBe(false);
      expect(inserts[0]?.insert.marks).toStrictEqual([{ from: 6, to: 11, set: { bold: true } }]);
    });

    it('CONTROL: a block clicked while adding is still edited, since the surface is under the outlines', () => {
      const { view } = mountAdding();
      fireEvent.click(find(view.container, '[data-text-block="1"]'));
      expect(editorIn(view.container).textContent).toContain('Helps with care and support');
      expect(view.container.querySelector('[data-text-add-surface]')).not.toBeNull();
    });
  });

  describe('a click from block to block (ADR-0180 Decision 8)', () => {
    /** A commit the test settles itself, so the sequence between the click and the answer can be looked at. */
    function mountDeferred() {
      const settle: { resolve: (outcome: BlockCommit) => void } = { resolve: () => undefined };
      const commits: string[] = [];
      const onCommit = vi.fn((_block: TextBlock, text: string) => {
        commits.push(text);
        return new Promise<BlockCommit>((resolve) => {
          settle.resolve = resolve;
        });
      });
      const made = mount({ onCommit });
      return { ...made, commits, settle };
    }

    it('writes the open block FIRST, keeps its words on screen meanwhile, and opens the next in the read that follows', async () => {
      const { view, commits, settle, show } = mountDeferred();
      fireEvent.click(find(view.container, '[data-text-block="0"]'));
      typeInto(editorIn(view.container), 'WORK HISTORY');
      await act(async () => {
        fireEvent.click(find(view.container, '[data-text-block="1"]'));
        await Promise.resolve();
      });
      // THE WORDS ARE STILL THE ONES TYPED, in the one editor there is, which is not editable while they are in flight.
      const editors = view.container.querySelectorAll('[data-text-editor]');
      expect(editors).toHaveLength(1);
      expect(editors[0]?.textContent).toBe('WORK HISTORY');
      expect(editors[0]?.getAttribute('contenteditable')).toBe('false');
      expect(commits).toStrictEqual(['WORK HISTORY']);
      await act(async () => {
        settle.resolve('written');
        await Promise.resolve();
      });
      // THE READ AFTER THE WRITE, the same blocks at the next version: the block that was clicked opens, with its own words.
      await act(async () => {
        show({ ...BLOCKS, version: asDocVersion(8) });
        await Promise.resolve();
      });
      const opened = editorIn(view.container);
      expect(opened.textContent).toContain('Helps with care and support');
      expect(commits).toHaveLength(1);
    });

    it('CONTROL: a block clicked with nothing open opens at once, as it always did', () => {
      const { view } = mountDeferred();
      fireEvent.click(find(view.container, '[data-text-block="1"]'));
      expect(editorIn(view.container).textContent).toContain('Helps with care and support');
    });

    it('a REFUSED write keeps the open block and its words, and the block clicked does not open over them', async () => {
      const { view, settle, commits } = mountDeferred();
      fireEvent.click(find(view.container, '[data-text-block="0"]'));
      typeInto(editorIn(view.container), 'WORK HISTORY');
      await act(async () => {
        fireEvent.click(find(view.container, '[data-text-block="1"]'));
        await Promise.resolve();
      });
      await act(async () => {
        settle.resolve({ refused: { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } } });
        await Promise.resolve();
      });
      expect(view.container.querySelectorAll('[data-text-editor]')).toHaveLength(1);
      expect(view.container.querySelector('[data-text-editor]')?.textContent).toBe('WORK HISTORY');
      expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
      // AND A FURTHER CLICK on that other block changes nothing either: the words are kept until the person decides.
      await act(async () => {
        fireEvent.click(find(view.container, '[data-text-block="1"]'));
        await Promise.resolve();
      });
      expect(view.container.querySelector('[data-text-editor]')?.textContent).toBe('WORK HISTORY');
      // THE DECISION, not the state (VVVVVVV-19): the refused words are NOT sent again. The editor showing them is also
      // what a missing guard leaves, since a second refusal keeps them too; the count is what only the guard keeps.
      expect(commits).toStrictEqual(['WORK HISTORY']);
    });
  });

  it('CONTROL: a block WRITTEN closes the editor, through the same finish — once the page has the read after it (ADR-0261)', async () => {
    const { view, answerWith, show } = mount();
    answerWith('written');
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    typeInto(editorIn(view.container), 'WORK EXPERIENCE');
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    // HELD AS THE WORDS' LOOK until the page draws them (Decision 7), and locked, so nothing typed now is lost.
    const held = find(view.container, '[data-text-editor]');
    expect(held.textContent).toBe('WORK EXPERIENCE');
    expect(held.getAttribute('contenteditable')).toBe('false');
    // THE READ AFTER THE WRITE, which `TextEditPage` hands down once the page is drawn from it: the editor leaves with
    // the read it was opened over.
    show({ ...BLOCKS, version: asDocVersion(Number(BLOCKS.version) + 1) });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
  });

  it('A SIGNED DOCUMENT LEFT AS IT WAS keeps the editor and the words, and a blur does not ask again (ADR-0149)', async () => {
    const { view, answerWith, commits } = mount();
    answerWith('held');
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    typeInto(editor, 'WORK HISTORY');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).not.toBeNull();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('signatures still verify');
    // A FOCUS THE CLOSING DIALOG MOVES writes nothing: the question is asked once per finish, not once per blur.
    await act(async () => {
      fireEvent.blur(find(view.container, '[data-text-editor]'));
      await Promise.resolve();
    });
    expect(commits).toHaveLength(1);
    // AND ESCAPE PUTS THE TEXT BACK, as after the font's refusal.
    await act(async () => {
      fireEvent.keyDown(find(view.container, '[data-text-editor]'), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
  });

  /**
   * The paragraph as a write that ran past the page leaves it, read again: its first line where it was, and six lines
   * reaching below the page's foot (the owner's Q7). `bottom` is where its last line's ink ends, in PDF space, so one
   * fixture states both the read that is past the page and the control that is not.
   */
  const grown = (bottom: number): PageBlocks => {
    const typed = ['Helps with care and support', 'at every stage.', 'A third line', 'a fourth', 'a fifth', 'LAST LINE'];
    const pitch = (636 - bottom) / (typed.length - 1);
    const [heading] = BLOCKS.blocks;
    if (heading === undefined) throw new Error('the fixture lost its heading');
    return {
      ...BLOCKS,
      version: asDocVersion(8),
      blocks: [
        heading,
        {
          box: { x0: 72, y0: bottom, x1: 400, y1: 650 },
          lines: typed.map((text, at) => ({
            runs: [{ index: 20 + at, text, style: STYLE }],
            box: { x0: 72, y0: 636 - at * pitch, x1: 300, y1: 650 - at * pitch },
            soft: false,
            baseline: 639 - at * pitch,
          })),
          style: STYLE,
          shape: LEFT,
          push: NO_PUSH,
        },
      ],
    };
  };
  const TYPED = 'Helps with care and support\nat every stage.\nA third line\na fourth\na fifth\nLAST LINE';

  it('A WRITE THAT RUNS PAST THE PAGE reopens the editor over it with EVERY word, and says it no longer fits (Q7)', async () => {
    const { view, answerWith, show } = mount();
    answerWith('written');
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    typeInto(editorIn(view.container), TYPED);
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    // WRITTEN: the editor is held, locked, until the read after the write arrives — here with the block past the page's foot.
    expect(find(view.container, '[data-text-editor]').getAttribute('contenteditable')).toBe('false');
    show(grown(-30));
    const editor = editorIn(view.container);
    // NOTHING TYPED IS LOST: every line, the last below the page, is in the editor the person sees.
    for (const line of TYPED.split('\n')) expect(editor.textContent).toContain(line);
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe('This text no longer fits on the page');
  });

  it('CONTROL: a write whose read FITS the page reopens nothing and says nothing', async () => {
    const { view, answerWith, show } = mount();
    answerWith('written');
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    typeInto(editorIn(view.container), TYPED);
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    show(grown(540));
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
    expect(view.container.textContent).not.toContain('no longer fits');
  });

  /** A block of one line at `y0`..`y0 + 10`, beside the paragraph the write grows down to 540. */
  const beside = (y0: number): PageBlocks['blocks'][number] => ({
    box: { x0: 80, y0, x1: 200, y1: y0 + 10 },
    lines: [{ runs: [{ index: 60, text: 'Footnote', style: STYLE }], box: { x0: 80, y0, x1: 200, y1: y0 + 10 }, soft: false, baseline: y0 + 2 }],
    style: STYLE,
    shape: LEFT,
    push: NO_PUSH,
  });
  const COVERS = 'The words you wrote now run over something else on this page';
  /** Writes the paragraph so its read comes back grown to 540, with `others` beside it on the page. */
  const writeGrown = async (made: ReturnType<typeof mount>, others: PageBlocks['blocks']) => {
    made.answerWith('written');
    fireEvent.click(find(made.view.container, '[data-text-block="1"]'));
    typeInto(editorIn(made.view.container), TYPED);
    await act(async () => {
      fireEvent.keyDown(editorIn(made.view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    const read = grown(540);
    await act(async () => {
      made.show({ ...read, blocks: [...read.blocks, ...others] });
      await Promise.resolve();
    });
  };

  it('A WRITE THAT GROWS OVER OTHER WORDS says so, with how to put it back (B1.6)', async () => {
    const made = mount();
    await writeGrown(made, [beside(550)]);
    expect(made.view.container.textContent).toContain(COVERS);
  });

  it('CONTROL: words the block ALREADY ran over before the write are not news, and growth over nothing says nothing', async () => {
    const already = mount();
    await writeGrown(already, [beside(610)]);
    expect(already.view.container.textContent).not.toContain(COVERS);
    const clear = mount();
    await writeGrown(clear, [beside(400)]);
    expect(clear.view.container.textContent).not.toContain(COVERS);
  });

  it('a write that grows over a PICTURE OR DRAWING says so, from the page’s objects at the same version (B1.6)', async () => {
    const objects = vi.fn(() => Promise.resolve({ version: asDocVersion(8), boxes: [{ x0: 90, y0: 545, x1: 150, y1: 580 }] }));
    const made = mount({ objects });
    await writeGrown(made, []);
    expect(made.view.container.textContent).toContain(COVERS);
    // ONE READ for the write, not one per render.
    expect(objects).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: objects answered at ANOTHER version say nothing, nor does an object the write did not reach', async () => {
    const stale = mount({
      objects: () => Promise.resolve({ version: asDocVersion(7), boxes: [{ x0: 90, y0: 545, x1: 150, y1: 580 }] }),
    });
    await writeGrown(stale, []);
    expect(stale.view.container.textContent).not.toContain(COVERS);
    const away = mount({
      objects: () => Promise.resolve({ version: asDocVersion(8), boxes: [{ x0: 90, y0: 100, x1: 150, y1: 200 }] }),
    });
    await writeGrown(away, []);
    expect(away.view.container.textContent).not.toContain(COVERS);
  });

  it('the REOPENED editor closes on Escape with nothing to write, and stays closed; the page then says why', async () => {
    const { view, answerWith, show } = mount();
    answerWith('written');
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    typeInto(editorIn(view.container), TYPED);
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    show(grown(-30));
    answerWith('unchanged');
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
    // THE SAME READ AGAIN reopens nothing: the reopening ended with the editor it opened.
    show({ ...grown(-30) });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
    // AND THE BLOCK IS OUTLINED APART, named as past the page, with the page's note; the block on the page is not.
    const past = find(view.container, '[data-text-block="1"]');
    expect(past.className).toContain('m-text-block--past');
    expect(past.getAttribute('aria-description')).toBe('This text no longer fits on the page');
    expect(find(view.container, '[data-text-block="0"]').className).not.toContain('m-text-block--past');
    // SAID AT THE BLOCK, for it alone: the block on the page has no sentence beside it.
    expect(find(view.container, '[data-text-block-past="1"]').textContent).toBe('This text no longer fits on the page');
    expect(view.container.querySelector('[data-text-block-past="0"]')).toBeNull();
  });

  describe('formatting (ADR-0180)', () => {
    /** The editor open on block 0 with its first text node selected from `from` to `to`, and every commit's formatting kept. */
    function openWithSelection(from: number, to: number, blockAt = 1, nodeAt = 0) {
      const formats: (BlockFormatting | undefined)[] = [];
      const onCommit = vi.fn((_block: TextBlock, _text: string, _read: BlocksRead, formatting?: BlockFormatting) => {
        formats.push(formatting);
        return Promise.resolve<BlockCommit>('written');
      });
      const made = mount({ onCommit });
      fireEvent.click(find(made.view.container, `[data-text-block="${String(blockAt)}"]`));
      const editor = editorIn(made.view.container);
      const walker = document.createTreeWalker(editor, 4);
      let node = walker.nextNode();
      for (let skip = 0; skip < nodeAt; skip += 1) node = walker.nextNode();
      if (!(node instanceof Text)) throw new Error('the editor holds no text');
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      fireEvent(document, new Event('selectionchange'));
      return { ...made, editor, formats };
    }

    it('Ctrl+B bolds the selected words, and the write carries a mark over exactly those words', async () => {
      // "and" of the second run, which the page sets regular: the first line's first run is 16 characters long.
      const { editor, formats } = openWithSelection(0, 3, 1, 1);
      fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats).toHaveLength(1);
      expect(formats[0]?.marks).toStrictEqual([{ from: 16, to: 19, set: { bold: true } }]);
    });

    it('CONTROL: on words the page already sets bold, the same chord takes it off, so a toggle reads the words and not a constant', async () => {
      const { editor, formats } = openWithSelection(0, 4, 0);
      fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats[0]?.marks?.[0]?.set).toStrictEqual({ bold: false });
    });

    it('L2: words the page carries underlined are drawn underlined, and Ctrl+U takes it off; plain words take it on', async () => {
      const underlinedBlocks: PageBlocks = {
        ...BLOCKS,
        blocks: BLOCKS.blocks.map((block, at) =>
          at === 0
            ? { ...block, lines: block.lines.map((line) => ({ ...line, runs: line.runs.map((run) => ({ ...run, style: { ...run.style, underline: true as const } })) })) }
            : block,
        ),
      };
      const formats: (BlockFormatting | undefined)[] = [];
      const onCommit = vi.fn((_block: TextBlock, _text: string, _read: BlocksRead, formatting?: BlockFormatting) => {
        formats.push(formatting);
        return Promise.resolve<BlockCommit>('written');
      });
      const made = mount({ onCommit, blocks: underlinedBlocks });
      fireEvent.click(find(made.view.container, '[data-text-block="0"]'));
      const editor = editorIn(made.view.container);
      const run = editor.querySelector<HTMLElement>('.m-text-editor__run');
      // DRAWN AS THE PAGE HAS IT while the block is open.
      expect(run?.style.textDecoration).toContain('underline');
      const words = run?.firstChild;
      if (!(words instanceof Text)) throw new Error('the run holds no words');
      const range = document.createRange();
      range.setStart(words, 0);
      range.setEnd(words, 4);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      fireEvent(document, new Event('selectionchange'));
      fireEvent.keyDown(editor, { key: 'u', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats[0]?.marks?.[0]?.set).toStrictEqual({ underline: false });
    });

    it('CONTROL (L2): on words the page carries plain, the same chord takes the underline on', async () => {
      const { editor, formats } = openWithSelection(0, 4, 0);
      expect(editor.querySelector<HTMLElement>('.m-text-editor__run')?.style.textDecoration ?? '').not.toContain('underline');
      fireEvent.keyDown(editor, { key: 'u', ctrlKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats[0]?.marks?.[0]?.set).toStrictEqual({ underline: true });
    });

    it('CONTROL: with nothing formatted the write carries no marks, so the case above is the chord and not a default', async () => {
      const { editor, formats } = openWithSelection(0, 4);
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats[0]?.marks).toBeUndefined();
    });

    it('Tab inserts spaces and keeps the focus in the words, where it would have left them', () => {
      const { editor } = openWithSelection(0, 0);
      const before = editor.textContent;
      const event = fireEvent.keyDown(editor, { key: 'Tab' });
      // `fireEvent` answers false when the default was prevented: the browser's move of the focus did not happen.
      expect(event).toBe(false);
      expect(editor.textContent.length).toBeGreaterThan(before.length);
    });

    it('a focus that moves into the Properties panel’s text section does not write, and one that leaves both does', async () => {
      const { view, editor, formats } = openWithSelection(0, 4);
      const section = find(view.container, '[data-text-properties]');
      const field = find(section, 'input[type="number"]');
      await act(async () => {
        fireEvent.blur(editor, { relatedTarget: field });
        await Promise.resolve();
      });
      expect(formats).toHaveLength(0);
      expect(view.container.querySelector('[data-text-editor]')).not.toBeNull();
      // LEFT FROM THE SECTION to nothing: the section finishes the edit, since the words' own blur has passed.
      await act(async () => {
        fireEvent.blur(field, { relatedTarget: null });
        await Promise.resolve();
      });
      expect(formats).toHaveLength(1);
    });

    it('CONTROL: a focus moving from the section BACK INTO THE WORDS does not write', async () => {
      const { view, editor, formats } = openWithSelection(0, 4);
      const field = find(find(view.container, '[data-text-properties]'), 'input[type="number"]');
      await act(async () => {
        fireEvent.blur(editor, { relatedTarget: field });
        fireEvent.blur(field, { relatedTarget: editor });
        await Promise.resolve();
      });
      expect(formats).toHaveLength(0);
    });

    it('a press on a section button keeps the focus in the editor, and a press on a field does not', () => {
      const { view } = openWithSelection(0, 4);
      const section = find(view.container, '[data-text-properties]');
      expect(fireEvent.mouseDown(find(section, 'button[aria-label="Bold"]'))).toBe(false);
      expect(fireEvent.mouseDown(find(section, 'input'))).toBe(true);
    });

    it('Ctrl+E centres the paragraph and Ctrl+Shift+> sets the next size up, both from the keys alone', async () => {
      const { editor, formats } = openWithSelection(0, 4);
      fireEvent.keyDown(editor, { key: 'e', ctrlKey: true });
      fireEvent.keyDown(editor, { key: '>', code: 'Period', ctrlKey: true, shiftKey: true });
      await act(async () => {
        fireEvent.keyDown(editor, { key: 'Escape' });
        await Promise.resolve();
      });
      expect(formats[0]?.paragraphs?.[0]?.align).toBe('center');
      // THE BLOCK IS SET AT 11 POINTS, so a step up is 12, the next on the list.
      expect(formats[0]?.marks?.[0]?.set.size).toBe(12);
    });
  });

  it('a page whose read was REFUSED says so on that page, and a page still being read says nothing', () => {
    const refused = mount({ blocks: undefined, unreadable: true });
    expect(refused.view.container.textContent).toContain('text could not be read');
    refused.view.unmount();
    // CONTROL: no blocks and no refusal is a read in flight, which is not a sentence.
    const reading = mount({ blocks: undefined });
    expect(reading.view.container.textContent).not.toContain('could not be read');
  });

  it('ESCAPE WITH NO BLOCK OPEN leaves the mode', () => {
    const { view, onLeave } = mount();
    fireEvent.keyDown(find(view.container, '[data-text-edit-layer]'), { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('a page with NO editable text says so, and one with blocked-in text offers to unpack it WHERE THAT KEEPS THE PAGE', () => {
    const empty = mount({ blocks: { ...BLOCKS, blocks: [] } });
    expect(empty.view.container.textContent).toContain('This page has no text that can be edited.');
    empty.view.unmount();

    // THE READ SAID UNPACKING KEEPS THE PAGE (ADR-0232's correction of 2026-10-24): the button is offered.
    const packed = mount({ blocks: { ...BLOCKS, unaddressable: 36, unpackable: true } });
    fireEvent.click(packed.view.getByRole('button', { name: /Unpack it/u }));
    expect(packed.onPromote).toHaveBeenCalledTimes(1);
    // CONTROL: a page with blocks and nothing packed says neither sentence.
    expect(packed.view.container.textContent).not.toContain('no text that can be edited');
    packed.view.unmount();

    // AND WHERE IT WOULD NOT (it moves other text, or takes nothing out): the note says so plainly, and NO button.
    const kept = mount({ blocks: { ...BLOCKS, unaddressable: 36 } });
    expect(kept.view.queryByRole('button', { name: /Unpack it/u })).toBeNull();
    expect(kept.view.container.textContent).toContain('held inside a block that can’t be edited here');
  });

  it('a page with no text offers to RECOGNISE it, and only then: a page with blocks does not (ADR-0181 Decision 9)', () => {
    const onRecognise = vi.fn();
    const empty = mount({ blocks: { ...BLOCKS, blocks: [] }, onRecognise });
    fireEvent.click(empty.view.getByRole('button', { name: /recognise its words/u }));
    expect(onRecognise).toHaveBeenCalledTimes(1);
    empty.view.unmount();
    // CONTROL: the same offer is not made over text that is already there, nor where nothing can recognise.
    const withText = mount({ onRecognise });
    expect(withText.view.queryByRole('button', { name: /recognise its words/u })).toBeNull();
    withText.view.unmount();
    const nowhere = mount({ blocks: { ...BLOCKS, blocks: [] } });
    expect(nowhere.view.queryByRole('button', { name: /recognise its words/u })).toBeNull();
  });

  it('names each KIND of text it will not edit, so a person is told which text and why (ADR-0181)', () => {
    const angled = (set: Partial<PageBlocks['angled']>): PageBlocks => ({
      ...BLOCKS,
      rotated: Object.values(set).reduce((total, count) => total + count, 0),
      angled: { turned: 0, vertical: 0, slanted: 0, mirrored: 0, ...set },
    });
    const kinds = [
      ['turned', 'Text turned at an angle'],
      ['vertical', 'Text that runs up or down'],
      ['slanted', 'Text this page slants itself'],
      ['mirrored', 'Mirrored text'],
    ] as const;
    for (const [kind, sentence] of kinds) {
      const made = mount({ blocks: angled({ [kind]: 12 }) });
      expect(made.view.container.textContent, kind).toContain(sentence);
      // CONTROL: only the kind the page has is named, so the sentences are not all printed for any angled text.
      for (const [other, otherSentence] of kinds) {
        if (other !== kind) expect(made.view.container.textContent, `${kind} page says ${other}`).not.toContain(otherSentence);
      }
      made.view.unmount();
    }
    const plain = mount();
    for (const [, sentence] of kinds) expect(plain.view.container.textContent).not.toContain(sentence);
  });

  it('SAYS SO when the page has more text than one answer can outline, and outlines what it has (the owner’s L6)', () => {
    const cut = mount({ blocks: { ...BLOCKS, truncated: true } });
    expect(cut.view.container.textContent).toContain('This page has more text than can be outlined at once');
    // WHAT CAME IS STILL OUTLINED: the sentence is beside the blocks, never instead of them.
    expect(cut.view.container.querySelectorAll('[data-text-block]')).toHaveLength(BLOCKS.blocks.length);
    cut.view.unmount();
    // CONTROL: a page read whole says nothing about it.
    const whole = mount();
    expect(whole.view.container.textContent).not.toContain('more text than can be outlined');
  });
});

/**
 * A run drawn in the font the host rebuilt from its own program (ADR-0175), through the editor's one read of them.
 *
 * The browser's font loading is a fake here, recording what is built, added and removed — happy-dom loads no font, and
 * what these cases own is which runs take which face and that the faces leave with the editor. That a face built from
 * bytes DRAWS under the pinned policy is the rendered case's, on Chromium.
 */
describe('Edit text draws each run in its own font where the host rebuilt one (ADR-0175)', () => {
  class FakeFace {
    static built: FakeFace[] = [];
    static refuse = false;
    constructor(
      readonly family: string,
      readonly bytes: Uint8Array,
      readonly descriptors?: FontFaceDescriptors,
    ) {
      FakeFace.built.push(this);
    }
    load(): Promise<this> {
      return FakeFace.refuse ? Promise.reject(new Error('the sanitiser refused the font')) : Promise.resolve(this);
    }
  }

  function withFonts(): { readonly added: unknown[]; readonly removed: unknown[] } {
    FakeFace.built = [];
    FakeFace.refuse = false;
    const added: unknown[] = [];
    const removed: unknown[] = [];
    vi.stubGlobal('FontFace', FakeFace);
    // AN EVENT TARGET, as Chromium's font set is: the editor listens on it for a font's arrival (`useBaselineShift`).
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: Object.assign(new EventTarget(), { add: (face: unknown) => added.push(face), delete: (face: unknown) => removed.push(face) }),
    });
    return { added, removed };
  }

  /** The paragraph's first and last runs share one font; the grey run between them has none. */
  const FONT = new Uint8Array([0, 1, 0, 0, 7]);
  const SHARED: RunFonts = { fonts: [FONT], runs: new Map([[8, 0], [11, 0]]) };

  /** Each run of the open editor: its first object, whether it took its own face, and the face it names. */
  function runsOf(root: ParentNode): [string | undefined, boolean, string][] {
    return Array.from(root.querySelectorAll<HTMLElement>('.m-text-editor__run'), (span) => [
      span.dataset['run'],
      span.classList.contains('m-text-editor__run--own'),
      span.style.getPropertyValue('--m-run-font'),
    ]);
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    });
  }

  it('reads the open block’s fonts ONCE, and draws the runs that share one in it while the run with none keeps its kind', async () => {
    const { added } = withFonts();
    const read = vi.fn((_block: TextBlock, _read: BlocksRead) => Promise.resolve(SHARED));
    const { view, show } = mount({ runFonts: read });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0].lines.map((line) => line.runs.map((run) => run.index))).toStrictEqual([[8, 9], [11]]);
    expect(read.mock.calls[0]?.[1].version).toBe(7);
    // ONE FACE for the one font, built from its bytes, and added to the document's fonts.
    expect(FakeFace.built.map((face) => Array.from(face.bytes))).toStrictEqual([[0, 1, 0, 0, 7]]);
    expect(added).toStrictEqual(FakeFace.built);
    const family = FakeFace.built[0]?.family ?? '';
    expect(family).toMatch(/^m-run-[a-zA-Z0-9]+-0$/u);
    expect(runsOf(view.container)).toStrictEqual([
      ['8', true, family],
      ['9', false, ''],
      ['11', true, family],
    ]);
    // CONTROL: a render with the editor still open — the layer hands it a new function — reads nothing again.
    show(BLOCKS);
    fireEvent.input(editorIn(view.container));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
  });

  /**
   * EACH FACE DECLARES THE WEIGHT AND SLANT THE PAGE STATES for its runs (the owner's N14): the bold runs' face is 700
   * upright and the grey italic run's 400 italic, so the browser draws each program as it is and emboldens or slants
   * none of them a second time. CONTROL: the two faces declare differently, so a declaration copied from one run to every
   * face, or left out, fails one of them.
   */
  it('declares each face with the weight and slant its page runs have, so the browser synthesises neither', async () => {
    withFonts();
    const twoFonts: RunFonts = { fonts: [FONT, new Uint8Array([0, 1, 0, 0, 9])], runs: new Map([[8, 0], [9, 1], [11, 0]]) };
    const { view } = mount({ runFonts: () => Promise.resolve(twoFonts) });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(FakeFace.built.map((face) => face.descriptors)).toStrictEqual([
      { weight: '700', style: 'normal' },
      { weight: '400', style: 'italic' },
    ]);
  });

  it('the faces LEAVE WITH THE EDITOR: removed when it closes, and none before', async () => {
    const { added, removed } = withFonts();
    const { view, show } = mount({ runFonts: () => Promise.resolve(SHARED) });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
    // STILL DRAWN IN THEM while held as the words' look (ADR-0261 Decision 7), and gone with the editor.
    expect(removed).toHaveLength(0);
    show({ ...BLOCKS, version: asDocVersion(8) });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
    expect(removed).toStrictEqual(added);
  });

  it('a face the browser REFUSES to load leaves its runs in their kind and says so on them, adding nothing', async () => {
    const { added } = withFonts();
    FakeFace.refuse = true;
    const { view } = mount({ runFonts: () => Promise.resolve(SHARED) });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(added).toHaveLength(0);
    expect(runsOf(view.container).map(([, own]) => own)).toStrictEqual([false, false, false]);
    expect(
      Array.from(view.container.querySelectorAll<HTMLElement>('.m-text-editor__run'), (span) => span.dataset['runFont'] ?? null),
    ).toStrictEqual(['refused', null, 'refused']);
  });

  /**
   * A SUPERSCRIPT STAYS RAISED while its block is open (the owner's N14): the run is drawn at the rise main answers, a
   * length CSS raises the baseline by, at the zoom. CONTROL: the line's other runs are not moved, so the rise is the run's.
   */
  it('draws a run at its rise from the line, and leaves the line’s own runs on it', () => {
    const SUPER = { ...OTHER, rise: 3.96 };
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture has two blocks');
    const raised: PageBlocks = {
      ...BLOCKS,
      blocks: [
        heading,
        {
          ...paragraph,
          lines: [
            {
              runs: [
                { index: 8, text: 'Helps with care', style: STYLE },
                { index: 9, text: '12', style: SUPER },
              ],
              box: { x0: 72, y0: 636, x1: 400, y1: 650 },
              soft: false,
              baseline: 639,
            },
          ],
        },
      ],
    };
    const { view } = mount({ blocks: raised });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const aligns = Array.from(view.container.querySelectorAll<HTMLElement>('.m-text-editor__run'), (span) => span.style.verticalAlign);
    expect(aligns).toStrictEqual(['', '3.96px']);
  });

  it('CONTROL: with no fonts answered nothing is built and every run keeps its kind', async () => {
    const { added } = withFonts();
    const { view } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(FakeFace.built).toHaveLength(0);
    expect(added).toHaveLength(0);
    expect(runsOf(view.container)).toStrictEqual([
      ['8', false, ''],
      ['9', false, ''],
      ['11', false, ''],
    ]);
  });
});

describe('the text below a growing block, shown before the write (ADR-0249 Decision 5)', () => {
  /** The editor's observed size, and the one observer happy-dom lacks: the case says when the words grow. */
  let resize: (() => void) | undefined;
  class StandInObserver {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe(): void {
      resize?.();
    }
    disconnect(): void {
      resize = undefined;
    }
  }
  const [heading, paragraph] = BLOCKS.blocks;
  if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost its blocks');
  /** The paragraph pushing the heading's copy placed under it, with `room` points of room. */
  const pushingPage = (room: number): PageBlocks => ({
    ...BLOCKS,
    blocks: [
      { ...paragraph, push: { below: [1], room } },
      { ...heading, box: { x0: 72, y0: 560, x1: 300, y1: 590 }, push: NO_PUSH },
    ],
  });
  /**
   * Opens the paragraph, then grows its words to `height` pixels. It opens at its own two lines at their 14-point pitch,
   * 28 pixels at zoom 1, which is what the growth is measured from.
   */
  /** What the last {@link grownTo} wrote, for the case that asserts the write. */
  let lastCommits: readonly { readonly text: string }[] = [];
  const grownTo = (room: number, height: number, pictureOf?: () => HTMLCanvasElement) => {
    vi.stubGlobal('ResizeObserver', StandInObserver);
    const { view, commits } = mount({ blocks: pushingPage(room), ...(pictureOf === undefined ? {} : { pictureOf }) });
    lastCommits = commits;
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    Object.defineProperty(editor, 'offsetHeight', { configurable: true, value: 28 });
    act(() => resize?.());
    typeInto(editor, 'Helps with care and support at every stage, and a good deal more besides.');
    Object.defineProperty(editor, 'offsetHeight', { configurable: true, value: height });
    act(() => resize?.());
    vi.unstubAllGlobals();
    return view;
  };

  /** Every sentence the open editor shows under or above its words. */
  const said = (view: ReturnType<typeof grownTo>): string[] =>
    [...view.container.querySelectorAll('.m-text-editor-problem')].map((element) => element.textContent);

  it('WHERE THERE IS NO ROOM, nothing is said and nothing outlined, the text below stays, and the words are written as typed (R10)', async () => {
    const view = grownTo(10, 58);
    expect(said(view)).toStrictEqual([]);
    expect(view.container.querySelector('[data-text-overlap]')).toBeNull();
    expect(view.container.querySelector('[data-text-pushed="1"]')).toBeNull();
    // THE WRITE IS THE WORDS AS TYPED, sent like any other.
    const editor = editorIn(view.container);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(lastCommits.map((commit) => commit.text)).toStrictEqual(['Helps with care and support at every stage, and a good deal more besides.']);
  });

  it('WITHIN THE ROOM, the text below is drawn moved down by the growth, and nothing is said', () => {
    // A STAND-IN FOR THE PAGE'S PIXELS: happy-dom draws no canvas, and the copy is drawn only where a context exists.
    const picture = { width: 4, height: 2 } as HTMLCanvasElement;
    const view = grownTo(100, 58, () => picture);
    const moved = find(view.container, '[data-text-pushed="1"]');
    // THIRTY PIXELS AT ZOOM 1 is thirty points: the copy's top is the heading's (792 − 590 = 202) and thirty more.
    expect(moved.style.top).toBe('232px');
    expect(view.container.querySelector('[data-text-pushed-cover="1"]')).not.toBeNull();
    expect(view.container.querySelector('[data-text-edit-crowded]')).toBeNull();
  });

  it('OPENING a block its editor lays out a line taller, NOTHING TYPED, moves nothing and says nothing (R10)', () => {
    vi.stubGlobal('ResizeObserver', StandInObserver);
    // ROOM BELOW, so a misread growth would show as the next row drawn pushed down.
    const { view } = mount({ blocks: pushingPage(100), pictureOf: () => ({ width: 4, height: 2 }) as HTMLCanvasElement });
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    // THREE LINES WHERE THE PAGE HAD TWO, as a face wider than the page's wraps a narrow cell's words once more: 42
    // pixels against the block's own 28. Before the correction this read as 14 pixels of growth on opening.
    Object.defineProperty(editor, 'offsetHeight', { configurable: true, value: 42 });
    act(() => resize?.());
    vi.unstubAllGlobals();
    expect(view.container.querySelector('[data-text-pushed="1"]')).toBeNull();
    expect(view.container.querySelector('.m-text-editor-problem')).toBeNull();
  });

  it('…and once typed into, it grows FROM the height it opened at, not the page’s', () => {
    vi.stubGlobal('ResizeObserver', StandInObserver);
    const picture = { width: 4, height: 2 } as HTMLCanvasElement;
    const { view } = mount({ blocks: pushingPage(100), pictureOf: () => picture });
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    Object.defineProperty(editor, 'offsetHeight', { configurable: true, value: 42 });
    act(() => resize?.());
    typeInto(editor, 'Helps with care and support at every stage, and a good deal more besides.');
    Object.defineProperty(editor, 'offsetHeight', { configurable: true, value: 56 });
    act(() => resize?.());
    vi.unstubAllGlobals();
    // FOURTEEN PIXELS, one line, from 42 — not twenty-eight from the page's 28: the heading's copy at 202 + 14.
    expect(find(view.container, '[data-text-pushed="1"]').style.top).toBe('216px');
  });

  it('CONTROL: words that did not grow move nothing and say nothing', () => {
    const view = grownTo(10, 28, () => ({ width: 4, height: 2 }) as HTMLCanvasElement);
    expect(view.container.querySelector('[data-text-pushed="1"]')).toBeNull();
    expect(view.container.querySelector('[data-text-edit-crowded]')).toBeNull();
  });
});
