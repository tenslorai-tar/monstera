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
 * The tables export's refusal: a plain sentence for what happened to the page, and the service's own words behind
 * *Details* (the owner's screenshot of 2026-10-07 showed the raw API text as the message). An Anthropic account out of
 * credit reads as the assistant reads it.
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
const RAW =
  'the Claude API rejected the request (400): messages.0.content.0.image.source.base64: image dimensions 1191x1684 exceed the maximum image size of a model named on this request and would be downsized to 924x1307';

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

  it('says a rejected request in plain words, with the service’s text only behind Details', () => {
    const { container } = render(<ServiceRefusedBody detail={RAW} page={3} reason="rejected" />, { wrapper: Wrapped });

    expect(
      screen.getByText(
        'Page 3 could not be read, so nothing was written. The service could not use the picture of this page. Try again, or choose a different model in Settings.',
      ),
    ).toBeTruthy();
    // THE RAW TEXT IS IN THE PAGE, inside the disclosure, and NOT in the message above it.
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('Details');
    expect(details?.textContent).toContain('924x1307');
    expect(container.querySelector('p')?.textContent).not.toContain('924x1307');
  });

  it('CONTROL: a refusal with no words of the service’s own draws no Details', () => {
    const { container } = render(<ServiceRefusedBody detail="" page={1} reason="refused" />, { wrapper: Wrapped });
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText(/The service declined to read this page\./u)).toBeTruthy();
  });

  it('refuses props with no reason, so a caller cannot forget to pass it', () => {
    expect(SERVICE_REFUSED_DIALOG.props.safeParse({ page: 1, detail: 'x' }).success).toBe(false);
    expect(SERVICE_REFUSED_DIALOG.props.safeParse({ page: 1, reason: 'out-of-credit', detail: 'x' }).success).toBe(
      true,
    );
  });
});
