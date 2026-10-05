// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { EDIT_STEPS, type MessageKey, PDFIUM_PASSWORD_ERROR } from '@monstera/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import {
  EDIT_REFUSED_OPEN,
  EDIT_REFUSED_PASSWORD,
  EDIT_REFUSED_READ_BACK,
  EN,
  NOTHING_TO_REPLACE,
  PROBLEM_BUSY,
  PROBLEM_REFERENCE_LABEL,
} from '../messages/en.js';
import CommandProblemBody from './CommandProblemBody.js';
import { problemMessage } from './problemMessages.js';

afterEach(cleanup);

/** The catalogue's English for `key`, refusing a key the catalogue does not hold rather than matching `undefined`. */
function english(key: MessageKey): string {
  const text = EN[key];
  if (text === undefined) throw new Error(`the catalogue holds no ${key}`);
  return text;
}

/**
 * What a person reads when PDFium refused an edit (ADR-0169 Decision 5): one sentence per step, the password sentence
 * at `open` alone, and the step and the number as the reference.
 */
describe('an edit PDFium refused says which part of the work refused', () => {
  const refused = (step: (typeof EDIT_STEPS)[number], engineError: number) =>
    ({ code: 'edit-refused', detail: { step, engineError } }) as const;

  it('gives every step a sentence of its own, each saying nothing was changed', () => {
    const keys = EDIT_STEPS.map((step) => problemMessage(refused(step, 0)));
    expect(new Set(keys).size).toBe(EDIT_STEPS.length);
    for (const key of keys) expect(english(key)).toMatch(/, so nothing was changed\.$/u);
  });

  it('the read-back says the owner’s sentence', () => {
    expect(english(problemMessage(refused('read-back', 0)))).toBe(
      'This page uses a font Monstera can’t rewrite yet, so nothing was changed.',
    );
    expect(problemMessage(refused('read-back', 0))).toBe(EDIT_REFUSED_READ_BACK);
  });

  it('PDFium’s password number at OPEN says the document is protected', () => {
    expect(problemMessage(refused('open', PDFIUM_PASSWORD_ERROR))).toBe(EDIT_REFUSED_PASSWORD);
  });

  it('CONTROL: another number at open is the open sentence, and the password number at another step is that step’s', () => {
    // THE DECISION IS THE PAIR: a sentence keyed on the number alone would call a page PDFium could not load protected.
    expect(problemMessage(refused('open', PDFIUM_PASSWORD_ERROR - 1))).toBe(EDIT_REFUSED_OPEN);
    expect(problemMessage(refused('page', PDFIUM_PASSWORD_ERROR))).toBe(problemMessage(refused('page', 0)));
  });

  it('the dialog shows the step and the number as the reference a person can quote', () => {
    activateCatalogue('en', EN);
    render(
      <I18nProvider i18n={i18n}>
        <CommandProblemBody code="edit-refused" detail={{ step: 'generate', engineError: 6 }} />
      </I18nProvider>,
    );
    expect(screen.getByText(english(PROBLEM_REFERENCE_LABEL))).toBeTruthy();
    expect(screen.getByText('generate 6')).toBeTruthy();
  });

  it('CONTROL: a code that carries nothing shows its sentence and no reference', () => {
    activateCatalogue('en', EN);
    render(
      <I18nProvider i18n={i18n}>
        <CommandProblemBody code="document-busy" />
      </I18nProvider>,
    );
    expect(screen.getByText(english(PROBLEM_BUSY))).toBeTruthy();
    expect(screen.queryByText(english(PROBLEM_REFERENCE_LABEL))).toBeNull();
  });
});

describe('a replacement that would change nothing says so (ADR-0169 Decision 6)', () => {
  it('says nothing was changed and names the way that works, in a sentence of its own', () => {
    activateCatalogue('en', EN);
    render(
      <I18nProvider i18n={i18n}>
        <CommandProblemBody code="nothing-to-replace" />
      </I18nProvider>,
    );
    expect(screen.getByText(english(NOTHING_TO_REPLACE))).toBeTruthy();
    expect(english(NOTHING_TO_REPLACE)).toMatch(/^Nothing was changed: .*Edit text\.$/u);
    // ITS OWN, not its neighbour's: a word no single object holds at a point is a different refusal with a different way
    // out, and a table that answered both with one sentence would pass the lines above.
    expect(problemMessage({ code: 'nothing-to-replace' })).not.toBe(problemMessage({ code: 'text-not-in-place' }));
  });
});
