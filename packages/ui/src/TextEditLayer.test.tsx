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

/** The open editor, checked to be the text area it is. */
function editorIn(root: ParentNode): HTMLTextAreaElement {
  const found = root.querySelector('[data-text-editor]');
  if (!(found instanceof HTMLTextAreaElement)) throw new Error('no editor is open');
  return found;
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const GEOMETRY = { crop: [0, 0, 612, 792] as const, rotation: 0, zoom: 1 };

const STYLE = { size: 11, colour: { r: 20, g: 40, b: 60 }, serif: true, mono: false, italic: false, bold: true };

/** Two blocks: a paragraph of two lines, and a heading far above it. */
const BLOCKS: PageBlocks = {
  version: asDocVersion(7),
  blocks: [
    {
      box: { x0: 72, y0: 700, x1: 300, y1: 740 },
      lines: [{ runs: [{ index: 5, text: 'WORK EXPERIENCE' }], box: { x0: 72, y0: 700, x1: 300, y1: 740 } }],
      style: STYLE,
    },
    {
      box: { x0: 72, y0: 600, x1: 400, y1: 650 },
      lines: [
        { runs: [{ index: 8, text: 'Helps with care ' }, { index: 9, text: 'and support' }], box: { x0: 72, y0: 636, x1: 400, y1: 650 } },
        { runs: [{ index: 11, text: 'at every stage.' }], box: { x0: 72, y0: 622, x1: 260, y1: 636 } },
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
  const view = render(
    <Wrapped>
      <TextEditLayer
        blocks={BLOCKS}
        geometry={GEOMETRY}
        onCommit={onCommit}
        onLeave={onLeave}
        onPromote={onPromote}
        page={2}
        paperAt={() => 'rgb(250, 250, 250)'}
        {...overrides}
      />
    </Wrapped>,
  );
  return {
    view,
    commits,
    onLeave,
    onPromote,
    answerWith: (next: BlockCommit) => {
      answer = next;
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
    expect(editor.value).toBe('Helps with care and support\nat every stage.');
    expect(editor.style.color).toBe('rgb(20, 40, 60)');
    expect(editor.style.backgroundColor).toBe('rgb(250, 250, 250)');
    expect(editor.style.fontWeight).toBe('700');
    expect(editor.classList.contains('m-text-editor--serif')).toBe(true);
    // THE HANDLES MARK THE OPEN BLOCK, and they take no pointer.
    expect(view.container.querySelectorAll('.m-text-editor-handle')).toHaveLength(8);
    // The other block stays an outline.
    expect(view.container.querySelectorAll('[data-text-block]')).toHaveLength(1);
  });

  it('ESCAPE WRITES what was typed, for the block that was open, at the version it was read at', async () => {
    const { view, commits } = mount();
    fireEvent.click(find(view.container, '[data-text-block="1"]'));
    const editor = editorIn(view.container);
    fireEvent.change(editor, { target: { value: 'Helps with care and support\nat every single stage.' } });
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
    fireEvent.change(editor, { target: { value: 'WORK HISTORY' } });
    await act(async () => {
      fireEvent.blur(editor);
      await Promise.resolve();
    });
    expect(commits.map((commit) => commit.text)).toStrictEqual(['WORK HISTORY']);
  });

  it('A FONT THAT CANNOT CARRY THE WORDS keeps the editor open and SAYS so beside them', async () => {
    const { view, answerWith } = mount();
    answerWith('not-writable');
    fireEvent.click(find(view.container, '[data-text-block="0"]'));
    const editor = editorIn(view.container);
    fireEvent.change(editor, { target: { value: 'WORK 中' } });
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).not.toBeNull();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Nothing was changed');
    // AND A SECOND ESCAPE PUTS THE TEXT BACK rather than sending it again.
    await act(async () => {
      fireEvent.keyDown(find(view.container, '[data-text-editor]'), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(view.container.querySelector('[data-text-editor]')).toBeNull();
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
