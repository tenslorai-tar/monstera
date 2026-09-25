// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { FocusHint } from './FocusHint.js';

afterEach(() => {
  cleanup();
});

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const leave = (available: boolean, shortcut = 'Escape'): UiCommand => ({
  id: 'view.leave-focus',
  title: messageKey('test.leave-focus'),
  shortcut,
  placements: [],
  when: () => available,
  run: () => undefined,
});

function drawn(commands: readonly UiCommand[]): void {
  activateCatalogue('en', EN);
  render(
    <I18nProvider i18n={i18n}>
      <FocusHint registry={new CommandRegistry(commands)} context={context} />
    </I18nProvider>,
  );
}

describe('FocusHint (v5-07)', () => {
  it('names the way out while the key works, in the command’s own spelling', () => {
    drawn([leave(true)]);
    expect(screen.getByText('Focus mode · Escape to return')).toBeDefined();
  });

  it('CONTROL: draws nothing while the command that owns the key is not available — outside Focus', () => {
    // The same command, the same chord, its `when` false: a note drawn unconditionally passes the case above and
    // fails this one.
    drawn([leave(false)]);
    expect(screen.queryByText(/to return/u)).toBeNull();
  });

  it('draws nothing when nothing binds Escape — a sentence naming a dead key is the defect', () => {
    drawn([leave(true, 'Ctrl+Shift+L')]);
    expect(screen.queryByText(/to return/u)).toBeNull();
  });
});
