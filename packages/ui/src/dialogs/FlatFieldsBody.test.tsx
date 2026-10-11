// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import FlatFieldsBody from './FlatFieldsBody.js';
import { InDialog } from './inDialog.js';

afterEach(() => {
  cleanup();
});

/** The footer's buttons, by what they say: the header's own close is the window's and is not this case's subject. */
function footerButtons(): string[] {
  const footer = document.querySelector('.m-dialog-footer');
  if (footer === null) throw new Error('the window has no footer');
  return [...footer.querySelectorAll('button')].map((button) => button.textContent);
}

/**
 * The footers of *Fields this page could have* (the owner's item 19d: "has no Close button"). The window always ends
 * in a way to put it away, and which word that is follows what the window is: with nothing found it is a report, so
 * Close alone; with proposals it asks something, so Cancel beside the one action.
 */
describe('the Find fields review', () => {
  it('with NOTHING FOUND ends in Close, its only button, and Close settles no answer', () => {
    const answers: unknown[] = [];
    let open = true;
    render(
      <InDialog
        onOpenChange={(next) => {
          open = next;
        }}
      >
        <FlatFieldsBody
          alreadyFields={0}
          all={false}
          candidates={[]}
          fields={0}
          pageCount={1}
          resolve={(value) => answers.push(value)}
          truncated={false}
          update={() => undefined}
        />
      </InDialog>,
    );
    expect(footerButtons()).toStrictEqual(['Close']);
    const close = document.querySelector('.m-dialog-footer button');
    if (close === null) throw new Error('the footer has no button');
    fireEvent.click(close);
    expect(open).toBe(false);
    expect(answers).toStrictEqual([]);
  });

  it('CONTROL: with proposals it ends in Cancel and the action, which answers the KEYS still ticked', () => {
    const answers: unknown[] = [];
    render(
      <InDialog>
        <FlatFieldsBody
          all={false}
          candidates={[
            { key: '0:0', page: 1, name: 'name', label: 'Name', kind: 'text' },
            { key: '0:1', page: 1, name: 'date', label: 'Date', kind: 'text' },
            // TWO OPTIONS OF ONE GROUP, one name: unticking one must leave the other ticked.
            { key: '0:2', page: 1, name: 'Delivery', label: 'Standard', kind: 'radio', option: 'Standard' },
            { key: '0:3', page: 1, name: 'Delivery', label: 'Express', kind: 'radio', option: 'Express' },
          ]}
          alreadyFields={0}
          fields={0}
          pageCount={1}
          resolve={(value) => answers.push(value)}
          truncated={false}
          update={() => undefined}
        />
      </InDialog>,
    );
    expect(footerButtons()).toStrictEqual(['Cancel', 'Add 4 fields']);
    expect(screen.getAllByText('Radio button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /Standard/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 fields' }));
    expect(answers).toStrictEqual([{ kind: 'accept', accepted: ['0:0', '0:1', '0:3'] }]);
  });

  it('says what the document HAS and what was found in one sentence, and offers every page once (F3, K7)', () => {
    const reports: unknown[] = [];
    const view = (all: boolean, pageCount: number): void => {
      render(
        <InDialog>
          <FlatFieldsBody
            all={all}
            alreadyFields={0}
            candidates={[{ key: '0:0', page: 1, name: 'name', label: 'Name', kind: 'text' }]}
            fields={12}
            pageCount={pageCount}
            resolve={() => undefined}
            truncated={false}
            update={(value) => reports.push(value)}
          />
        </InDialog>,
      );
    };
    view(false, 3);
    expect(screen.getByText('This document has 12 fields, and Monstera found 1 new place for a field.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Find on all pages' }));
    expect(reports).toStrictEqual([{ kind: 'all-pages' }]);
    cleanup();
    // CONTROLS: once every page was read, and on a one-page document, there is no second page to offer.
    view(true, 3);
    expect(screen.queryByRole('button', { name: 'Find on all pages' })).toBeNull();
    expect(screen.getByText('Page 1')).toBeTruthy();
    cleanup();
    view(false, 1);
    expect(screen.queryByRole('button', { name: 'Find on all pages' })).toBeNull();
  });
});
