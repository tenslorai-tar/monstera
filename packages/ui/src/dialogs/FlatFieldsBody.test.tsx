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
          candidates={[]}
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

  it('CONTROL: with proposals it ends in Cancel and the action, which answers the fields still ticked', () => {
    const answers: unknown[] = [];
    render(
      <InDialog>
        <FlatFieldsBody
          candidates={[
            { name: 'name', label: 'Name' },
            { name: 'date', label: 'Date' },
          ]}
          resolve={(value) => answers.push(value)}
          truncated={false}
          update={() => undefined}
        />
      </InDialog>,
    );
    expect(footerButtons()).toStrictEqual(['Cancel', 'Create 2 fields']);
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 fields' }));
    expect(answers).toStrictEqual([{ accepted: ['name', 'date'] }]);
  });
});
