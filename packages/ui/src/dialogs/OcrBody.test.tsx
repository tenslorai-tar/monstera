// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { cleanup, render, screen } from '@testing-library/react';
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
        <OcrBody page={0} languages={['eng']} servicesReady={false} resolve={() => undefined} update={() => undefined} />
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
        <OcrBody page={0} languages={[]} servicesReady={false} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(OCR_UNAVAILABLE))).toBeDefined();
    expect(screen.queryByRole('button', { name: english(OCR_START) })).toBeNull();
    expect(screen.getByText(handwritingLine)).toBeDefined();
  });

  it('with a service’s key STORED it says where the tool is, and not "add a key" (§10.5)', () => {
    render(
      <Wrapped>
        <OcrBody page={0} languages={['eng']} servicesReady resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(OCR_HANDWRITING_READY))).toBeDefined();
    // THE CONTROL: the no-key sentence is exactly what a person with a key must not be told.
    expect(screen.queryByText(handwritingLine)).toBeNull();
  });

  it('names both services and Settings, and no link', () => {
    expect(handwritingLine).toMatch(/Azure/u);
    expect(handwritingLine).toMatch(/Anthropic/u);
    expect(handwritingLine).toMatch(/Settings/u);
  });
});
