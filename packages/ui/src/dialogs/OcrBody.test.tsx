// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, OCR_HANDWRITING, OCR_HANDWRITING_READY, OCR_START, OCR_UNAVAILABLE } from '../messages/en.js';
import OcrBody from './OcrBody.js';

/**
 * The recognition dialog's one line about handwriting (ADR-0085 Decision 5).
 *
 * Handwriting is read by the network engines only, and a key is what makes their
 * tools appear — so the line has to reach a reader in BOTH of the dialog's states,
 * including the one with no installed model, where it is the only way forward.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

/** A message's English text, refusing a key the catalogue lacks rather than matching `undefined`. */
function english(key: MessageKey): string {
  const text = EN[key];
  if (text === undefined) throw new Error(`the English catalogue has no entry for ${key}`);
  return text;
}

const handwritingLine = english(OCR_HANDWRITING);

describe('the recognition dialog', () => {
  it('says where handwriting is read when models are installed', () => {
    render(
      <Wrapped>
        <OcrBody pages={[0]} languages={['eng']} chosen={['eng']} servicesReady={false} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    // THE CONTROL that this is the installed branch: its start button is there.
    expect(screen.getByRole('button', { name: english(OCR_START) })).toBeDefined();
    expect(screen.getByText(handwritingLine)).toBeDefined();
    // NO LINK YET, by the owner's instruction: one line, pointing at Settings.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('and when none are, beside the sentence saying so', () => {
    render(
      <Wrapped>
        <OcrBody pages={[0]} languages={[]} chosen={['eng']} servicesReady={false} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(OCR_UNAVAILABLE))).toBeDefined();
    expect(screen.queryByRole('button', { name: english(OCR_START) })).toBeNull();
    expect(screen.getByText(handwritingLine)).toBeDefined();
  });

  it('with a service’s key STORED it says where the tool is, and not "add a key" (§10.5)', () => {
    render(
      <Wrapped>
        <OcrBody pages={[0]} languages={['eng']} chosen={['eng']} servicesReady resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(OCR_HANDWRITING_READY))).toBeDefined();
    // THE CONTROL: the no-key sentence is exactly what a person with a key must not be told.
    expect(screen.queryByText(handwritingLine)).toBeNull();
  });

  it('with NO key, offers the Help centre’s article on getting one, and answers with it', () => {
    const answers: unknown[] = [];
    render(
      <Wrapped>
        <OcrBody
          pages={[0]}
          languages={['eng']} chosen={['eng']}
          servicesReady={false}
          resolve={(answer) => answers.push(answer)}
          update={() => undefined}
        />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'How to get a key, and what it costs' }));
    expect(answers).toStrictEqual([{ help: 'ai-keys-and-pricing' }]);
  });

  it('CONTROL: with a key stored there is no such link — the person it is for has one', () => {
    render(
      <Wrapped>
        <OcrBody pages={[0]} languages={['eng']} chosen={['eng']} servicesReady resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.queryByRole('button', { name: 'How to get a key, and what it costs' })).toBeNull();
  });

  it('names both services and Settings, and no link', () => {
    expect(handwritingLine).toMatch(/Azure/u);
    expect(handwritingLine).toMatch(/Anthropic/u);
    expect(handwritingLine).toMatch(/Settings/u);
  });
});

/** The box for one language, by the value it carries rather than its label, which is the catalogue's. */
function box(language: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[data-ocr-language="${language}"]`);
  if (found === null) throw new Error(`no box for ${language}`);
  return found;
}

/** Renders the dialog over four provisioned models and a stored setting, recording what it answers. */
function opened(chosen: readonly ('eng' | 'deu' | 'fra' | 'spa' | 'heb')[]): unknown[] {
  const answers: unknown[] = [];
  render(
    <Wrapped>
      <OcrBody
        pages={[0]}
        languages={['eng', 'spa', 'fra', 'deu']}
        chosen={chosen}
        servicesReady={false}
        resolve={(answer) => answers.push(answer)}
        update={() => undefined}
      />
    </Wrapped>,
  );
  return answers;
}

const ticked = (): string[] =>
  ['eng', 'spa', 'fra', 'deu'].filter((language) => box(language).checked);

describe('the recognition dialog’s languages', () => {
  it('OPENS ON THE SETTING — those of its languages this machine has a model for', () => {
    // `heb` is stored and not provisioned; `deu` is both. NOT the first provisioned model, which is what a dialog
    // ignoring the setting would tick.
    opened(['heb', 'deu']);
    expect(ticked()).toStrictEqual(['deu']);
  });

  it('CONTROL: and on the first provisioned model where the machine has none of the stored ones', () => {
    opened(['heb']);
    expect(ticked()).toStrictEqual(['eng']);
  });

  it('answers EVERY ticked language, in the order ticked', () => {
    const answers = opened(['deu']);
    fireEvent.click(box('eng'));
    fireEvent.click(screen.getByRole('button', { name: english(OCR_START) }));
    expect(answers).toStrictEqual([{ pages: 'all', languages: ['deu', 'eng'] }]);
  });

  it('the LAST ticked box cannot be cleared, so the offer never holds an empty set', () => {
    opened(['deu']);
    expect(box('deu').disabled).toBe(true);
    // CONTROL: with a second ticked, either may go.
    fireEvent.click(box('eng'));
    expect(box('deu').disabled).toBe(false);
    expect(box('eng').disabled).toBe(false);
  });

  it('at THREE, the unticked boxes are refused in the offer; below it they are not', () => {
    opened(['eng', 'fra']);
    // CONTROL FIRST: two ticked, and the others may still be added.
    expect(box('spa').disabled).toBe(false);
    fireEvent.click(box('deu'));
    expect(ticked()).toStrictEqual(['eng', 'fra', 'deu']);
    expect(box('spa').disabled).toBe(true);
    // AND THE TICKED ONES MAY STILL BE CLEARED at the maximum.
    expect(box('fra').disabled).toBe(false);
  });
});
