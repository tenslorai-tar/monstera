// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocVersion } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
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
