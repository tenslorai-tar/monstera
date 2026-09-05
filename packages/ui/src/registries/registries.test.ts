import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CommandRegistry,
  type CommandContext,
  type UiCommand,
} from './commands.js';
import {
  DialogNotRegistered,
  DialogPropsRejected,
  DialogRegistry,
  declareDialog,
} from './dialogs.js';
import { SettingsRegistry, type SettingDefinition } from './settings.js';

const context: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

// The title is a CONSTANT rather than derived from the id, and that is not
// incidental: deriving it made a bad-id case throw out of `messageKey` before
// the registry ever saw the id, so the case asserting the registry's refusal
// was passing on a refusal from somewhere else. Caught because the assertion
// names the message rather than merely expecting a throw.
const ANY_TITLE = messageKey('command.any.label');

function command(id: string, over: Partial<UiCommand> = {}): UiCommand {
  return { id, title: ANY_TITLE, placements: [], run: () => undefined, ...over };
}

describe('CommandRegistry', () => {
  it('refuses two commands claiming one id, and names the id', () => {
    expect(() => new CommandRegistry([command('edit.rotate'), command('edit.rotate')])).toThrow(
      /"edit\.rotate"/u,
    );
  });

  it('CONTROL: two distinct ids are accepted', () => {
    // Without this, "refuses a duplicate" is satisfied by a constructor that
    // refuses everything — which would pass the case above for the wrong reason
    // and take the whole registry with it.
    const registry = new CommandRegistry([command('edit.rotate'), command('edit.delete')]);
    expect(registry.size).toBe(2);
  });

  it('refuses an id the second-wiring scan could not see', () => {
    // The grammar is load-bearing rather than cosmetic: `check:secondwiring`
    // finds ids by matching it, so a camel-cased id is one that scan is blind
    // to — and a hand-written list of such ids would pass the check written to
    // forbid exactly that. Asserted with a camel case rather than with junk,
    // because junk is refused by any check and camel case is the shape someone
    // would actually write.
    expect(() => new CommandRegistry([command('view.toggleQuickToolbar')])).toThrow(
      /check:secondwiring matches ids by it/u,
    );
  });

  it('CONTROL: a hyphenated lower-case id is accepted', () => {
    // Without this, "refuses a bad id" is satisfied by refusing every id — and
    // the message above would then be the only one anybody ever saw.
    expect(new CommandRegistry([command('view.toggle-quick-toolbar')]).size).toBe(1);
  });

  it('treats an absent `when` as always, and a false one as ABSENT rather than disabled', () => {
    const registry = new CommandRegistry([
      command('edit.always'),
      command('edit.never', { when: () => false }),
      command('edit.sometimes', { when: (ctx) => ctx.hasSelection }),
    ]);

    // The assertion is the SET, not a count: "two are available" is also what a
    // registry that dropped the wrong one produces.
    expect(registry.available(context).map((c) => c.id)).toStrictEqual(['edit.always']);
    expect(
      registry.available({ ...context, hasSelection: true }).map((c) => c.id),
    ).toStrictEqual(['edit.always', 'edit.sometimes']);
  });

  it('hands `when` the context it was given, never one it reached for', () => {
    // Decision 5. A predicate that read a module-level store would pass every
    // case above too, because those contexts happen to match the ambient state.
    // This one asserts the ARGUMENT, which only a passed-in context can produce.
    const seen: CommandContext[] = [];
    const registry = new CommandRegistry([
      command('edit.watch', {
        when: (ctx) => {
          seen.push(ctx);
          return true;
        },
      }),
    ]);

    const other: CommandContext = {
      docId: undefined,
      version: undefined,
      hasSelection: true,
      dirty: true,
      page: undefined,
      pageCount: undefined,
      openDocuments: [],
    };
    registry.available(other);

    expect(seen).toStrictEqual([other]);
  });
});

describe('DialogRegistry', () => {
  // Built through `declareDialog` rather than as an object literal, because
  // that is now the only way to obtain a `mount` — and a fixture that could
  // sidestep the builder would be a fixture proving something no caller does.
  const rename = declareDialog({
    id: 'dialog.rename',
    title: messageKey('dialog.rename.title'),
    props: z.object({ name: z.string().min(1) }),
    // The component is never mounted here; these cases are about the schema
    // gate, which is the half that runs before anything renders.
    component: null as never,
  });

  it('refuses props its schema refuses, at the open call', () => {
    const registry = new DialogRegistry([rename]);
    expect(() => registry.openWith('dialog.rename', { name: '' })).toThrow(DialogPropsRejected);
  });

  it('CONTROL: props the schema accepts come back parsed', () => {
    // The refusal case alone is satisfied by an `openWith` that throws for
    // everything, which would make every dialog unopenable.
    const registry = new DialogRegistry([rename]);
    expect(registry.openWith('dialog.rename', { name: 'chapter one' }).props).toStrictEqual({
      name: 'chapter one',
    });
  });

  it('refuses an unregistered id rather than opening nothing', () => {
    const registry = new DialogRegistry([rename]);
    expect(() => registry.openWith('dialog.absent', {})).toThrow(DialogNotRegistered);
  });

  it('refuses two dialogs claiming one id', () => {
    expect(() => new DialogRegistry([rename, { ...rename }])).toThrow(/"dialog\.rename"/u);
  });
});

describe('SettingsRegistry', () => {
  function setting(over: Partial<SettingDefinition> = {}): SettingDefinition {
    return {
      id: 'general.theme',
      title: messageKey('setting.theme.label'),
      schema: z.enum(['light', 'dark', 'system']),
      fallback: 'system',
      category: 'appearance',
      ...over,
    };
  }

  it('refuses a fallback its own schema refuses', () => {
    // The defect this catches appears on a fresh install and on no machine that
    // has ever written the value, which is why it is a construction-time check
    // rather than something `read` copes with.
    expect(() => new SettingsRegistry([setting({ fallback: 'chartreuse' })])).toThrow(
      /"general\.theme" has a fallback/u,
    );
  });

  it('CONTROL: a fallback the schema accepts constructs', () => {
    expect(new SettingsRegistry([setting()]).size).toBe(1);
  });

  it('yields the fallback for an unset value, and for one the schema refuses', () => {
    const registry = new SettingsRegistry([setting()]);
    expect(registry.read('general.theme', undefined)).toBe('system');
    expect(registry.read('general.theme', 'chartreuse')).toBe('system');
  });

  it('CONTROL: a stored value the schema accepts is returned, not the fallback', () => {
    // Both lines above yield 'system', which is also what a `read` that ignored
    // its argument entirely would return every time.
    const registry = new SettingsRegistry([setting()]);
    expect(registry.read('general.theme', 'dark')).toBe('dark');
  });

  it('runs a migration before validating, and falls back when one throws', () => {
    const registry = new SettingsRegistry([
      setting({ id: 'general.old', migrate: (stored) => (stored === 'nite' ? 'dark' : stored) }),
      setting({
        id: 'general.broken',
        migrate: () => {
          throw new Error('unreadable');
        },
      }),
    ]);

    // A migration that ran would turn this into a valid value; one that did not
    // would fall back. The two are distinguishable only by the RESULT being the
    // migrated value rather than either input or default.
    expect(registry.read('general.old', 'nite')).toBe('dark');
    expect(registry.read('general.broken', 'dark')).toBe('system');
  });

  it('excludes secrets from export, and includes everything else', () => {
    const registry = new SettingsRegistry([
      setting({ id: 'general.theme' }),
      setting({ id: 'ai.key', schema: z.string(), fallback: '', secret: true, category: 'privacy' }),
    ]);

    // Both halves, because "excludes secrets" is satisfied by an `exportable`
    // that returns nothing — which is the failure that looks like safety.
    expect(registry.exportable().map((s) => s.id)).toStrictEqual(['general.theme']);
    expect(registry.size).toBe(2);
  });

  it('refuses reading an id nobody registered rather than answering with a fallback', () => {
    // Answering would hide a caller and a registry that disagree about what
    // exists, and the symptom would be a setting that never changes.
    const registry = new SettingsRegistry([setting()]);
    expect(() => registry.read('general.absent', 'dark')).toThrow(/"general\.absent"/u);
  });
});
