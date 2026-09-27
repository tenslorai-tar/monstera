// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, GRID_TITLE, SAVE_TITLE, SHOW_SEARCH_TITLE } from '../messages/en.js';
import KeyboardShortcutsBody from './KeyboardShortcutsBody.js';
import type { KeyboardShortcutsAnswer } from './keyboardShortcuts.js';

/**
 * The shortcuts dialog's body, where any key is changed (ADR-0111). The command's half — that a report reaches the
 * setting as a difference — is `commands/keyboardShortcuts.test.ts`'; this half is that PRESSING keys is what reports
 * them, and that a refused key reports nothing and says why.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const ROWS = [
  { id: 'document.save', title: SAVE_TITLE, chord: 'Ctrl+S', fallback: 'Ctrl+S', also: [] },
  { id: 'view.toggle-grid', title: GRID_TITLE, chord: 'Ctrl+G', fallback: 'Ctrl+G', also: [] },
  { id: 'a.unbound', title: SHOW_SEARCH_TITLE, chord: null, fallback: null, also: [] },
] as const;

/** The body, recording what it reports. */
function drawn(dropped: readonly string[] = []): KeyboardShortcutsAnswer[] {
  const reported: KeyboardShortcutsAnswer[] = [];
  render(
    <KeyboardShortcutsBody
      rows={ROWS}
      dropped={dropped}
      resolve={() => undefined}
      update={(answer) => reported.push(answer)}
    />,
    { wrapper: Wrapped },
  );
  return reported;
}

/** The row for a command, by the title a person reads. */
const row = (title: string): HTMLElement => {
  const header = screen.getByRole('rowheader', { name: title });
  const found = header.closest('tr');
  if (found === null) throw new Error(`no row for ${title}`);
  return found;
};

describe('KeyboardShortcutsBody', () => {
  it('Change waits for a key, and the key pressed is REPORTED in the form a surface prints', () => {
    const reported = drawn();
    const grid = row(i18n._(GRID_TITLE));
    fireEvent.click(within(grid).getByRole('button', { name: 'Change' }));
    const capture = within(grid).getByRole('button', { name: 'Press the new keys, or Esc to cancel' });
    // MODIFIERS ALONE keep it waiting — the start of a chord is not a refusal.
    fireEvent.keyDown(capture, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(reported).toStrictEqual([]);
    fireEvent.keyDown(capture, { key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true });
    expect(reported).toStrictEqual([{ kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+Shift+M' }]);
    expect(within(grid).getByText('Ctrl+Shift+M')).toBeDefined();
  });

  it('a key another command has is refused, NAMING that command, and nothing is reported', () => {
    const reported = drawn();
    const grid = row(i18n._(GRID_TITLE));
    fireEvent.click(within(grid).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(within(grid).getByRole('button', { name: /Press the new keys/u }), {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
    });
    expect(reported).toStrictEqual([]);
    expect(within(grid).getByRole('alert').textContent).toBe(
      `Ctrl+S already runs ${i18n._(SAVE_TITLE)}. Change that one first, or choose other keys.`,
    );
  });

  it('a key given a moment ago is TAKEN for the next — the list as it stands, not as it opened', () => {
    const reported = drawn();
    const unbound = row(i18n._(SHOW_SEARCH_TITLE));
    fireEvent.click(within(unbound).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(within(unbound).getByRole('button', { name: /Press the new keys/u }), {
      key: 'q',
      code: 'KeyQ',
      ctrlKey: true,
    });
    const grid = row(i18n._(GRID_TITLE));
    fireEvent.click(within(grid).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(within(grid).getByRole('button', { name: /Press the new keys/u }), {
      key: 'q',
      code: 'KeyQ',
      ctrlKey: true,
    });
    expect(reported).toStrictEqual([{ kind: 'choose', id: 'a.unbound', chord: 'Ctrl+Q' }]);
    expect(within(grid).getByRole('alert').textContent).toMatch(/Ctrl\+Q already runs/u);
  });

  it('Escape stops waiting and reports nothing; Remove and Reset report; Reset all reports once', () => {
    const reported = drawn();
    const grid = row(i18n._(GRID_TITLE));
    fireEvent.click(within(grid).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(within(grid).getByRole('button', { name: /Press the new keys/u }), { key: 'Escape', code: 'Escape' });
    expect(within(grid).queryByRole('button', { name: /Press the new keys/u })).toBeNull();
    expect(reported).toStrictEqual([]);

    fireEvent.click(within(grid).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all shortcuts' }));
    expect(reported).toStrictEqual([
      { kind: 'choose', id: 'view.toggle-grid', chord: null },
      { kind: 'choose', id: 'view.toggle-grid', chord: 'Ctrl+G' },
      { kind: 'reset' },
    ]);
  });

  it('names the commands whose chosen key went back to its default, and CONTROL: says nothing when none did', () => {
    drawn(['view.toggle-grid']);
    expect(screen.getByText(new RegExp(`${i18n._(GRID_TITLE)}\\.$`, 'u'))).toBeDefined();
    cleanup();
    drawn();
    expect(screen.queryByText(/went back to their usual keys/u)).toBeNull();
  });
});
