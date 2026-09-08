// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import {
  GROUP_ARRANGE,
  GROUP_FILE,
  GROUP_MARKUP,
  GROUP_PAGES,
} from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import { Ribbon } from './Ribbon.js';

/**
 * The rail and the ribbon, as a surface a person operates.
 *
 * `projections.test.ts` covers what the MODEL contains and in what order. These
 * cases are about the half a model cannot have an opinion on: which section is
 * showing, what a section with nothing in it looks like, and whether a click
 * reaches the command's own `run`.
 */

const CONTEXT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

function commandOf(id: string, title: string, placements: readonly Placement[]): UiCommand {
  return {
    id,
    title: messageKey(title),
    placements,
    run: () => undefined,
  };
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

beforeAll(() => {
  activateCatalogue('en', {
    ...EN,
    // The catalogue this surface resolves against. The titles are keys like
    // every other visible string, so a case asserting a name is asserting the
    // catalogue was consulted rather than that an id reached the screen.
    'test.save': 'Save',
    'test.rotate': 'Rotate',
    'test.highlight': 'Highlight',
  });
});

function draw(commands: readonly UiCommand[]): ReturnType<typeof render> {
  return render(
    <Wrapped>
      <Ribbon registry={new CommandRegistry(commands)} context={CONTEXT} />
    </Wrapped>,
  );
}

describe('the ribbon', () => {
  const SAVE = commandOf('a.save', 'test.save', [
    { surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 10 },
  ]);
  const ROTATE = commandOf('b.rotate', 'test.rotate', [
    { surface: 'ribbon', section: 'organize', group: GROUP_ARRANGE, order: 10 },
  ]);

  it('renders NOTHING when no section holds anything', () => {
    // `QuickToolbar`'s rule: an eight-entry rail of disabled buttons over a
    // start screen is a surface that looks broken rather than empty. Asserted
    // as the absence of the container, because an empty one is a thing that can
    // go wrong silently and *absent* is checkable in a way *empty* is not.
    const { container } = draw([commandOf('c.palette', 'test.save', [])]);

    expect(container.querySelector('.m-ribbon')).toBeNull();
  });

  it('opens on the FIRST FILLED section, not on Home whatever Home holds', () => {
    // The separating fixture: the only command is in Organize, which is third
    // in the rail. A ribbon that defaulted to `SECTION_IDS[0]` would render an
    // empty tool area beside a rail whose Home entry looks selected.
    draw([ROTATE]);

    expect(screen.getByRole('toolbar').getAttribute('data-ribbon-active')).toBe('organize');
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDefined();
  });

  it('shows ONE section at a time, and selecting the other swaps them', () => {
    const { container } = draw([SAVE, ROTATE]);

    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();

    const organize = container.querySelector('[data-ribbon-section="organize"]');
    if (!(organize instanceof HTMLButtonElement)) throw new Error('the rail has an Organize tab');
    act(() => {
      organize.click();
    });

    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDefined();
    // AND THE OTHER IS GONE. Without this the case passes for a ribbon that
    // appended sections instead of switching, which is a longer toolbar rather
    // than a rail.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('DISABLES a section with nothing in it, rather than hiding it', () => {
    // A rail that gained an entry per stage would teach the reader that the
    // layout moves. Disabled says *this exists and holds nothing*, which is
    // true of Protect today and will stop being true without an edit here.
    const { container } = draw([SAVE]);

    const protect = container.querySelector('[data-ribbon-section="protect"]');
    expect(protect).not.toBeNull();
    expect(protect?.hasAttribute('disabled')).toBe(true);
    // The control on it: the filled one is NOT disabled, so this is not a rail
    // where every entry is dead.
    expect(container.querySelector('[data-ribbon-section="home"]')?.hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('RUNS the command a button stands for, with the context it was given', () => {
    // The UI half of the wired pair. A ribbon that rendered the right names and
    // dispatched nothing is the display-only defect with a caption on it.
    const ran = vi.fn();
    draw([
      {
        ...commandOf('a.save', 'test.save', [
          { surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 10 },
        ]),
        run: ran,
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(ran).toHaveBeenCalledTimes(1);
    expect(ran).toHaveBeenCalledWith(CONTEXT);
  });

  it('captions a group from the CATALOGUE, not from the placement’s own text', () => {
    // The reason `group` is a `MessageKey` (§7, amended 2026-09-08). This
    // rendered the group's id until then, in every locale, and no lint rule
    // could see it — the string reaches JSX through a variable.
    draw([SAVE]);

    expect(screen.getByText('File')).toBeDefined();
    expect(screen.queryByText('surface.ribbon.group.file')).toBeNull();
  });

  it('falls back when the CHOSEN section empties out under the reader', () => {
    // A section can empty while it is showing: every command in it declares
    // `when`, and a document closing takes them all. A ribbon that kept the
    // selection would show an empty tool area beside a selected rail entry,
    // which reads as broken rather than as empty.
    const { container, rerender } = draw([SAVE, ROTATE]);
    const organize = container.querySelector('[data-ribbon-section="organize"]');
    if (!(organize instanceof HTMLButtonElement)) throw new Error('the rail has an Organize tab');
    act(() => {
      organize.click();
    });
    expect(screen.getByRole('toolbar').getAttribute('data-ribbon-active')).toBe('organize');

    rerender(
      <Wrapped>
        <Ribbon registry={new CommandRegistry([SAVE])} context={CONTEXT} />
      </Wrapped>,
    );

    expect(screen.getByRole('toolbar').getAttribute('data-ribbon-active')).toBe('home');
  });

  it('keeps the Comment tools together, which is what a group is for', () => {
    // One group, two commands, and both under one caption — the assertion that
    // separates a ribbon from a row of buttons.
    draw([
      commandOf('h.a', 'test.highlight', [
        { surface: 'ribbon', section: 'comment', group: GROUP_MARKUP, order: 10 },
      ]),
      commandOf('h.b', 'test.rotate', [
        { surface: 'ribbon', section: 'comment', group: GROUP_MARKUP, order: 20 },
      ]),
      commandOf('h.c', 'test.save', [
        { surface: 'ribbon', section: 'comment', group: GROUP_PAGES, order: 30 },
      ]),
    ]);

    const groups = [...document.querySelectorAll('.m-ribbon__group')];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelectorAll('button')).toHaveLength(2);
    expect(groups[1]?.querySelectorAll('button')).toHaveLength(1);
  });
});
