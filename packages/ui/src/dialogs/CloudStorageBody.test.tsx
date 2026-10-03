// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, CLOUD_TITLE, EN } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import CloudStorageBody from './CloudStorageBody.js';

/** IN THE DIALOG, as the registry mounts it: the footer's Close is the popup's own close and exists only inside one. */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={CLOUD_TITLE}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

/**
 * The cloud list's rows. The Stage 9 run found four files with one name drawn as four identical rows; each row
 * now says when its file changed and how large it is, which is what the listing already carried.
 */
describe('CloudStorageBody', () => {
  it('two files with ONE NAME read differently: each row says when it changed and how large it is', () => {
    const at = (day: number): number => new Date(2025, 0, day, 9).getTime();
    render(
      <Wrapped>
        <CloudStorageBody
          providers={[{ provider: 'onedrive', state: 'signed-in' }]}
          listing={{
            provider: 'onedrive',
            files: [
              { id: 'a', name: 'lease.pdf', size: 2_516_582, modified: at(10) },
              { id: 'b', name: 'lease.pdf', size: 655_360, modified: at(3) },
            ],
          }}
          documentOpen={false}
          resolve={() => undefined}
          update={() => undefined}
        />
      </Wrapped>,
    );

    const rows = [...document.querySelectorAll('.m-cloud__file')];
    expect(rows.map((row) => row.querySelector('.m-dialog-row__note')?.textContent)).toStrictEqual([
      'Jan 10 · 2.4 MB',
      'Jan 3 · 640 KB',
    ]);
    // THE NAMES are still both there and still the same — the line is what separates them.
    expect(rows.map((row) => row.querySelector('.m-cloud__file-name')?.textContent)).toStrictEqual(['lease.pdf', 'lease.pdf']);
    // And each Open button is still named by its file.
    expect(screen.getAllByRole('button', { name: /lease\.pdf/u })).toHaveLength(2);
  });

  it('GOOGLE’S PICKER is offered signed in and signed out, answers pick — and CONTROL: never for OneDrive or unconfigured', () => {
    const answers: unknown[] = [];
    const shown = (state: 'signed-in' | 'signed-out' | 'not-configured'): HTMLElement[] => {
      const { unmount } = render(
        <Wrapped>
          <CloudStorageBody
            providers={[
              { provider: 'onedrive', state: 'signed-in' },
              { provider: 'google-drive', state },
            ]}
            documentOpen={false}
            resolve={(answer) => answers.push(answer)}
            update={() => undefined}
          />
        </Wrapped>,
      );
      const buttons = screen.queryAllByRole('button', { name: 'Choose a file…' });
      buttons[0]?.click();
      unmount();
      return buttons;
    };

    expect(shown('signed-out')).toHaveLength(1);
    expect(shown('signed-in')).toHaveLength(1);
    expect(answers).toStrictEqual([
      { kind: 'pick', provider: 'google-drive' },
      { kind: 'pick', provider: 'google-drive' },
    ]);
    // ONE BUTTON with OneDrive signed in beside it, so OneDrive has none; and none where Google is not configured.
    expect(shown('not-configured')).toHaveLength(0);
  });

  // IN THE PATTERN (the owner, 2 October): a section per provider named by its heading, its state at the heading's
  // right, one line, the main action first and filled, and Sign out quieter and apart at the end of the row.
  it('each provider is a SECTION with its state, a line, its main action first and Sign out apart', () => {
    render(
      <Wrapped>
        <CloudStorageBody
          providers={[
            { provider: 'onedrive', state: 'signed-out' },
            { provider: 'google-drive', state: 'signed-in' },
          ]}
          documentOpen
          resolve={() => undefined}
          update={() => undefined}
        />
      </Wrapped>,
    );
    const onedrive = screen.getByRole('region', { name: 'OneDrive' });
    expect(onedrive.querySelector('.m-dialog-section__state')?.textContent).toBe('Not signed in');
    expect(onedrive.querySelector('.m-dialog-section__note')?.textContent).toBe(
      'Sign in to open your PDFs from OneDrive and upload copies to it.',
    );
    const signIn = within(onedrive).getByRole('button', { name: 'Sign in' });
    expect(signIn.className).toContain('m-button--primary');
    expect(within(onedrive).queryByRole('button', { name: 'Sign out' })).toBeNull();

    const google = screen.getByRole('region', { name: 'Google Drive' });
    expect(google.querySelector('.m-dialog-section__state')?.textContent).toBe('Signed in');
    const actions = [...google.querySelectorAll('.m-dialog-actions button')].map((button) => button.textContent);
    // THE MAIN ACTION FIRST, Sign out last.
    expect(actions).toStrictEqual(['Show my PDFs', 'Upload this document', 'Choose a file…', 'Sign out']);
    const signOut = within(google).getByRole('button', { name: 'Sign out' });
    expect(signOut.closest('.m-dialog-actions__apart')).not.toBeNull();
    expect(signOut.className).toContain('m-button--quiet');
    // THE FOOTER'S ONE BUTTON puts the window away.
    expect(document.querySelector('.m-dialog-footer')?.textContent).toBe('Close');
  });
});
