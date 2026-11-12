// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import AppendRefusedBody from './AppendRefusedBody.js';
import { InDialog } from './inDialog.js';

/**
 * The window for a signed document's file that could not take an appended save (ADR-0291 question 4): what it offers
 * where, and what each answers.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <InDialog>{children}</InDialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

function opened(certified: boolean, copying: boolean): string[] {
  const answers: string[] = [];
  render(
    <Wrapped>
      <AppendRefusedBody
        certified={certified}
        copying={copying}
        resolve={(answer) => {
          answers.push(answer);
        }}
        update={() => undefined}
      />
    </Wrapped>,
  );
  return answers;
}

/** The window's labelled buttons, the footer's Cancel among them; the × is the primitive's own and carries no text. */
const buttons = (): (string | null)[] =>
  screen
    .getAllByRole('button')
    .map((button) => button.textContent)
    .filter((label) => label !== '');

describe('the append-refused window', () => {
  it('a save of an uncertified document offers Save anyway and a copy, and each answers itself', () => {
    const answers = opened(false, false);
    expect(buttons()).toStrictEqual(['Cancel', 'Save anyway', 'Save a copy…']);
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    expect(answers).toStrictEqual(['anyway', 'copy']);
    // WHAT SAVE ANYWAY COSTS is said before it is pressed.
    expect(document.body.textContent).toContain('its signatures will no longer verify');
  });

  it('CONTROL: a certified document, and a copy that was refused, offer the copy alone', () => {
    opened(true, false);
    expect(buttons()).toStrictEqual(['Cancel', 'Save a copy…']);
    cleanup();
    opened(false, true);
    expect(buttons()).toStrictEqual(['Cancel', 'Save a copy…']);
  });
});
