// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExportPowerPointBody from './ExportPowerPointBody.js';
import PowerPointOutcomeBody from './PowerPointOutcomeBody.js';
import { InDialog } from './inDialog.js';

/**
 * The PowerPoint export dialog's body (ADR-0210). The command's half, that the answer reaches `document.exportPowerPoint`
 * unchanged, is `commands/documentCommands.test.ts`'; this half is that CHOOSING a mode and pages is what puts them in the
 * answer, and that Editable is what is chosen when nothing is.
 */

function opened(): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ExportPowerPointBody pageCount={3} resolve={resolve} update={() => undefined} />
    </InDialog>,
  );
  return resolve;
}

const SAVE = (): HTMLElement => screen.getByRole('button', { name: 'Choose where to save…' });

afterEach(() => {
  cleanup();
});

describe('ExportPowerPointBody', () => {
  it('opens on Editable, the owner’s default, and answers it with every page', () => {
    const resolve = opened();
    expect(screen.getByRole('radio', { name: /^Editable/u })).toHaveProperty('checked', true);
    // CONTROL: the other choice is not, so the property is the selection and not a constant.
    expect(screen.getByRole('radio', { name: /^Exact look/u })).toHaveProperty('checked', false);
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'editable', pages: [0, 1, 2] });
  });

  it('answers Exact look when that is chosen — CONTROL: the default above is not the only answer it can give', () => {
    const resolve = opened();
    fireEvent.click(screen.getByRole('radio', { name: /^Exact look/u }));
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'exact', pages: [0, 1, 2] });
  });

  it('says in plain words what each choice does, and what a scanned page costs the document', () => {
    opened();
    expect(screen.getByText(/real slide objects you can change/u)).toBeTruthy();
    expect(screen.getByText(/Nothing on it can be edited/u)).toBeTruthy();
    expect(screen.getByText(/Undo takes them out/u)).toBeTruthy();
  });

  it('shares the exports’ page row: a page the document lacks is refused at the press, and the typed ones are sent', () => {
    const resolve = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '4' } });
    fireEvent.click(SAVE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '3, 1' } });
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'editable', pages: [0, 2] });
  });
});

/** The outcome body inside the dialog host, with the props it is given. */
function outcome(props: Parameters<typeof PowerPointOutcomeBody>[0]): void {
  render(
    <InDialog>
      <PowerPointOutcomeBody {...props} />
    </InDialog>,
  );
}

describe('PowerPointOutcomeBody', () => {
  it('names the pages that became pictures by the numbers a person counts them by', () => {
    outcome({ fellBack: [3, 7], fellBackCount: 2, recognised: 0, noModel: false });
    expect(screen.getByText(/These pages could not be made editable/u).textContent).toContain('3, 7');
    // CONTROL: nothing was recognised, so that sentence is not there.
    expect(screen.queryByText(/scanned page/u)).toBeNull();
  });

  it('says one page in the singular, and how many more than it lists', () => {
    outcome({ fellBack: [5], fellBackCount: 1, recognised: 1, noModel: false });
    expect(screen.getByText(/^Page 5 could not be made editable/u)).toBeTruthy();
    expect(screen.getByText(/The words on one scanned page were read/u)).toBeTruthy();
    cleanup();
    outcome({ fellBack: [3, 7], fellBackCount: 140, recognised: 0, noModel: false });
    expect(screen.getByText(/And 138 more\./u)).toBeTruthy();
  });

  it('explains missing recognition only where pages fell back, and says nothing when there is nothing to say', () => {
    outcome({ fellBack: [2], fellBackCount: 1, recognised: 0, noModel: true });
    expect(screen.getByText(/no text recognition language is installed/u)).toBeTruthy();
    cleanup();
    // CONTROL: no model but nothing fell back, which is a document with no scans, is not a sentence.
    outcome({ fellBack: [], fellBackCount: 0, recognised: 0, noModel: true });
    expect(document.querySelector('.m-powerpoint-outcome')?.textContent).toBe('');
  });
});
