// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ServiceRefusedBody from './ServiceRefusedBody.js';
import { SERVICE_REFUSED_DIALOG } from './serviceRefused.js';

/**
 * The tables export's refusal: main's sentence, except an Anthropic account out of credit, which
 * reads as the assistant reads it.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

/** Main's sentence for this refusal, quoting the service as `ocrClaude.ts` builds it. */
const MAIN_SAID =
  'the Anthropic account is out of credit (400): Your credit balance is too low to access the Anthropic API.';

describe('the service-refused dialog', () => {
  it('says an account out of credit in the application’s words, not the API’s', () => {
    render(<ServiceRefusedBody detail={MAIN_SAID} page={2} reason="out-of-credit" />, { wrapper: Wrapped });

    expect(
      screen.getByText(
        'Page 2 could not be read, so nothing was written. Your Anthropic account is out of credit — add credit at console.anthropic.com',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/too low to access/u)).toBeNull();
  });

  it('CONTROL: any other refusal shows main’s sentence, which quotes the service', () => {
    const detail = 'the Claude API rejected the request (400): messages.0.content: Field required';
    render(<ServiceRefusedBody detail={detail} page={3} reason="rejected" />, { wrapper: Wrapped });

    expect(screen.getByText(`Page 3 could not be read, so nothing was written. ${detail}`)).toBeTruthy();
  });

  it('refuses props with no reason, so a caller cannot forget to pass it', () => {
    expect(SERVICE_REFUSED_DIALOG.props.safeParse({ page: 1, detail: 'x' }).success).toBe(false);
    expect(SERVICE_REFUSED_DIALOG.props.safeParse({ page: 1, reason: 'out-of-credit', detail: 'x' }).success).toBe(
      true,
    );
  });
});
