// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CRASH_REPORT_ADDRESS, CrashReportOffer } from './CrashReportOffer.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The start screen's crash report offer (ADR-0109): the UI half of the pair whose main half is `crashReports.test.ts`
 * (the folder, the Share sheet, the record of what was offered). What this proves is what the controls SEND.
 */

beforeAll(() => {
  activateCatalogue('en', EN);
});
afterEach(() => {
  cleanup();
});

function Wrapped({ children }: { readonly children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** A client answering the report channels as the case says, recording every call. */
function client(
  report: { id: string; crashedAt: string } | null,
  outcome: 'offered' | 'unavailable' | 'failed' | 'gone' = 'offered',
): { readonly client: ContractClient; readonly sent: { id: string; params: unknown }[] } {
  const sent: { id: string; params: unknown }[] = [];
  return {
    sent,
    client: createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'crashReport.pending') return Promise.resolve({ ok: true, value: { report } });
      if (id === 'crashReport.share') return Promise.resolve({ ok: true, value: { outcome } });
      if (id === 'crashReport.dismiss') return Promise.resolve({ ok: true, value: { dismissed: true } });
      if (id === 'window.copyText') return Promise.resolve({ ok: true, value: { copied: true } });
      throw new Error(`this case does not answer ${id}`);
    }),
  };
}

const REPORT = { id: 'b0a1c2.dmp', crashedAt: '2026-09-26T10:00:00.000Z' };

async function drawn(wire: ReturnType<typeof client>): Promise<void> {
  render(<CrashReportOffer client={wire.client} />, { wrapper: Wrapped });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the crash report offer (ADR-0109)', () => {
  it('draws NOTHING when the last run left no report', async () => {
    await drawn(client(null));
    expect(screen.queryByText(/closed unexpectedly/u)).toBeNull();
  });

  it('asks, names the address, and says what a report can hold', async () => {
    await drawn(client(REPORT));
    expect(screen.getByText('Monstera closed unexpectedly last time. Send us the crash report?')).toBeDefined();
    expect(screen.getByText(new RegExp(CRASH_REPORT_ADDRESS.replace('.', '\\.'), 'u'))).toBeDefined();
    expect(screen.getByText(/can contain parts of the documents that were open/u)).toBeDefined();
  });

  it('SHARE sends that report to the Share sheet, and the offer goes once the sheet is shown', async () => {
    const wire = client(REPORT);
    await drawn(wire);
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(wire.sent.filter((call) => call.id === 'crashReport.share')).toStrictEqual([
      { id: 'crashReport.share', params: { id: REPORT.id } },
    ]);
    expect(screen.queryByText(/closed unexpectedly/u)).toBeNull();
  });

  it('CONTROL: a sheet that could not open keeps the offer and says nothing was shared', async () => {
    await drawn(client(REPORT, 'failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('The Windows Share window couldn’t open, so nothing was shared.')).toBeDefined();
    expect(screen.getByText(/closed unexpectedly/u)).toBeDefined();
  });

  it('NOT NOW stops offering that report, and sends nothing to the sheet', async () => {
    const wire = client(REPORT);
    await drawn(wire);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(wire.sent.map((call) => call.id)).toStrictEqual(['crashReport.pending', 'crashReport.dismiss']);
    expect(screen.queryByText(/closed unexpectedly/u)).toBeNull();
  });

  it('COPY ADDRESS copies exactly the address, through main, and says so only when main did', async () => {
    const wire = client(REPORT);
    await drawn(wire);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(wire.sent.find((call) => call.id === 'window.copyText')?.params).toStrictEqual({ text: 'report@monsterapdf.com' });
    expect(screen.getByText('Copied')).toBeDefined();
  });
});
