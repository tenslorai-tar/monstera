// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocVersion } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { BlockCommit, TextBlock } from './commands/documentCommands.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
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

/** Two blocks: a paragraph of two lines, and a heading far above it. */
const BLOCKS: PageBlocks = {
  version: asDocVersion(7),
  blocks: [
    {
      box: { x0: 72, y0: 700, x1: 300, y1: 740 },
      lines: [{ runs: [{ index: 5, text: 'WORK EXPERIENCE', style: STYLE }], box: { x0: 72, y0: 700, x1: 300, y1: 740 } }],
      style: STYLE,
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
        },
        { runs: [{ index: 11, text: 'at every stage.', style: STYLE }], box: { x0: 72, y0: 622, x1: 260, y1: 636 } },
      ],
      style: STYLE,
    },
  ],
  truncated: false,
  rotated: 0,
  unaddressable: 0,
};

function mount(overrides: Partial<Parameters<typeof TextEditLayer>[0]> = {}) {
  const commits: { block: TextBlock; text: string; version: number }[] = [];
  let answer: BlockCommit = 'written';
  const onCommit = vi.fn((block: TextBlock, text: string, version: number) => {
    commits.push({ block, text, version });
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
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
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
          })),
          style: STYLE,
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
});
