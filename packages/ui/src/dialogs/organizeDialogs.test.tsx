// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CropPagesBody from './CropPagesBody.js';
import DeletePagesBody from './DeletePagesBody.js';
import DuplicatePagesBody from './DuplicatePagesBody.js';
import ExtractPagesBody from './ExtractPagesBody.js';
import ImportPageAsLayerBody from './ImportPageAsLayerBody.js';
import { InDialog } from './inDialog.js';
import InsertFromPdfBody from './InsertFromPdfBody.js';
import MergeDocumentBody from './MergeDocumentBody.js';
import ReplacePageBody from './ReplacePageBody.js';
import ResizePagesBody from './ResizePagesBody.js';
import SplitDocumentBody from './SplitDocumentBody.js';

/**
 * The Organize dialogs in the dialog pattern (the owner's decision, 2026-10-02): each question a row with its control,
 * a choice that needs a sentence as choices, and a footer of Cancel then the one action. What each answers is the
 * command half's; these cases prove the pattern did not change WHAT a dialog answers, and that every one ends in the
 * footer, whose Cancel is the popup's own close and settles nothing.
 */

/** IN THE DIALOG, as the registry mounts it: the footer's Cancel exists only inside one. */
function inDialog(body: ReactNode, onOpenChange: (open: boolean) => void = () => undefined): ReactElement {
  return <InDialog onOpenChange={onOpenChange}>{body}</InDialog>;
}

const CHOICES = [
  { docId: 'd-a', name: 'Alpha.pdf' },
  { docId: 'd-b', name: 'Beta.pdf' },
];

/** Every dialog of the group, each with the action a person presses and the answer that press must give. */
const BODIES: readonly {
  readonly name: string;
  readonly body: (resolve: (value: unknown) => void) => ReactNode;
  readonly action: string;
  readonly answer: unknown;
}[] = [
  {
    name: 'Delete pages',
    body: (resolve) => <DeletePagesBody pageCount={9} pages={[1, 2]} resolve={resolve} update={() => undefined} />,
    action: 'Delete pages',
    answer: { pages: [1, 2] },
  },
  {
    name: 'Extract pages',
    body: (resolve) => <ExtractPagesBody pageCount={9} pages={[4]} resolve={resolve} update={() => undefined} />,
    action: 'Extract to a new PDF',
    answer: { pages: [4] },
  },
  {
    name: 'Split',
    body: (resolve) => <SplitDocumentBody pageCount={2} resolve={resolve} update={() => undefined} />,
    action: 'Choose a folder…',
    answer: { groups: [[0], [1]] },
  },
  {
    name: 'Duplicate pages',
    body: (resolve) => (
      <DuplicatePagesBody groups={[{ pages: [0, 3] }]} truncated={false} resolve={resolve} update={() => undefined} />
    ),
    action: 'Remove 1 duplicate page',
    answer: { pages: [3] },
  },
  {
    name: 'Crop',
    body: (resolve) => <CropPagesBody pages={[2]} resolve={resolve} update={() => undefined} />,
    action: 'Crop',
    answer: { pages: 'all', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
  },
  {
    name: 'Resize',
    body: (resolve) => <ResizePagesBody pages={[2]} resolve={resolve} update={() => undefined} />,
    action: 'Resize',
    answer: { pages: 'all', widthPoints: 595, heightPoints: 842 },
  },
  {
    name: 'Merge',
    body: (resolve) => <MergeDocumentBody choices={CHOICES} resolve={resolve} update={() => undefined} />,
    action: 'Merge',
    answer: { source: 'd-a' },
  },
  {
    name: 'Insert from PDF',
    body: (resolve) => <InsertFromPdfBody choices={CHOICES} pageCount={3} resolve={resolve} update={() => undefined} />,
    action: 'Insert',
    answer: { source: 'd-a', at: 3 },
  },
  {
    name: 'Replace page',
    body: (resolve) => <ReplacePageBody choices={CHOICES} page={1} resolve={resolve} update={() => undefined} />,
    action: 'Replace page',
    answer: { source: 'd-a' },
  },
  {
    name: 'Import page as layer',
    body: (resolve) => <ImportPageAsLayerBody choices={CHOICES} page={1} resolve={resolve} update={() => undefined} />,
    action: 'Import as layer',
    answer: { source: 'd-a' },
  },
];

afterEach(() => {
  cleanup();
});

describe('the Organize dialogs in the dialog pattern', () => {
  for (const { name, body, action, answer } of BODIES) {
    it(`${name}: ends in the footer — Cancel, then its action — and the action answers as before`, () => {
      const resolve = vi.fn();
      const { container } = render(inDialog(body(resolve)));
      const footer = container.ownerDocument.querySelector('.m-dialog-footer');
      expect(footer).not.toBeNull();
      const buttons = within(footer as HTMLElement).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toStrictEqual(['Cancel', action]);
      fireEvent.click(screen.getByRole('button', { name: action }));
      expect(resolve).toHaveBeenCalledWith(answer);
    });
  }

  it('Cancel is the popup’s own close: it closes the dialog and answers nothing', () => {
    const resolve = vi.fn();
    const changed: boolean[] = [];
    render(
      inDialog(<DeletePagesBody pageCount={9} pages={[1]} resolve={resolve} update={() => undefined} />, (open) =>
        changed.push(open),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(changed).toStrictEqual([false]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('each question is a ROW: its words beside its control, which is named by the same words', () => {
    render(inDialog(<InsertFromPdfBody choices={CHOICES} pageCount={3} resolve={vi.fn()} update={() => undefined} />));
    const rows = [...document.querySelectorAll('.m-dialog-row')].map(
      (row) => row.querySelector('.m-dialog-row__label')?.textContent,
    );
    expect(rows).toStrictEqual(['Document to insert', 'Insert before page']);
    expect(screen.getByRole('combobox', { name: 'Document to insert' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Insert before page' })).toBeTruthy();
  });

  it('Split’s two ways are CHOICES under their question, each with its sentence, and choosing ranges asks for them', () => {
    const resolve = vi.fn();
    render(inDialog(<SplitDocumentBody pageCount={6} resolve={resolve} update={() => undefined} />));
    expect(screen.getByRole('radiogroup', { name: /^How to split/u })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^One file for each range/u }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ranges' }), { target: { value: '1-3, 4-6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }));
    expect(resolve).toHaveBeenCalledWith({ groups: [[0, 1, 2], [3, 4, 5]] });
  });
});
