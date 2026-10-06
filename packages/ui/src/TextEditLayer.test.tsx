// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { BlockFormatting, EditedBlock, PageInsert } from '@monstera/contract';
import { asDocVersion, type MessageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type BlockCommit,
  type BlocksRead,
  NO_RUN_FONTS,
  type RunFonts,
  type TextBlock,
} from './commands/documentCommands.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN, SPELLING_DICTIONARY_FULL } from './messages/en.js';
import { type PageBlocks, TextEditLayer } from './TextEditLayer.js';

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

/** Two blocks: a paragraph of two lines, and a heading far above it. */
const BLOCKS: PageBlocks = {
  version: asDocVersion(7),
  blocks: [
    {
      box: { x0: 72, y0: 700, x1: 300, y1: 740 },
      lines: [
        { runs: [{ index: 5, text: 'WORK EXPERIENCE', style: STYLE }], box: { x0: 72, y0: 700, x1: 300, y1: 740 }, soft: false },
      ],
      style: STYLE,
      shape: LEFT,
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
        },
        {
          runs: [{ index: 11, text: 'at every stage.', style: STYLE }],
          box: { x0: 72, y0: 622, x1: 260, y1: 636 },
          soft: false,
        },
      ],
      style: STYLE,
      shape: LEFT,
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
    expect(editor.style.backgroundColor).toBe('rgb(250, 250, 250)');
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

  it('sets the editor in the SHAPE the read found: a centred block is centred, an indented first line is indented (ADR-0179)', async () => {
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost a block');
    const shaped: PageBlocks = {
      ...BLOCKS,
      blocks: [
        { ...heading, shape: { align: 'center', firstIndent: 0 } },
        { ...paragraph, shape: { align: 'left', firstIndent: 24 } },
      ],
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
    const indented = editorIn(view.container);
    expect(indented.style.textAlign).toBe('left');
    expect(indented.style.textIndent).toBe('24px');
  });

  it('a HANGING indent pads the block in and takes the first line back out, since the box starts at that line', () => {
    const [heading, paragraph] = BLOCKS.blocks;
    if (heading === undefined || paragraph === undefined) throw new Error('the fixture lost a block');
    const { view } = mount({
      blocks: { ...BLOCKS, blocks: [heading, { ...paragraph, shape: { align: 'left', firstIndent: -12 } }] },
    });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    expect(editor.style.paddingLeft).toBe('12px');
    expect(editor.style.textIndent).toBe('-12px');
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

  it('draws the editor’s paper as a gradient where the page behind it is shaded, and flat where it is not', () => {
    const shaded = mount({ paperAt: (_x, y) => (y < 170 ? 'rgb(200, 200, 200)' : 'rgb(100, 100, 100)') });
    fireEvent.click(find(shaded.view.container, '[data-text-block="1"]'));
    const editor = editorIn(shaded.view.container);
    expect(editor.style.backgroundImage).toBe('linear-gradient(to bottom, rgb(200, 200, 200), rgb(100, 100, 100))');
    expect(editor.style.backgroundColor).toBe('');
    shaded.view.unmount();
    // CONTROL: three of four agreeing is flat paper with a stray neighbour, as before.
    const flat = mount({ paperAt: (x, y) => (x < 70 && y < 140 ? 'rgb(0, 0, 0)' : 'rgb(250, 250, 250)') });
    fireEvent.click(find(flat.view.container, '[data-text-block="1"]'));
    expect(editorIn(flat.view.container).style.backgroundColor).toBe('rgb(250, 250, 250)');
    expect(editorIn(flat.view.container).style.backgroundImage).toBe('');
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
    const { view, commits } = mount();
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
    expect(said).toContain('press Esc to put the text back');
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
    expect(said).toContain('This page uses a font Monstera can’t rewrite yet, so nothing was changed.');
    expect(said).toContain('read-back 0');
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

    it('the bar’s Remove empties the block and writes it, which is what removes a block', async () => {
      const { view, sent } = openForPlacing();
      await act(async () => {
        fireEvent.click(find(view.container, '[data-text-format-bar] button[aria-label="Remove this text"]'));
        await Promise.resolve();
      });
      expect(sent.map((one) => one.text)).toStrictEqual(['']);
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
        },
        {
          box: { x0: 72, y0: 650, x1: 300, y1: 664 },
          lines: [line(4, 'The block below.', false, 664)],
          style: REGULAR,
          shape: { align: 'left', firstIndent: 0 },
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
    function mountAdding() {
      const inserts: { insert: PageInsert; version: number }[] = [];
      const onInsert = vi.fn((insert: PageInsert, read: BlocksRead) => {
        inserts.push({ insert, version: read.version });
        return Promise.resolve<BlockCommit>('written');
      });
      const onAdded = vi.fn();
      const made = mount({ adding: true, onInsert, onAdded });
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
      // THE PAGE IS 792 HIGH AT ZOOM 1: a press 200 down is 592 up, and the first baseline an ascent (9.6) below that.
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.insert).toStrictEqual({ left: 100, baseline: 582.4, measure: 360, size: 12, text: 'A new note' });
      expect(inserts[0]?.version).toBe(7);
      expect(onAdded).toHaveBeenCalledTimes(1);
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
      const { view, settle } = mountDeferred();
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
      fireEvent.click(find(view.container, '[data-text-block="1"]'));
      expect(view.container.querySelector('[data-text-editor]')?.textContent).toBe('WORK HISTORY');
    });
  });

  it('CONTROL: a block WRITTEN closes the editor, through the same finish', async () => {
    const { view, answerWith } = mount();
    answerWith('written');
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    typeInto(editorIn(view.container), 'WORK EXPERIENCE');
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
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
          })),
          style: STYLE,
          shape: LEFT,
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
    // WRITTEN: the editor closed, and the read after the write arrives with the block past the page's foot.
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
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

    it('a focus that moves to the bar does not write, and one that leaves both does', async () => {
      const { view, editor, formats } = openWithSelection(0, 4);
      const bar = find(view.container, '[data-text-format-bar]');
      const field = find(bar, 'select');
      await act(async () => {
        fireEvent.blur(editor, { relatedTarget: field });
        await Promise.resolve();
      });
      expect(formats).toHaveLength(0);
      expect(view.container.querySelector('[data-text-editor]')).not.toBeNull();
      await act(async () => {
        fireEvent.blur(editor);
        await Promise.resolve();
      });
      expect(formats).toHaveLength(1);
    });

    it('a press on a bar button keeps the focus in the editor, and a press on a field does not', () => {
      const { view } = openWithSelection(0, 4);
      const bar = find(view.container, '[data-text-format-bar]');
      expect(fireEvent.mouseDown(find(bar, 'button'))).toBe(false);
      expect(fireEvent.mouseDown(find(bar, 'input'))).toBe(true);
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

  it('a page with NO editable text says so, and one with blocked-in text offers to unpack it', () => {
    const empty = mount({ blocks: { ...BLOCKS, blocks: [] } });
    expect(empty.view.container.textContent).toContain('This page has no text that can be edited.');
    empty.view.unmount();

    const packed = mount({ blocks: { ...BLOCKS, unaddressable: 36 } });
    fireEvent.click(packed.view.getByRole('button', { name: /Unpack it/u }));
    expect(packed.onPromote).toHaveBeenCalledTimes(1);
    // CONTROL: a page with blocks and nothing packed says neither sentence.
    expect(packed.view.container.textContent).not.toContain('no text that can be edited');
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
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (face: unknown) => added.push(face), delete: (face: unknown) => removed.push(face) },
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
    const read = vi.fn((_block: TextBlock, _version: number) => Promise.resolve(SHARED));
    const { view, show } = mount({ runFonts: read });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0].lines.map((line) => line.runs.map((run) => run.index))).toStrictEqual([[8, 9], [11]]);
    expect(read.mock.calls[0]?.[1]).toBe(7);
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

  it('the faces LEAVE WITH THE EDITOR: removed when it closes, and none before', async () => {
    const { added, removed } = withFonts();
    const { view } = mount({ runFonts: () => Promise.resolve(SHARED) });
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    await settle();
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(editorIn(view.container), { key: 'Escape' });
      await Promise.resolve();
    });
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
