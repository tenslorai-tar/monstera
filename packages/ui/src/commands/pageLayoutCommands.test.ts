import type { ContractClient } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, GROUP_DISPLAY, PAGE_LAYOUT_OPTION_TITLES } from '../messages/en.js';
import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { COVER_PAGE_SETTING, PAGE_LAYOUT_SETTING } from '../settings/viewing.js';
import { SettingsStore } from '../settingsStore.js';
import { menuBarModel, ribbonModel } from '../surfaces/projections.js';
import { compareDocumentsCommand } from './compareDocuments.js';
import { fitCommand } from './documentCommands.js';
import { pageLayoutCommands, toggleDarkPageCommand, toggleRulersCommand, toggleSplitViewCommand } from './viewCommands.js';

/** The page layout's commands and the one setting they write (ADR-0284 Decision 5). */

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  dirty: false,
  page: 0,
  pageCount: 4,
  openDocuments: [],
};

function harness(): { readonly settings: SettingsStore; readonly registry: CommandRegistry } {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  return { settings, registry: new CommandRegistry(pageLayoutCommands({ settings })) };
}

/** The layout commands shown checked now. */
function checked(registry: CommandRegistry): string[] {
  return ['continuous', 'single', 'pair', 'facing']
    .map((layout) => `view.page-layout-${layout}`)
    .filter((id) => registry.get(id)?.checked?.(context) === true);
}

describe('the page layout, reached where a person reads (ADR-0284)', () => {
  it('a layout chosen from the control is the setting: Settings reads the value the command wrote', () => {
    const { settings, registry } = harness();
    void registry.get('view.page-layout-pair')?.run(context);
    expect(settings.get(PAGE_LAYOUT_SETTING.id)).toBe('pair');
    expect(checked(registry)).toStrictEqual(['view.page-layout-pair']);
  });

  it('and a layout chosen in Settings is what the control shows checked', () => {
    const { settings, registry } = harness();
    settings.set(PAGE_LAYOUT_SETTING.id, 'facing');
    expect(checked(registry)).toStrictEqual(['view.page-layout-facing']);
  });

  it('a STORED “facing” from today is Continuous facing: its command and its option title say so', () => {
    activateCatalogue('en', EN);
    const { settings, registry } = harness();
    settings.set(PAGE_LAYOUT_SETTING.id, 'facing');
    expect(registry.get('view.page-layout-facing')?.title).toBe(PAGE_LAYOUT_OPTION_TITLES.facing);
    expect(i18n._(PAGE_LAYOUT_OPTION_TITLES.facing)).toBe('Continuous facing');
    expect(PAGE_LAYOUT_SETTING.schema.parse('facing')).toBe('facing');
  });

  it('Show cover page toggles its own setting, off by default', () => {
    const { settings, registry } = harness();
    expect(settings.get(COVER_PAGE_SETTING.id)).toBe(false);
    void registry.get('view.cover-page')?.run(context);
    expect(settings.get(COVER_PAGE_SETTING.id)).toBe(true);
    expect(registry.get('view.cover-page')?.checked?.(context)).toBe(true);
  });

  it('all five sit in the View menu under Page layout, in reading order', () => {
    const { registry } = harness();
    const view = menuBarModel(registry, context).find((menu) => menu.id === 'view');
    const ids = view?.groups.flatMap((group) => group.items.flatMap((entry) => (entry.kind === 'command' ? [entry.command.id] : []))) ?? [];
    expect(ids).toStrictEqual(['view.page-layout-single', 'view.page-layout-continuous', 'view.page-layout-pair', 'view.page-layout-facing', 'view.cover-page']);
    expect(view?.groups.map((group) => group.caption)).toStrictEqual([PAGE_LAYOUT_SETTING.title]);
  });

  it('all five sit in HOME › DISPLAY as small tools, in reading order, and not in Tools (the owner, 2026-11-05)', () => {
    const { registry } = harness();
    const sections = ribbonModel(registry, context);
    const inGroup = (section: string): string[] =>
      sections
        .find((each) => each.section === section)
        ?.groups.filter((group) => group.group === GROUP_DISPLAY)
        .flatMap((group) => group.entries.map((entry) => entry.command.id)) ?? [];
    expect(inGroup('home')).toStrictEqual([
      'view.page-layout-single',
      'view.page-layout-continuous',
      'view.page-layout-pair',
      'view.page-layout-facing',
      'view.cover-page',
    ]);
    expect(inGroup('tools')).toStrictEqual([]);
    const sizes = sections.flatMap((each) => each.groups.flatMap((group) => group.entries.map((entry) => entry.size)));
    expect(new Set(sizes)).toStrictEqual(new Set(['small']));
  });

  it('on Home › Display they stand between Fit page and Split view, so Split view, Dim pages and Compare fold first (the owner, 2026-11-06)', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    const onZoom = (): void => undefined;
    const registry = new CommandRegistry([
      // DELIBERATELY NOT IN DRAWING ORDER: the order asserted is the placements', not this list's.
      compareDocumentsCommand({ client: {} as ContractClient, show: () => undefined }),
      toggleDarkPageCommand({ settings }),
      ...pageLayoutCommands({ settings }),
      toggleSplitViewCommand({ settings }),
      // Tools › Display's one primary, which the registry requires of a group these commands are secondary in.
      toggleRulersCommand({ settings }),
      fitCommand('page', { onZoom }),
      fitCommand('width', { onZoom }),
    ]);
    const home = ribbonModel(registry, context)
      .find((each) => each.section === 'home')
      ?.groups.filter((group) => group.group === GROUP_DISPLAY)
      .flatMap((group) => group.entries.map((entry) => entry.command.id));
    expect(home).toStrictEqual([
      'view.fit-width',
      'view.fit-page',
      'view.page-layout-single',
      'view.page-layout-continuous',
      'view.page-layout-pair',
      'view.page-layout-facing',
      'view.cover-page',
      'view.toggle-split',
      'view.toggle-dark-page',
      'document.compare',
    ]);
  });

  it('CONTROL: as installed, Continuous is the one checked, as every document has always opened', () => {
    expect(checked(harness().registry)).toStrictEqual(['view.page-layout-continuous']);
  });
});
