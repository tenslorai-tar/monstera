// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { InDialog } from './inDialog.js';
import TabOrderBody from './TabOrderBody.js';
import { TAB_ORDER_RESULT } from './tabOrder.js';

/**
 * The tab order dialog: three orders, row first, and the one chosen is the answer.
 *
 * Each choice is paired with the default it moved off, so a dialog that always answered `row` fails the second case.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <InDialog onOpenChange={() => undefined}>{children}</InDialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

function mounted(): unknown[] {
  const answers: unknown[] = [];
  render(
    <Wrapped>
      <TabOrderBody
        resolve={(answer) => {
          answers.push(answer);
        }}
        update={() => undefined}
      />
    </Wrapped>,
  );
  return answers;
}

describe('the tab order dialog', () => {
  it('answers row when nothing was changed, and it is a member of the result schema', () => {
    const answers = mounted();
    fireEvent.click(screen.getByRole('button', { name: 'Set the tab order' }));
    expect(answers).toStrictEqual([{ order: 'row' }]);
    expect(TAB_ORDER_RESULT.safeParse(answers[0]).success).toBe(true);
  });

  it('answers the order that was chosen, each of the other two', () => {
    for (const [words, order] of [
      ['Down each column, then across', 'column'],
      ['In the order the document was made', 'structure'],
    ] as const) {
      const answers = mounted();
      fireEvent.click(screen.getByLabelText(new RegExp(words, 'u')));
      fireEvent.click(screen.getByRole('button', { name: 'Set the tab order' }));
      expect(answers).toStrictEqual([{ order }]);
      cleanup();
    }
  });

  it('says what each order does in a sentence, so a person is not choosing between three letters', () => {
    mounted();
    expect(screen.getByText(/Left to right along a line of fields/u)).toBeTruthy();
    expect(screen.getByText(/Top to bottom in one column/u)).toBeTruthy();
    expect(screen.getByText(/screen reader reads/u)).toBeTruthy();
  });
});
