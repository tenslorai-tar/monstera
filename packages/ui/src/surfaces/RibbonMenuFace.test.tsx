// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, GROUP_ADJUST } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { RIBBON_SECTION_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { Ribbon } from './Ribbon.js';

/**
 * A ribbon menu whose FACE RUNS a member (ADR-0241, reinstated by ADR-0264 with Edit object): the owner's *"Clicking the button itself should enter 'Edit all
 * objects', or the last choice."* The control is a menu that declares nothing, which still only opens — Forms › Data's
 * shape — so a face that ran something for every menu fails here.
 */

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const MODE = messageKey('test.face.mode');
const PLAIN = messageKey('test.face.plain');

function commandOf(id: string, title: string, placements: readonly Placement[]): UiCommand {
  return { id, title: messageKey(title), icon: 'File', placements, run: vi.fn(), feedback: { kind: 'visible' } };
}

// `runs` HAS NO DEFAULT: an explicit `undefined` would take one, and the control would declare the very thing it lacks.
const member = (id: string, title: string, order: number, menu: typeof MODE, runs: 'last' | undefined): UiCommand =>
  commandOf(id, title, [
    runs === undefined
      ? { surface: 'ribbon', section: 'organize', group: GROUP_ADJUST, order, menu }
      : { surface: 'ribbon', section: 'organize', group: GROUP_ADJUST, order, menu, menuRuns: runs },
  ]);

beforeAll(() => {
  activateCatalogue('en', {
    ...EN,
    'test.face.mode': 'Edit object',
    'test.face.all': 'Edit all objects',
    'test.face.images': 'Edit images',
    'test.face.plain': 'Export',
    'test.face.pdf': 'PDF data',
    'test.face.csv': 'CSV',
  });
});

function draw(commands: readonly UiCommand[]): void {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  settings.hydrate({ [RIBBON_SECTION_SETTING.id]: 'organize' });
  render(
    <I18nProvider i18n={i18n}>
      <Ribbon registry={new CommandRegistry(commands)} context={CONTEXT} settings={settings} />
    </I18nProvider>,
  );
}

describe('a ribbon menu whose face runs its last choice (ADR-0241)', () => {
  it('runs the first member from the face until another is chosen, then the one chosen', () => {
    const all = member('m.all', 'test.face.all', 10, MODE, 'last');
    const images = member('m.images', 'test.face.images', 20, MODE, 'last');
    draw([all, images]);

    const face = screen.getByRole('button', { name: 'Edit object' });
    // THE DESCRIPTION SAYS WHAT A PRESS WILL DO, the member's own title.
    expect(face.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(face.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Edit all objects');
    fireEvent.click(face);
    expect(all.run).toHaveBeenCalledTimes(1);
    expect(images.run).not.toHaveBeenCalled();

    // THE CHEVRON opens the menu, and choosing from it runs the member and makes it the face's.
    fireEvent.click(screen.getByRole('button', { name: 'Choices for Edit object' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit images' }));
    expect(images.run).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit object' }));
    expect(images.run).toHaveBeenCalledTimes(2);
    expect(all.run).toHaveBeenCalledTimes(1);
    expect(document.getElementById(screen.getByRole('button', { name: 'Edit object' }).getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Edit images',
    );
  });

  it('is ONE unit to the fold: the box holding face and chevron carries the measured id', () => {
    draw([member('m.all', 'test.face.all', 10, MODE, 'last'), member('m.images', 'test.face.images', 20, MODE, 'last')]);
    const measured = document.querySelector('[data-command="m.all"]');
    expect(measured?.classList.contains('m-ribbon__split')).toBe(true);
    expect(measured?.querySelectorAll('button')).toHaveLength(2);
  });

  it('CONTROL: a menu that declares nothing still has one button, and pressing it runs nothing', () => {
    const pdf = member('d.pdf', 'test.face.pdf', 10, PLAIN, undefined);
    const csv = member('d.csv', 'test.face.csv', 20, PLAIN, undefined);
    draw([pdf, csv]);
    expect(screen.queryByRole('button', { name: 'Choices for Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Export/u }));
    expect(pdf.run).not.toHaveBeenCalled();
    expect(csv.run).not.toHaveBeenCalled();
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('the registry refuses a menu whose members disagree, naming them, and menuRuns without a menu', () => {
    expect(() => new CommandRegistry([member('m.all', 'test.face.all', 10, MODE, 'last'), member('m.images', 'test.face.images', 20, MODE, undefined)])).toThrow(
      /"m\.all" \(last\), "m\.images" \(nothing\)/u,
    );
    expect(
      () =>
        new CommandRegistry([
          commandOf('m.lone', 'test.face.all', [{ surface: 'ribbon', section: 'organize', group: GROUP_ADJUST, order: 10, menuRuns: 'last' }]),
        ]),
    ).toThrow(/names no menu/u);
  });
});
