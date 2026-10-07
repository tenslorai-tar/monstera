// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import FieldCopyBody from './FieldCopyBody.js';
import { FIELD_COPY_RESULT } from './fieldCopyResult.js';
import { InDialog } from './inDialog.js';

/**
 * The copy-to-pages dialog: which pages a field is copied onto.
 *
 * It starts with every other page, answers zero-based pages the result schema accepts, and refuses the field's own page
 * in words. The refusal is paired with the answer it would have given, so a dialog that only disabled a button for every
 * input would fail the first case.
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

function mounted(from: number, pageCount: number): unknown[] {
  const answers: unknown[] = [];
  render(
    <Wrapped>
      <FieldCopyBody
        from={from}
        pageCount={pageCount}
        resolve={(answer) => {
          answers.push(answer);
        }}
        update={() => undefined}
      />
    </Wrapped>,
  );
  return answers;
}

describe('the copy-to-pages dialog', () => {
  it('starts with every other page and answers them, zero-based, as the result schema accepts', () => {
    const answers = mounted(1, 4);
    expect(screen.getByLabelText('Pages')).toHaveProperty('value', '1, 3-4');
    fireEvent.click(screen.getByRole('button', { name: 'Copy the field' }));
    expect(answers).toStrictEqual([{ pages: [0, 2, 3] }]);
    expect(FIELD_COPY_RESULT.safeParse(answers[0]).success).toBe(true);
  });

  it('answers the pages that were typed, and not the ones it started with', () => {
    const answers = mounted(0, 6);
    fireEvent.change(screen.getByLabelText('Pages'), { target: { value: '3, 5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy the field' }));
    expect(answers).toStrictEqual([{ pages: [2, 4] }]);
  });

  it('CONTROL: the field’s own page is refused in words and nothing is answered', () => {
    const answers = mounted(1, 4);
    fireEvent.change(screen.getByLabelText('Pages'), { target: { value: '2-3' } });
    expect(screen.getByRole('status').textContent).toMatch(/already on that page/u);
    const button = screen.getByRole('button', { name: 'Copy the field' });
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(button);
    expect(answers).toStrictEqual([]);
  });

  it('CONTROL: a page the document lacks, and an empty box, answer nothing', () => {
    const answers = mounted(0, 3);
    fireEvent.change(screen.getByLabelText('Pages'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy the field' }));
    fireEvent.change(screen.getByLabelText('Pages'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy the field' }));
    expect(answers).toStrictEqual([]);
  });
});
