// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { EditedBlock, WindowEditAction } from '@monstera/contract';
import { type MessageKey, asDocVersion } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BlockCommit, BlocksRead } from '../commands/documentCommands.js';
import { NO_BLOCK_FACES } from '../commands/documentCommands.js';
import { pointOf } from '../editorKit/dom.js';
import type { EditorSpelling } from '../editorKit/EditorMenu.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN, SPELLING_DICTIONARY_FULL, TEXT_EDIT_COVERS, TEXT_EDIT_PAST_PAGE } from '../messages/en.js';
import type { TextBlock } from '../textBlock.js';
import type { PageBlocks } from './editing.js';
import { EditTextLayer, type EditTextLayerProps } from './EditTextLayer.js';

/**
 * The rebuilt editor's flows that `TextEditLayer.test.tsx` covered before ADR-0271 deleted it: the right-click menu,
 * join and split from it, a press from block to block, a write grown past the page's foot (Q7), and the notice of a
 * write grown over something else (B1.6). Each case asserts the DECISION — the call made or not made — rather than an
 * end state an absent decision would also leave.
 */

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
/** A block of hard lines, each `text` one line 14 points tall, the first with its top at `top`. */
const block = (first: number, texts: readonly string[], top: number, x1 = 300): TextBlock => ({
  box: box(72, top - 14 * texts.length, x1, top),
  lines: texts.map((text, at) => ({
    runs: [{ index: first + at, text, style: STYLE }],
    box: box(72, top - 14 * (at + 1), x1, top - 14 * at),
    soft: false,
    baseline: top - 14 * at - 11,
  })),
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
});
const read = (version: number, blocks: readonly TextBlock[]): PageBlocks => ({
  version: asDocVersion(version),
  blocks: [...blocks],
  truncated: false,
  rotated: 0,
  angled: { turned: 0, vertical: 0, slanted: 0, mirrored: 0 },
  unaddressable: 0,
  rewrite: 'objects',
});
/** Two blocks far apart: no join between them is offered (`neighbourOf` reaches four sizes, 44 points). */
const HEADING = block(1, ['Garden club'], 700);
const BODY = block(2, ['the quikc fox'], 614);
const APART = read(3, [HEADING, BODY]);
const GEOMETRY = { crop: [0, 0, 612, 792] as const, rotation: 0, zoom: 1 };

/** The element, or a failure naming what was missing. */
function must<T>(found: T | null | undefined, what: string): T {
  if (found === null || found === undefined) throw new Error(`no ${what}`);
  return found;
}

beforeAll(() => {
  activateCatalogue('en', EN);
});
afterEach(() => {
  cleanup();
});

type Commit = (text: string) => Promise<BlockCommit>;
type Props = Partial<Omit<EditTextLayerProps, 'onCommit'>>;

/** The layer over `blocks`, its writes answered by `commit`, and a way to hand it the read after a write. */
function layer(blocks: PageBlocks, commit: Commit = () => Promise.resolve('written'), props: Props = {}) {
  const onCommit = vi.fn((_block: TextBlock, text: string) => commit(text));
  const tree = (now: PageBlocks) => (
    <I18nProvider i18n={i18n}>
      <EditTextLayer
        blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
        blocks={now}
        geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
        onCommit={onCommit}
        onLeave={vi.fn()}
        page={0}
        paperAt={() => undefined}
        {...props}
      />
    </I18nProvider>
  );
  const view = render(tree(blocks));
  const outline = (at: number) => must(view.container.querySelector<HTMLElement>(`[data-text-block="${String(at)}"]`), `outline ${String(at)}`);
  const frame = () => view.container.querySelector<HTMLElement>('[data-kit-frame]');
  const surface = () => must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface');
  /** Hands the layer the read that follows, as `EditTextPage` does once the page has it. */
  const show = async (next: PageBlocks) => {
    await act(async () => {
      view.rerender(tree(next));
      await Promise.resolve();
    });
  };
  return { view, onCommit, outline, frame, surface, show };
}

/** Puts the browser's selection over a model range of the surface, as a press or a drag would leave it. */
function selectIn(surface: HTMLElement, from: { paragraph: number; offset: number }, to = from): void {
  const start = must(pointOf(surface, from), 'start point');
  const end = must(pointOf(surface, to), 'end point');
  surface.ownerDocument.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
}

/** Types `text` at a model position, as the browser's input would arrive. */
function typeAt(surface: HTMLElement, text: string, at: { paragraph: number; offset: number }): void {
  surface.focus();
  selectIn(surface, at);
  surface.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
}

/** Opens block `at` with the caret in its words (Enter on the selected box), so a right-click is over the words. */
function openForWords(made: ReturnType<typeof layer>, at: number): void {
  fireEvent.click(made.outline(at), { detail: 1 });
  act(() => {
    fireEvent.keyDown(must(made.frame(), 'frame'), { key: 'Enter' });
  });
}

const rightClick = async (surface: HTMLElement) => {
  await act(async () => {
    fireEvent.contextMenu(surface, { clientX: 10, clientY: 10 });
    await Promise.resolve();
  });
};

const escape = async (surface: HTMLElement) => {
  await act(async () => {
    fireEvent.keyDown(surface, { key: 'Escape' });
    await Promise.resolve();
  });
};

describe('the right-click menu on the open editor (ADR-0180 Decision 8)', () => {
  /** A spelling that knows `quikc` is misspelt, recording what it was asked and what it kept. */
  function spelling(refusal?: MessageKey) {
    const look = vi.fn((word: string) => Promise.resolve(word === 'quikc' ? { suggestions: ['quick', 'quirk'] } : undefined));
    const keep = vi.fn((_word: string): MessageKey | undefined => refusal);
    const spell: EditorSpelling = { look, keep };
    return { spell, look, keep };
  }

  it('a replacement replaces EXACTLY the word under the pointer, and the finish writes that', async () => {
    const { spell, look } = spelling();
    const made = layer(APART, () => Promise.resolve('written'), { spell });
    openForWords(made, 1);
    selectIn(made.surface(), { paragraph: 0, offset: 6 });
    await rightClick(made.surface());
    expect(look).toHaveBeenCalledWith('quikc');
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'quick' }));
      await Promise.resolve();
    });
    expect(made.surface().textContent).toBe('the quick fox');
    await escape(made.surface());
    // THE DECISION: the word was replaced in the model the write is made from, and nothing else in it moved.
    expect(made.onCommit).toHaveBeenCalledTimes(1);
    expect(made.onCommit.mock.calls[0]?.[1]).toBe('the quick fox');
  });

  it('over a CORRECTLY spelt word the menu offers no replacements and no dictionary, only the editing verbs', async () => {
    const { spell, look } = spelling();
    const made = layer(APART, () => Promise.resolve('written'), { spell });
    openForWords(made, 1);
    // `the`, which the spelling knows: it is asked, and answers nothing to offer.
    selectIn(made.surface(), { paragraph: 0, offset: 1 });
    await rightClick(made.surface());
    await screen.findByRole('menuitem', { name: 'Paste' });
    expect(look).toHaveBeenCalledWith('the');
    expect(screen.queryByRole('menuitem', { name: 'quick' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /to the dictionary/u })).toBeNull();
    // CONTROL: the same menu over `quikc` offers both, so the absences above are the word's.
    await act(async () => {
      fireEvent.keyDown(must(screen.getByRole('menu'), 'menu'), { key: 'Escape' });
      await Promise.resolve();
    });
    selectIn(made.surface(), { paragraph: 0, offset: 6 });
    await rightClick(made.surface());
    expect(await screen.findByRole('menuitem', { name: 'quick' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Add “quikc” to the dictionary' })).toBeDefined();
  });

  it('the PAGE’S OWN MENU is not opened by a right-click over the editor, and is by one over the page', async () => {
    const pageMenu = vi.fn();
    const onCommit = vi.fn(() => Promise.resolve<BlockCommit>('written'));
    const view = render(
      <I18nProvider i18n={i18n}>
        <div data-testid="page" onContextMenu={pageMenu}>
          <EditTextLayer
            blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
            blocks={APART}
            geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
            onCommit={onCommit}
            onLeave={vi.fn()}
            page={0}
            paperAt={() => undefined}
          />
        </div>
      </I18nProvider>,
    );
    fireEvent.click(must(view.container.querySelector<HTMLElement>('[data-text-block="1"]'), 'outline'), { detail: 1 });
    act(() => {
      fireEvent.keyDown(must(view.container.querySelector<HTMLElement>('[data-kit-frame]'), 'frame'), { key: 'Enter' });
    });
    await rightClick(must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface'));
    const paste = await screen.findByRole('menuitem', { name: 'Paste' });
    expect(pageMenu).not.toHaveBeenCalled();
    // AND OVER THE OPEN MENU ITSELF: Base UI's trigger stops a right-click over the words, but the popup is a portal
    // outside it whose events still bubble up React's tree, so only `EditorMenu`'s own wrapper stops this one.
    fireEvent.contextMenu(paste);
    expect(pageMenu).not.toHaveBeenCalled();
    // CONTROL: a right-click on the page outside the editor reaches the page's menu, so the case above is the editor's.
    await act(async () => {
      fireEvent.keyDown(must(screen.getByRole('menu'), 'menu'), { key: 'Escape' });
      await Promise.resolve();
    });
    fireEvent.contextMenu(screen.getByTestId('page'));
    expect(pageMenu).toHaveBeenCalledTimes(1);
  });

  it('Add to the dictionary calls the spelling’s keep with the word, and a refusal is said beside the words', async () => {
    const { spell, keep } = spelling(SPELLING_DICTIONARY_FULL);
    const made = layer(APART, () => Promise.resolve('written'), { spell });
    openForWords(made, 1);
    selectIn(made.surface(), { paragraph: 0, offset: 6 });
    await rightClick(made.surface());
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Add “quikc” to the dictionary' }));
      await Promise.resolve();
    });
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledWith('quikc');
    expect(must(made.frame(), 'frame').querySelector('[role="status"]')?.textContent).toBe(EN[SPELLING_DICTIONARY_FULL]);
  });

  it('Cut, Copy and Paste call `native` with their own action, and Cut and Copy only over a selection', async () => {
    const native = vi.fn((_action: WindowEditAction) => undefined);
    const made = layer(APART, () => Promise.resolve('written'), { native });
    openForWords(made, 1);
    // NOTHING SELECTED: Cut and Copy have nothing to act on, Paste always does.
    selectIn(made.surface(), { paragraph: 0, offset: 1 });
    await rightClick(made.surface());
    expect((await screen.findByRole('menuitem', { name: 'Cut' })).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
      await Promise.resolve();
    });
    expect(native).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
      await Promise.resolve();
    });
    expect(native.mock.calls.map(([action]) => action)).toStrictEqual(['paste']);
    // A SELECTION OF `fox`: now Cut and Copy apply, each its own action.
    selectIn(made.surface(), { paragraph: 0, offset: 10 }, { paragraph: 0, offset: 13 });
    await rightClick(made.surface());
    const cut = await screen.findByRole('menuitem', { name: 'Cut' });
    expect(cut.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => {
      fireEvent.click(cut);
      await Promise.resolve();
    });
    selectIn(made.surface(), { paragraph: 0, offset: 10 }, { paragraph: 0, offset: 13 });
    await rightClick(made.surface());
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy' }));
      await Promise.resolve();
    });
    expect(native.mock.calls.map(([action]) => action)).toStrictEqual(['paste', 'cut', 'copy']);
  });

  it('the editor does NOT finish while the menu has the focus, and finishes once it is gone', async () => {
    const made = layer(APART);
    openForWords(made, 1);
    typeAt(made.surface(), '!', { paragraph: 0, offset: 13 });
    await rightClick(made.surface());
    const paste = await screen.findByRole('menuitem', { name: 'Paste' });
    const popup = must(paste.closest<HTMLElement>('[role="menu"]'), 'menu');
    // THE FOCUS AND A PRESS IN THE POPUP, which is outside the frame: either would be a finish anywhere else.
    await act(async () => {
      popup.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      popup.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(made.onCommit).not.toHaveBeenCalled();
    // CONTROL: the same press on the page once the menu is closed finishes, so the guard above is the menu's.
    await act(async () => {
      fireEvent.keyDown(popup, { key: 'Escape' });
      await Promise.resolve();
    });
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(made.onCommit).toHaveBeenCalledTimes(1);
    expect(made.onCommit.mock.calls[0]?.[1]).toBe('the quikc fox!');
  });
});

describe('join and split from the menu (ADR-0180 Decision 7)', () => {
  /**
   * An upper block of three paragraphs, and one 41 points below it: near enough to be its continuation (within four
   * sizes, 44), and far enough that a split's half moved down 14 points still stands a line clear of it.
   */
  const UPPER = block(1, ['First paragraph.', 'Second paragraph.', 'Third.'], 728);
  const LOWER = block(4, ['The block below.'], 645);
  const STACKED = read(7, [UPPER, LOWER]);

  function stacked(blocks: PageBlocks = STACKED) {
    const onRestructure = vi.fn((_edits: EditedBlock[], _read: BlocksRead) => Promise.resolve<BlockCommit>('written'));
    const made = layer(blocks, () => Promise.resolve('written'), { onRestructure });
    openForWords(made, 0);
    return { ...made, onRestructure };
  }
  const offered = () => screen.queryAllByRole('menuitem').map((item) => item.getAttribute('data-block-op')).filter((op) => op !== null);

  it('offers a join with the block below and a split where they apply, and neither where they do not', async () => {
    const made = stacked();
    selectIn(made.surface(), { paragraph: 0, offset: 1 });
    await rightClick(made.surface());
    await screen.findByRole('menuitem', { name: 'Paste' });
    // THE FIRST PARAGRAPH OF THE TOP BLOCK: nothing above to join, nothing before it to split at.
    expect(offered()).toStrictEqual(['join-below']);
    await act(async () => {
      fireEvent.keyDown(must(screen.getByRole('menu'), 'menu'), { key: 'Escape' });
      await Promise.resolve();
    });
    selectIn(made.surface(), { paragraph: 1, offset: 1 });
    await rightClick(made.surface());
    await screen.findByRole('menuitem', { name: 'Paste' });
    expect(offered()).toStrictEqual(['join-below', 'split']);
  });

  it('a join calls onRestructure ONCE with both blocks’ edits: the words extended and the lower block emptied', async () => {
    const made = stacked();
    selectIn(made.surface(), { paragraph: 0, offset: 1 });
    await rightClick(made.surface());
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Join with the text below' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(made.onRestructure).toHaveBeenCalledTimes(1);
    const [edits, at] = made.onRestructure.mock.calls[0] ?? [];
    expect(edits?.map((edit) => edit.text)).toStrictEqual(['First paragraph.\nSecond paragraph.\nThird. The block below.', '']);
    expect(at?.version).toBe(STACKED.version);
    // ONE WRITE: the join is the editor's write, not one beside the words'.
    expect(made.onCommit).not.toHaveBeenCalled();
  });

  it('a split calls onRestructure with the two halves, the second moved down a line', async () => {
    const made = stacked();
    selectIn(made.surface(), { paragraph: 1, offset: 1 });
    await rightClick(made.surface());
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Split the text before this paragraph' }));
      await Promise.resolve();
    });
    expect(made.onRestructure).toHaveBeenCalledTimes(1);
    const edits = made.onRestructure.mock.calls[0]?.[0];
    expect(edits?.map((edit) => edit.text)).toStrictEqual(['First paragraph.', 'Second paragraph.\nThird.']);
    expect(edits?.[1]?.place).toStrictEqual({ move: { x: 0, y: -14 } });
  });

  it('NOT offered where the moved half would land within a line of the text below, so nothing joins it (ADR-0271)', async () => {
    // THE BLOCK BELOW 22 POINTS UNDER: the half moved down 14 would end 8 points above it, under a line.
    const made = stacked(read(7, [UPPER, block(4, ['The block below.'], 664)]));
    selectIn(made.surface(), { paragraph: 1, offset: 1 });
    await rightClick(made.surface());
    await screen.findByRole('menuitem', { name: 'Paste' });
    // THE JOIN IS STILL OFFERED, so the menu was asked for block operations and the split alone was withheld.
    expect(offered()).toStrictEqual(['join-below']);
  });

  it('NOT offered once words are typed: a join writes the block as the page has it, and would drop them', async () => {
    const made = stacked();
    typeAt(made.surface(), 'Typed ', { paragraph: 1, offset: 0 });
    selectIn(made.surface(), { paragraph: 1, offset: 1 });
    await rightClick(made.surface());
    await screen.findByRole('menuitem', { name: 'Paste' });
    expect(offered()).toStrictEqual([]);
    expect(made.onRestructure).not.toHaveBeenCalled();
  });
});

describe('a press from block to block (ADR-0180 Decision 8)', () => {
  /** A write the case answers itself, so what happens between the press and the answer can be looked at. */
  function deferred() {
    const answer: { resolve: (outcome: BlockCommit) => void } = { resolve: () => undefined };
    const made = layer(
      APART,
      () =>
        new Promise<BlockCommit>((resolve) => {
          answer.resolve = resolve;
        }),
    );
    return { ...made, answer };
  }

  it('a press on another block FINISHES the open one, once, and the pressed block opens in the read after', async () => {
    const made = deferred();
    fireEvent.click(made.outline(0), { detail: 1 });
    act(() => {
      typeAt(made.surface(), ' news', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.click(made.outline(1), { detail: 1 });
      await Promise.resolve();
    });
    // THE DECISION: the press asked the open editor to write, and the words are the ones typed.
    expect(made.onCommit).toHaveBeenCalledTimes(1);
    expect(made.onCommit.mock.calls[0]?.[1]).toBe('Garden club news');
    // UNTIL THE ANSWER, the one editor there is holds the open block's words.
    expect(made.view.container.querySelectorAll('[data-kit-frame]')).toHaveLength(1);
    expect(made.surface().textContent).toBe('Garden club news');
    await act(async () => {
      made.answer.resolve('written');
      await Promise.resolve();
    });
    await made.show(read(4, [block(1, ['Garden club news'], 700), BODY]));
    // THE PRESSED BLOCK OPENS in the read after the write, with its own words, and nothing more was written.
    expect(made.view.container.querySelectorAll('[data-kit-frame]')).toHaveLength(1);
    expect(made.surface().textContent).toBe('the quikc fox');
    expect(made.onCommit).toHaveBeenCalledTimes(1);
  });

  it('a REFUSED write keeps the editor and its words, the pressed block does not open, and a second press writes nothing', async () => {
    const made = deferred();
    fireEvent.click(made.outline(0), { detail: 1 });
    act(() => {
      typeAt(made.surface(), ' news', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.click(made.outline(1), { detail: 1 });
      await Promise.resolve();
    });
    await act(async () => {
      made.answer.resolve({ refused: { code: 'internal', incident: 'test' } });
      await Promise.resolve();
    });
    expect(must(made.frame(), 'frame').querySelector('[role="alert"]')).not.toBeNull();
    expect(made.surface().textContent).toBe('Garden club news');
    // A FURTHER PRESS on the other block: the words are kept until the person decides.
    await act(async () => {
      fireEvent.click(made.outline(1), { detail: 1 });
      await Promise.resolve();
    });
    // THE DECISION, not the state: the refused words are NOT sent again, which a second refusal would also leave on screen.
    expect(made.onCommit).toHaveBeenCalledTimes(1);
    expect(made.view.container.querySelectorAll('[data-kit-frame]')).toHaveLength(1);
    expect(made.surface().textContent).toBe('Garden club news');
    // NOR DOES THE PRESSED BLOCK OPEN at a later read: the press was not kept as a block waiting to open.
    await made.show(read(4, [HEADING, BODY]));
    expect(made.view.container.querySelector('[data-kit-frame]')).toBeNull();
  });
});

/** The body block as a write leaves it read again: its first line where it was, growing down to `bottom`. */
const grownTo = (bottom: number, x1 = 300): TextBlock => {
  const texts = ['the quikc fox', 'jumps over', 'the lazy dog', 'LAST LINE'];
  const pitch = (614 - 14 - bottom) / (texts.length - 1);
  return {
    box: box(72, bottom, x1, 614),
    lines: texts.map((text, at) => ({
      runs: [{ index: 20 + at, text, style: STYLE }],
      box: box(72, 600 - at * pitch, x1, 614 - at * pitch),
      soft: false,
      baseline: 603 - at * pitch,
    })),
    style: STYLE,
    shape: { align: 'left', firstIndent: 0 },
  };
};
const PAST = EN[TEXT_EDIT_PAST_PAGE];
const COVERS = EN[TEXT_EDIT_COVERS];

/** Writes the body block, answered `written` then `unchanged`, and hands the layer `after` as the read that follows. */
async function writeBody(after: PageBlocks, props: Props = {}) {
  const answers: BlockCommit[] = ['written', 'unchanged'];
  const made = layer(APART, () => Promise.resolve(answers.shift() ?? 'unchanged'), props);
  fireEvent.click(made.outline(1), { detail: 1 });
  act(() => {
    typeAt(made.surface(), ' jumps', { paragraph: 0, offset: 13 });
  });
  await escape(made.surface());
  expect(made.onCommit).toHaveBeenCalledTimes(1);
  await made.show(after);
  return made;
}

describe('a write that runs past the page’s foot (the owner’s Q7)', () => {
  it('reopens the editor over the block with EVERY word and the sentence; closing it ends that', async () => {
    const made = await writeBody(read(4, [HEADING, grownTo(-30)]));
    const frame = must(made.frame(), 'reopened editor');
    for (const line of ['the quikc fox', 'jumps over', 'the lazy dog', 'LAST LINE']) expect(made.surface().textContent).toContain(line);
    expect(frame.querySelector('[role="status"]')?.textContent).toBe(PAST);
    // CLOSED WITH NOTHING TO WRITE: the reopening ends with the editor it opened, and the same read reopens nothing.
    await escape(made.surface());
    expect(made.frame()).toBeNull();
    await made.show(read(4, [HEADING, grownTo(-30)]));
    expect(made.frame()).toBeNull();
    // THE BLOCK IS NOW OUTLINED as past the page, the sentence at it.
    expect(made.outline(1).getAttribute('aria-description')).toBe(PAST);
  });

  it('CONTROL: a write whose read FITS the page reopens nothing and says nothing', async () => {
    const made = await writeBody(read(4, [HEADING, grownTo(540)]));
    expect(made.frame()).toBeNull();
    expect(made.view.container.textContent).not.toContain(PAST);
  });
});

describe('a write that grows over something else says so (B1.6)', () => {
  /** A one-line block at `y0`, beside the body block as it grows down to 540. */
  const beside = (y0: number): TextBlock => ({ ...block(40, ['Footnote'], y0 + 14), box: box(80, y0, 200, y0 + 10) });

  it('growth over another BLOCK says so', async () => {
    const made = await writeBody(read(4, [HEADING, grownTo(540), beside(550)]));
    expect(made.view.container.querySelector('[role="status"]')?.textContent).toBe(COVERS);
  });

  it('growth over a PICTURE OR DRAWING says so, from the page’s objects at the same version', async () => {
    const objects = vi.fn(() => Promise.resolve({ version: asDocVersion(4), boxes: [box(90, 545, 150, 580)] }));
    const made = await writeBody(read(4, [HEADING, grownTo(540)]), { objects });
    await act(async () => {
      await Promise.resolve();
    });
    expect(made.view.container.querySelector('[role="status"]')?.textContent).toBe(COVERS);
  });

  it('CONTROL: growth over nothing, or over what the block ALREADY covered, says nothing', async () => {
    const clear = await writeBody(read(4, [HEADING, grownTo(540), beside(400)]));
    expect(clear.view.container.textContent).not.toContain(COVERS);
    cleanup();
    // THE FOOTNOTE AT 605 lay under the block before the write: not news.
    const already = await writeBody(read(4, [HEADING, grownTo(540), beside(605)]));
    expect(already.view.container.textContent).not.toContain(COVERS);
    cleanup();
    const away = await writeBody(read(4, [HEADING, grownTo(540)]), {
      objects: () => Promise.resolve({ version: asDocVersion(4), boxes: [box(90, 100, 150, 200)] }),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(away.view.container.textContent).not.toContain(COVERS);
  });
});
