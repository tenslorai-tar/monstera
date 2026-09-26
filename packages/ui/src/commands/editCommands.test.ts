// @vitest-environment happy-dom
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { CommandContext, UiCommand } from '../registries/commands.js';
import { type EditDeps, editCommands } from './editCommands.js';

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-0000000000e1'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

/** A page-half command that records its runs and exists while `on()` says so. */
function page(id: string, calls: string[], on: () => boolean): UiCommand {
  return { id, title: messageKey(`command.${id}.title`), placements: [], when: on, run: () => void calls.push(id) };
}

/** The four verbs over recording page halves, a recording native route, and whatever field the case supplies. */
function harness(options: {
  readonly field?: HTMLElement;
  readonly text?: boolean;
  readonly marks?: boolean;
  readonly copied?: boolean;
  readonly pasteable?: boolean;
  readonly markable?: boolean;
  readonly copyWorks?: boolean;
}): { readonly byId: (id: string) => UiCommand; readonly calls: string[] } {
  const calls: string[] = [];
  const deps: EditDeps = {
    field: () => options.field,
    native: (action) => void calls.push(`native ${action}`),
    copyText: page('text.copy', calls, () => options.text === true),
    copyMarks: page('annotate.copy-selection', calls, () => options.marks === true),
    copyMarksFor: () => {
      calls.push('copy marks');
      return Promise.resolve(options.copyWorks ?? true);
    },
    deleteMarks: page('annotate.delete-selection', calls, () => options.marks === true),
    pasteMarks: page('annotate.paste', calls, () => options.pasteable === true),
    selectAllMarks: page('annotate.select-all', calls, () => options.markable === true),
  };
  const commands = editCommands(deps);
  const byId = (id: string): UiCommand => {
    const found = commands.find((command) => command.id === id);
    if (found === undefined) throw new Error(`no ${id}`);
    return found;
  };
  return { byId, calls };
}

/** A text field in the document, with the given value and selection. */
function aField(value: string, from: number, to: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  document.body.append(input);
  input.setSelectionRange(from, to);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the Edit menu’s verbs, in a TEXT FIELD', () => {
  it('run the BROWSER’S OWN verb, after returning the focus to the field', async () => {
    const field = aField('invoice 42', 0, 7);
    const { byId, calls } = harness({ field, marks: true, pasteable: true, markable: true });
    for (const id of ['edit.cut', 'edit.copy', 'edit.paste', 'edit.select-all']) {
      expect(byId(id).when?.(CONTEXT), id).toBe(true);
      await byId(id).run(CONTEXT);
    }
    // THE FIELD FIRST even with marks selected, copied and on the page: the owner's order is the field, then the page.
    expect(calls).toStrictEqual(['native cut', 'native copy', 'native paste', 'native selectAll']);
    expect(document.activeElement).toBe(field);
  });

  it('Cut and Copy are DISABLED in a field with nothing selected in it; Paste and Select all are not', () => {
    const { byId } = harness({ field: aField('invoice 42', 3, 3) });
    expect(byId('edit.cut').when?.(CONTEXT)).toBe(false);
    expect(byId('edit.copy').when?.(CONTEXT)).toBe(false);
    expect(byId('edit.paste').when?.(CONTEXT)).toBe(true);
    expect(byId('edit.select-all').when?.(CONTEXT)).toBe(true);
  });
});

describe('the Edit menu’s verbs, on the PAGE', () => {
  it('Copy copies the page’s selected TEXT first, and the selected marks when there is no text', async () => {
    const both = harness({ text: true, marks: true });
    await both.byId('edit.copy').run(CONTEXT);
    expect(both.calls).toStrictEqual(['text.copy']);

    const marksOnly = harness({ marks: true });
    await marksOnly.byId('edit.copy').run(CONTEXT);
    expect(marksOnly.calls).toStrictEqual(['annotate.copy-selection']);
  });

  it('Cut is COPY THEN DELETE, and runs nothing through the browser', async () => {
    const { byId, calls } = harness({ marks: true });
    await byId('edit.cut').run(CONTEXT);
    expect(calls).toStrictEqual(['copy marks', 'annotate.delete-selection']);
  });

  it('CONTROL: a copy that FAILED deletes nothing — a cut that removed what it could not copy loses it', async () => {
    const { byId, calls } = harness({ marks: true, copyWorks: false });
    await byId('edit.cut').run(CONTEXT);
    expect(calls).toStrictEqual(['copy marks']);
  });

  it('Paste and Select all are the page commands’ own, and each is disabled exactly when its command is absent', async () => {
    const able = harness({ pasteable: true, markable: true });
    await able.byId('edit.paste').run(CONTEXT);
    await able.byId('edit.select-all').run(CONTEXT);
    expect(able.calls).toStrictEqual(['annotate.paste', 'annotate.select-all']);

    const unable = harness({});
    for (const id of ['edit.cut', 'edit.copy', 'edit.paste', 'edit.select-all']) {
      expect(unable.byId(id).when?.(CONTEXT), id).toBe(false);
    }
  });

  it('claims the four clipboard chords and sits in Edit’s second group, in the order every Windows menu draws', () => {
    const { byId } = harness({});
    expect(['edit.cut', 'edit.copy', 'edit.paste', 'edit.select-all'].map((id) => byId(id).shortcut)).toStrictEqual([
      'Ctrl+X',
      'Ctrl+C',
      'Ctrl+V',
      'Ctrl+A',
    ]);
    expect(['edit.cut', 'edit.copy', 'edit.paste', 'edit.select-all'].map((id) => byId(id).placements)).toStrictEqual([
      [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 10 }],
      [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 20 }],
      [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 30 }],
      [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 40 }],
    ]);
  });
});
