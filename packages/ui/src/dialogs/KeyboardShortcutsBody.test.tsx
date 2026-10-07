// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, GRID_TITLE, KEYBOARD_SHORTCUTS_TITLE, SAVE_TITLE, SHOW_SEARCH_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import KeyboardShortcutsBody from './KeyboardShortcutsBody.js';

/**
 * Help › Keyboard shortcuts: a list to READ (ADR-0191). Where a key is changed is `ShortcutEditor.test.tsx`'s, and each
 * case here has that editor's presence as its contrast.
 */

/** IN THE DIALOG, as the registry mounts it: the footer's Close is the popup's own close and exists only inside one. */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={KEYBOARD_SHORTCUTS_TITLE}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

const ROWS = [
  { id: 'document.save', title: SAVE_TITLE, chord: 'Ctrl+S', fallback: 'Ctrl+S', also: [] },
  { id: 'view.toggle-grid', title: GRID_TITLE, chord: 'Ctrl+G', fallback: 'Ctrl+G', also: ['Ctrl+Shift+G'] },
  { id: 'a.unbound', title: SHOW_SEARCH_TITLE, chord: null, fallback: null, also: [] },
] as const;

function drawn(dropped: readonly string[] = []): void {
  render(<KeyboardShortcutsBody rows={ROWS} dropped={dropped} resolve={() => undefined} update={() => undefined} />, {
    wrapper: Wrapped,
  });
}

describe('KeyboardShortcutsBody', () => {
  it('lists every command with its keys, and a command with none says so', () => {
    drawn();
    expect(screen.getByRole('rowheader', { name: i18n._(SAVE_TITLE) })).toBeDefined();
    expect(screen.getByText('Ctrl+S')).toBeDefined();
    // A FURTHER KEY a command answers is shown beside its first.
    expect(screen.getByText('Ctrl+Shift+G')).toBeDefined();
    expect(screen.getByText('None')).toBeDefined();
  });

  it('draws NO editing column: two column headers, no Change, Reset, Remove or Reset all (ADR-0191)', () => {
    drawn();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    for (const name of ['Change', 'Reset', 'Remove', 'Reset all shortcuts']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    // CONTROL: the footer still has its Close, so the absences above are the editing's and not the footer's.
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('names the commands whose chosen key went back to its default, and CONTROL: says nothing when none did', () => {
    drawn(['view.toggle-grid']);
    expect(screen.getByText(new RegExp(`${i18n._(GRID_TITLE)}\\.$`, 'u'))).toBeDefined();
    cleanup();
    drawn();
    expect(screen.queryByText(/went back to their usual keys/u)).toBeNull();
  });
});
