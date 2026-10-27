// @vitest-environment happy-dom
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, cleanup, render } from '@testing-library/react';
import { type ReactElement, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CommandAnswers, CommandAnswersProvider, idsOf, type Subscription, useLiveContext } from './commandAnswers.js';
import { type CommandContext, CommandRegistry, type UiCommand } from './registries/commands.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { LOUPE_SETTING } from './settings/viewing.js';
import { SettingsStore } from './settingsStore.js';

afterEach(() => {
  cleanup();
});

const TITLE = messageKey('command.any.label');
const BASE: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

/** A registry of two commands: one on the ribbon whose state is a setting a predicate reads, one on the quick toolbar. */
function fixture() {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const command = (id: string, over: Partial<UiCommand>): UiCommand => ({ id, title: TITLE, icon: 'File', placements: [], run: () => undefined, feedback: { kind: 'visible' }, ...over });
  const registry = new CommandRegistry([
    command('test.ribbon-state', {
      placements: [{ surface: 'ribbon', section: 'tools', group: TITLE, order: 1 }],
      // A STORE THE CONTEXT DOES NOT CARRY, the shape ADR-0258's correction exists for.
      checked: () => settings.get(LOUPE_SETTING.id) === true,
    }),
    command('test.quick', { placements: [{ surface: 'quick-toolbar', order: 1 }] }),
  ]);
  return { settings, registry };
}

/** Renders counted, per surface and for the shell. */
const renders = { shell: 0, ribbon: 0, quick: 0 };

function Surface({ name, registry, context, subscription }: { readonly name: 'ribbon' | 'quick'; readonly registry: CommandRegistry; readonly context: CommandContext; readonly subscription: Subscription }): ReactElement {
  const live = useLiveContext(registry, context, subscription);
  // AN EFFECT WITH NO LIST runs once per commit of this component, and only when it rendered.
  useLayoutEffect(() => {
    renders[name] += 1;
  });
  const pressed = registry.get('test.ribbon-state')?.checked?.(live);
  return <p data-surface={name}>{name === 'ribbon' ? String(pressed) : 'quick'}</p>;
}

/** The shell as `App` holds the store: written after each render, read by nothing here. */
function Shell({ settings, registry, quick = ['quick-toolbar'] }: { readonly settings: SettingsStore; readonly registry: CommandRegistry; readonly quick?: Subscription }): ReactElement {
  useLayoutEffect(() => {
    renders.shell += 1;
  });
  const [answers] = useState(() => new CommandAnswers(settings));
  useLayoutEffect(() => {
    answers.update(registry, BASE);
  }, [answers, registry]);
  return (
    <CommandAnswersProvider value={answers}>
      <Surface context={BASE} name="ribbon" registry={registry} subscription={['ribbon']} />
      <Surface context={BASE} name="quick" registry={registry} subscription={quick} />
    </CommandAnswersProvider>
  );
}

describe('each surface subscribes to the answers of the commands it places (ADR-0272)', () => {
  it('a store a predicate reads moving renders the surface placing that command, and neither the shell nor another surface', () => {
    const { settings, registry } = fixture();
    const view = render(<Shell registry={registry} settings={settings} />);
    expect(view.container.querySelector('[data-surface="ribbon"]')?.textContent).toBe('false');
    const before = { ...renders };
    act(() => {
      settings.set(LOUPE_SETTING.id, true);
    });
    // THE NEW STATE IS DRAWN, by the surface that places the command.
    expect(view.container.querySelector('[data-surface="ribbon"]')?.textContent).toBe('true');
    expect(renders.ribbon).toBeGreaterThan(before.ribbon);
    // THE DECISION: nothing else rendered for it.
    expect(renders.shell).toBe(before.shell);
    expect(renders.quick).toBe(before.quick);
  });

  it('CONTROL: the same change renders a surface subscribed to every command, so the count above can see a render', () => {
    const { settings, registry } = fixture();
    render(<Shell quick="all" registry={registry} settings={settings} />);
    const before = { ...renders };
    act(() => {
      settings.set(LOUPE_SETTING.id, true);
    });
    expect(renders.quick).toBeGreaterThan(before.quick);
    expect(renders.shell).toBe(before.shell);
    // AND THE SUBSCRIPTIONS ARE THE PLACEMENTS', from the registry.
    expect(idsOf(registry, ['quick-toolbar'])).toStrictEqual(['test.quick']);
    expect(idsOf(registry, 'all')).toStrictEqual(['test.ribbon-state', 'test.quick']);
  });
});
