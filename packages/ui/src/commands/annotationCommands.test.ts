import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';

import { GROUP_MARKUP } from '../messages/en.js';
import { describe, expect, it } from 'vitest';

import { PLAIN_STYLE } from '../annotations/annotationStyle.js';
import type { AnnotationSelection, SelectedAnnotation } from '../annotations/selectTool.js';

/** The style a selected annotation carries. These cases do not read it. */
const PLAIN_ITEM = { colour: [1, 0, 0], opacity: 1, borderWidth: 2 } as const;
/**
 * Everything a selected annotation carries besides its handle and its box.
 *
 * Spread into each fixture rather than written three times, so a field the
 * selection gains is added here once. `contents` is the only one any case below
 * reads, and only the *Edit* ones do.
 */
const CARRIED = { style: PLAIN_ITEM, kind: 'square', contents: '' } as const;
import { ELLIPSE_TOOL_ID, RECTANGLE_TOOL_ID } from '../annotations/shapeTools.js';
import type { CommandContext } from '../registries/commands.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { CONTEXT_PANEL_OPEN_SETTING, CONTEXT_PANEL_TAB_SETTING } from '../settings/layout.js';
import { SettingsRegistry } from '../registries/settings.js';
import { SettingsStore } from '../settingsStore.js';
import {
  copyAnnotationsCommand,
  deleteSelectionCommand,
  editSelectionCommand,
  replySelectionCommand,
  nudgeSelectionCommands,
  rectangleToolCommand,
  selectionPropertiesCommand,
  shapeToolCommands,
} from './annotationCommands.js';

/**
 * The command that selects the rectangle tool.
 *
 * Every case asserts the **call that was made and its argument**, which is the
 * decision this command owns. There is no end state to look at: selecting a
 * tool and selecting nothing both leave a registry unchanged, and the overlay
 * that would show the difference lives two components away.
 */

const WITH_DOCUMENT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 2,
  pageCount: 5,
  openDocuments: [],
};

const START_SCREEN: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

/** The command, plus every id it asked for. */
function built(active: string | undefined): {
  readonly command: ReturnType<typeof rectangleToolCommand>;
  readonly selected: (string | undefined)[];
} {
  const selected: (string | undefined)[] = [];
  const command = rectangleToolCommand({
    activeTool: () => active,
    onSelect: (id): void => {
      selected.push(id);
    },
  });
  return { command, selected };
}

describe('rectangleToolCommand', () => {
  it('is registered under the TOOL\'s id, which is what joins the two registries', () => {
    // Not a resemblance and not a mapping: the command sets this string and the
    // tool registry is keyed by it, so a command whose id merely looked like
    // the tool's would select nothing at all.
    expect(built(undefined).command.id).toBe(RECTANGLE_TOOL_ID);
  });

  it('selects the tool when nothing is active', () => {
    const { command, selected } = built(undefined);
    void command.run(WITH_DOCUMENT);
    expect(selected).toStrictEqual([RECTANGLE_TOOL_ID]);
  });

  it('deselects when it is already active, so a reader can get back to reading', () => {
    // Until a second tool exists there is no other control that leaves drawing
    // mode, so without this the first rectangle a person draws would leave them
    // unable to select text.
    const { command, selected } = built(RECTANGLE_TOOL_ID);
    void command.run(WITH_DOCUMENT);
    expect(selected).toStrictEqual([undefined]);
  });

  it('selects when a DIFFERENT tool is active, rather than turning drawing off', () => {
    // THE SEPARATOR between a toggle and a switch. With only one tool
    // registered the two agree on every input, so this case existed before the
    // second tool did — and now names a real one, because an id nothing
    // registers tests a comparison against a value the application cannot hold.
    const { command, selected } = built(ELLIPSE_TOOL_ID);
    void command.run(WITH_DOCUMENT);
    expect(selected).toStrictEqual([RECTANGLE_TOOL_ID]);
  });

  it('reads the active tool at RUN time, not at registration', () => {
    // The command object is built once. A captured id would toggle against
    // whatever was active when the registry was composed, for ever — which
    // reads correctly on the first press and never again.
    let active: string | undefined;
    const selected: (string | undefined)[] = [];
    const command = rectangleToolCommand({
      activeTool: () => active,
      onSelect: (id): void => {
        selected.push(id);
        active = id;
      },
    });

    void command.run(WITH_DOCUMENT);
    void command.run(WITH_DOCUMENT);

    expect(selected).toStrictEqual([RECTANGLE_TOOL_ID, undefined]);
  });

  it('does not exist without a document to draw on', () => {
    const { command } = built(undefined);
    expect(command.when?.(START_SCREEN)).toBe(false);
    expect(command.when?.(WITH_DOCUMENT)).toBe(true);
  });

  it('every shape tool has a command, and each one selects its OWN tool', () => {
    // THE JOIN, asserted across the set rather than for the one that was
    // written first. Four commands built from one factory are four chances for
    // a copied id, and a command selecting the wrong tool is a control that
    // draws the wrong shape with nothing red anywhere.
    const selected: (string | undefined)[] = [];
    const commands = shapeToolCommands({
      activeTool: () => undefined,
      onSelect: (id): void => {
        selected.push(id);
      },
    });
    for (const command of commands) void command.run(WITH_DOCUMENT);

    expect(selected).toStrictEqual(commands.map((command) => command.id));
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
    expect(commands.map((command) => command.id)).toContain(RECTANGLE_TOOL_ID);
  });

  it('EVERY REGISTERED TOOL HAS A COMMAND, which is the direction nothing checked', async () => {
    // THE JOIN'S OTHER HALF, and it is the half that stays quiet. The case
    // above asserts that each command selects its own tool — it iterates the
    // COMMANDS, so a tool with no command is not in the set it walks and
    // nothing about its absence is observable. The failure that leaves is a
    // tool registered in `registries/tools.ts`, reachable by nothing, mounted
    // by no control: code that exists and cannot be used.
    //
    // It is not hypothetical. The sticky note was written, registered as a
    // tool, exercised by twelve cases and shipped with no command at all; the
    // whole suite stayed green, because the one assertion on the pair could
    // only see the side that existed. That is a one-sided set assertion, and
    // the tell is that the argument it holds constant — the command list — is
    // the thing an omission removes from.
    //
    // IT READS THE COMPOSITION THE APP MOUNTS, and that is the second thing
    // this case taught. It used to spread the tool groups itself — a copy of
    // `App.tsx`'s list — and the copy went stale the moment a group was added,
    // failing about its own fixture rather than about the product. A check
    // whose fixture can disagree with the thing it checks costs the same
    // attention as one that misses a defect.
    //
    // `annotationTools` now exists for that reason, so the two sides of this
    // assertion are genuinely different registries rather than a list and a
    // copy of itself.
    const { annotationTools } = await import('../annotations/annotationTools.js');
    const ask = (): Promise<undefined> => Promise.resolve(undefined);

    const toolIds = annotationTools({
      ask,
      annotations: () => Promise.resolve(undefined),
      onSelect: () => undefined,
      selected: () => undefined,
      style: PLAIN_STYLE,
      scale: { perPoint: 1, unit: 'pt' },
      onSnapshot: () => undefined,
      language: () => 'eng' as const,
      onPlaceImage: () => undefined,
      onPlaceSignature: () => undefined,
      onPlaceBarcode: () => undefined,
    }).map((tool) => tool.id);
    const commandIds = shapeToolCommands({
      activeTool: () => undefined,
      onSelect: () => undefined,
    }).map((command) => command.id);

    // SETS, SORTED, so the message names which id is missing rather than
    // reporting that two lists differ in length.
    expect([...commandIds].sort()).toStrictEqual([...toolIds].sort());
  });

  it('gives each control its own place, so two do not claim one slot', () => {
    // THE RIBBON'S ORDERS NOW, because that is where these tools are. The
    // surface moved on 2026-09-08 and the property did not: two tools sharing a
    // number fall back to an id comparison, which is deterministic and is not
    // what anybody meant to declare.
    const placements = shapeToolCommands({
      activeTool: () => undefined,
      onSelect: () => undefined,
    }).flatMap((command) => command.placements);
    const orders = placements
      .filter((placement) => placement.surface === 'ribbon')
      .map((placement) => placement.order);
    expect(new Set(orders).size).toBe(orders.length);
    // AND EVERY TOOL IS IN THE RIBBON, which is the half a filter can lose: a
    // tool placed nowhere contributes no order, so the uniqueness above would
    // pass for a set of one.
    expect(orders).toHaveLength(
      shapeToolCommands({ activeTool: () => undefined, onSelect: () => undefined }).length,
    );
  });

  it('is placed in the ribbon SECTION §7 names, and nowhere else', () => {
    // This case read *"and not on a ribbon nothing renders"* while no ribbon
    // projection was mounted, and it was right then: a placement into a surface
    // that does not exist is the display-only sin arriving through the registry.
    // The ribbon landed on 2026-09-08 and the reasoning inverts — a drawing tool
    // ALSO on the floating pill would be the same button twice on screen, since
    // both are visible at once. §10.3's pill list is select, hand, text
    // selection, zoom, crop, snapshot, bookmark and comment; a rectangle is
    // none of them.
    expect(built(undefined).command.placements).toStrictEqual([
      { surface: 'ribbon', section: 'comment', group: GROUP_MARKUP, order: 40 },
    ]);
  });
});

describe('deleteSelectionCommand', () => {
  const SELECTION = {
    page: 2,
    version: asDocVersion(7),
    items: [
      { index: 1, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, ...CARRIED },
      { index: 4, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, ...CARRIED },
    ],
  };

  it('hands the WHOLE selection over, so one decision is one command', () => {
    const deleted: unknown[] = [];
    const command = deleteSelectionCommand({
      selection: () => SELECTION,
      onDelete: (selection) => {
        deleted.push(selection);
      },
      onPlace: () => undefined,
    });
    void command.run(WITH_DOCUMENT);
    // BOTH INDICES IN ONE CALL. A command that dispatched per item would be
    // five undo steps for one decision, and every handle after the first would
    // be stale — which the kernel refuses, so the visible symptom is one mark
    // deleted and a refusal.
    expect(deleted).toStrictEqual([SELECTION]);
  });

  it('is HIDDEN with nothing selected, rather than present and inert', () => {
    // The wired-tools rule at the registry: `when` is what keeps Delete from
    // being a control that exists and does nothing. Pressing it over a page
    // with no selection does nothing because nothing is registered.
    const deps = {
      selection: (): undefined => undefined,
      onDelete: (): undefined => undefined,
      onPlace: (): undefined => undefined,
    };
    expect(deleteSelectionCommand(deps).when?.(WITH_DOCUMENT)).toBe(false);
    expect(
      deleteSelectionCommand({ ...deps, selection: () => SELECTION }).when?.(WITH_DOCUMENT),
    ).toBe(true);
  });

  it('reads the selection THROUGH the function, not from what it was built with', () => {
    // A command is built once. A captured selection would be whatever was
    // selected at registration for ever, which for `when` means a control that
    // appears once and never leaves.
    let current: typeof SELECTION | undefined = undefined;
    const command = deleteSelectionCommand({
      selection: () => current,
      onDelete: () => undefined,
      onPlace: () => undefined,
    });
    expect(command.when?.(WITH_DOCUMENT)).toBe(false);
    current = SELECTION;
    expect(command.when?.(WITH_DOCUMENT)).toBe(true);
  });

  it('reaches the keyboard and the annotation menu, and no toolbar', () => {
    // It acts on a selection rather than turning a mode on, so it is not a
    // twelfth control beside the tools. `Delete` is on the command because that
    // is where a key reaches a feature — a handler on the overlay would be the
    // second wiring place the palette and the menu would then have to agree
    // with.
    const command = deleteSelectionCommand({
      selection: () => SELECTION,
      onDelete: () => undefined,
      onPlace: () => undefined,
    });
    expect(command.shortcut).toBe('Delete');
    // LAST in the owner's order for that menu — edit, reply, properties, copy, delete — which is
    // why this is 50 rather than 10, with the gaps held for the items still owed.
    expect(command.placements).toStrictEqual([
      { surface: 'context-menu', context: 'annotation', order: 50 },
    ]);
  });
});

describe('editSelectionCommand', () => {
  // DECLARED TYPES rather than inferred: with `as const` the fixture's type is
  // `kind: 'sticky-note'` and `index: 1` exactly, and the two cases below that
  // vary those fields stop fitting the parameter. `npm run build` is what says
  // so — vitest does not typecheck, so the cases were green while the tree did
  // not compile.
  const NOTE: SelectedAnnotation = {
    index: 1,
    rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
    style: PLAIN_ITEM,
    kind: 'sticky-note',
    contents: 'what it said before',
  };
  const SELECTION: AnnotationSelection = {
    page: 2,
    version: asDocVersion(7),
    items: [NOTE],
  };

  function editing(selection: AnnotationSelection | undefined, answer: unknown) {
    const placed: unknown[] = [];
    const asked: { id: string; props: unknown }[] = [];
    return {
      placed,
      asked,
      command: editSelectionCommand({
        selection: () => selection,
        onDelete: () => undefined,
        onPlace: (command) => placed.push(command),
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(answer);
        },
      }),
    };
  }

  it('opens the dialog HOLDING what the mark says, and sends the new text at the selection’s version', async () => {
    // Three numbers the command must not invent: the page and index come from
    // the selection rather than the context, and the version is the one the
    // walk answered at — the bus refuses the command if the document moved.
    const { command, placed, asked } = editing(SELECTION, { text: 'what it says now' });
    await command.run(WITH_DOCUMENT);

    expect(asked).toStrictEqual([
      { id: 'dialog.annotation-edit', props: { text: 'what it said before' } },
    ]);
    expect(placed).toStrictEqual([
      {
        kind: 'editAnnotationText',
        page: 2,
        index: 1,
        text: 'what it says now',
        version: asDocVersion(7),
      },
    ]);
  });

  it('CONTROL: a dismissed dialog sends nothing, and the dialog was still opened', async () => {
    // Without the second half, this passes for a command that never asked —
    // dismissed and never-opened are the same observation unless the ask is
    // counted.
    const { command, placed, asked } = editing(SELECTION, undefined);
    await command.run(WITH_DOCUMENT);
    expect(asked).toHaveLength(1);
    expect(placed).toStrictEqual([]);
  });

  it('is HIDDEN for a kind whose text this build does not DRAW', async () => {
    // A highlight may carry a comment in the format, and nothing here renders
    // one — so offering *Edit* on it would be a control whose effect a person
    // cannot see. The run is asserted too: a `when` that hid the item while the
    // command still acted would be caught by nothing else.
    const highlight = { ...SELECTION, items: [{ ...NOTE, kind: 'highlight' }] };
    const { command, placed } = editing(highlight, { text: 'ignored' });
    expect(command.when?.(WITH_DOCUMENT)).toBe(false);
    await command.run(WITH_DOCUMENT);
    expect(placed).toStrictEqual([]);
  });

  it('is HIDDEN when TWO marks are selected, rather than editing the first', async () => {
    // There is one box to type in. A command that acted on `items[0]` would
    // quietly pick one of the two, which is worse than not offering the item.
    const two = { ...SELECTION, items: [NOTE, { ...NOTE, index: 4 }] };
    const { command, placed } = editing(two, { text: 'ignored' });
    expect(command.when?.(WITH_DOCUMENT)).toBe(false);
    await command.run(WITH_DOCUMENT);
    expect(placed).toStrictEqual([]);
  });

  it('is HIDDEN with nothing selected', () => {
    expect(editing(undefined, undefined).command.when?.(WITH_DOCUMENT)).toBe(false);
  });

  it('sits FIRST in the annotation menu, where the owner’s order puts it', () => {
    expect(editing(SELECTION, undefined).command.placements).toStrictEqual([
      { surface: 'context-menu', context: 'annotation', order: 10 },
    ]);
  });
});

describe('replySelectionCommand', () => {
  const NOTE: SelectedAnnotation = {
    index: 1,
    rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
    style: PLAIN_ITEM,
    kind: 'sticky-note',
    contents: 'what it said before',
  };
  const SELECTION: AnnotationSelection = {
    page: 2,
    version: asDocVersion(7),
    items: [NOTE],
  };

  function replying(selection: AnnotationSelection | undefined, answer: unknown) {
    const placed: unknown[] = [];
    const asked: { id: string; props: unknown }[] = [];
    return {
      placed,
      asked,
      command: replySelectionCommand({
        selection: () => selection,
        onDelete: () => undefined,
        onPlace: (command) => placed.push(command),
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(answer);
        },
      }),
    };
  }

  it('opens an EMPTY dialog and sends the answer against the mark it answers', async () => {
    const { command, placed, asked } = replying(SELECTION, { text: 'my answer' });
    await command.run(WITH_DOCUMENT);

    // THE EMPTY PROPS ARE THE ASSERTION, not an omission: pre-filling the
    // parent's text would make *Reply* answer the comment by quoting it back,
    // and that is the one way this command could differ from *Edit* invisibly.
    expect(asked).toStrictEqual([{ id: 'dialog.annotation-reply', props: {} }]);
    expect(placed).toStrictEqual([
      {
        kind: 'replyToAnnotation',
        page: 2,
        index: 1,
        text: 'my answer',
        version: asDocVersion(7),
      },
    ]);
  });

  it('CONTROL: a dismissed dialog sends nothing, and the dialog was still opened', async () => {
    const { command, placed, asked } = replying(SELECTION, undefined);
    await command.run(WITH_DOCUMENT);
    expect(asked).toHaveLength(1);
    expect(placed).toStrictEqual([]);
  });

  it('is offered on a kind *Edit* is HIDDEN for, which is the difference between them', async () => {
    // The pair's `when` predicates are deliberately not the same, and this is
    // the case that says so rather than a comment claiming it. A highlight
    // carries text this build does not draw — so *Edit* is hidden — while a
    // reply to it is a mark of its own that a person can see.
    const highlight = { ...SELECTION, items: [{ ...NOTE, kind: 'highlight' as const }] };
    const { command, placed } = replying(highlight, { text: 'my answer' });
    expect(command.when?.(WITH_DOCUMENT)).toBe(true);
    await command.run(WITH_DOCUMENT);
    expect(placed).toHaveLength(1);
  });

  it('is HIDDEN when TWO marks are selected, rather than answering the first', async () => {
    const two = { ...SELECTION, items: [NOTE, { ...NOTE, index: 4 }] };
    const { command, placed } = replying(two, { text: 'ignored' });
    expect(command.when?.(WITH_DOCUMENT)).toBe(false);
    await command.run(WITH_DOCUMENT);
    expect(placed).toStrictEqual([]);
  });

  it('is HIDDEN with nothing selected', () => {
    expect(replying(undefined, undefined).command.when?.(WITH_DOCUMENT)).toBe(false);
  });

  it('sits SECOND in the annotation menu, where the owner’s order puts it', () => {
    expect(replying(SELECTION, undefined).command.placements).toStrictEqual([
      { surface: 'context-menu', context: 'annotation', order: 20 },
    ]);
  });
});

describe('selectionPropertiesCommand', () => {
  const SELECTION = {
    page: 2,
    version: asDocVersion(7),
    items: [{ index: 1, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, ...CARRIED }],
  };

  function deps(selection: typeof SELECTION | undefined): {
    readonly settings: SettingsStore;
    readonly selection: () => typeof SELECTION | undefined;
    readonly onDelete: () => undefined;
    readonly onPlace: () => undefined;
  } {
    return {
      settings: new SettingsStore(new SettingsRegistry(ALL_SETTINGS)),
      selection: () => selection,
      onDelete: () => undefined,
      onPlace: () => undefined,
    };
  }

  it('OPENS the panel on its properties tab, rather than toggling either value', () => {
    // Under a pointer on a mark, a toggle would hide the properties half the time. Asserted as
    // both values, because opening a shut panel on the assistant's tab shows the wrong thing.
    const built = deps(SELECTION);
    built.settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
    built.settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');

    void selectionPropertiesCommand(built).run(WITH_DOCUMENT);

    expect(built.settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
    expect(built.settings.get(CONTEXT_PANEL_TAB_SETTING.id)).toBe('properties');

    // AND RUNNING IT AGAIN LEAVES IT OPEN — the control a toggle would fail.
    void selectionPropertiesCommand(built).run(WITH_DOCUMENT);
    expect(built.settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
  });

  it('is HIDDEN with nothing selected, and writes nothing when run anyway', () => {
    const built = deps(undefined);
    built.settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);

    expect(selectionPropertiesCommand(built).when?.(WITH_DOCUMENT)).toBe(false);
    void selectionPropertiesCommand(built).run(WITH_DOCUMENT);
    expect(built.settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(false);
  });

  it('sits in the annotation menu between reply and copy, where the owner’s order puts it', () => {
    expect(selectionPropertiesCommand(deps(SELECTION)).placements).toStrictEqual([
      { surface: 'context-menu', context: 'annotation', order: 30 },
    ]);
  });
});

describe('nudgeSelectionCommands', () => {
  const SELECTION = {
    page: 2,
    version: asDocVersion(7),
    items: [{ index: 1, rect: { x0: 10, y0: 20, x1: 30, y1: 40 }, ...CARRIED }],
  };

  function nudging(selection: typeof SELECTION | undefined): {
    readonly commands: readonly ReturnType<typeof deleteSelectionCommand>[];
    readonly sent: unknown[];
  } {
    const sent: unknown[] = [];
    return {
      commands: nudgeSelectionCommands({
        selection: () => selection,
        onDelete: () => undefined,
        onPlace: (command) => {
          sent.push(command);
        },
      }),
      sent,
    };
  }

  function fire(direction: string, sent: unknown[], commands: readonly { id: string; run: (context: CommandContext) => unknown }[]): unknown {
    const found = commands.find((command) => command.id === `annotate.nudge-${direction}`);
    if (found === undefined) throw new Error(`no nudge command for ${direction}`);
    void found.run(WITH_DOCUMENT);
    return sent[sent.length - 1];
  }

  it('moves the selection one point along the PAGE’s axes', () => {
    // Up is +y in PDF user space, which is the page's own frame rather than the
    // screen's. On a rotated page the two differ, and the command's own note
    // says so — this pins the direction so the limit is a stated fact rather
    // than an accident nobody wrote down.
    const { commands, sent } = nudging(SELECTION);
    expect(fire('up', sent, commands)).toStrictEqual({
      kind: 'placeAnnotation',
      page: 2,
      placements: [{ index: 1, rect: { x0: 10, y0: 21, x1: 30, y1: 41 } }],
      version: asDocVersion(7),
    });
    expect(fire('left', sent, commands)).toMatchObject({
      placements: [{ index: 1, rect: { x0: 9, y0: 20, x1: 29, y1: 40 } }],
    });
  });

  it('has a Shift version that moves ten, and it is a SEPARATE entry', () => {
    // A shortcut is a chord on an entry, so the coarse step cannot be the same
    // command with a modifier read at run time — which is also what puts both
    // in the palette under one name each.
    const { commands, sent } = nudging(SELECTION);
    const far = commands.find((command) => command.id === 'annotate.nudge-up-far');
    expect(far?.shortcut).toBe('Shift+ArrowUp');
    void far?.run(WITH_DOCUMENT);
    expect(sent[0]).toMatchObject({
      placements: [{ index: 1, rect: { x0: 10, y0: 30, x1: 30, y1: 50 } }],
    });
  });

  it('registers eight, each with its own chord and no surface', () => {
    // Eight buttons for one-point moves would be a toolbar nobody uses; the
    // palette reaches every registered command whether or not it is placed.
    const { commands } = nudging(SELECTION);
    expect(commands).toHaveLength(8);
    expect(new Set(commands.map((command) => command.shortcut)).size).toBe(8);
    expect(commands.every((command) => command.placements.length === 0)).toBe(true);
  });

  it('is not registered at all with nothing selected, so the arrows still scroll', () => {
    // A handler that returned early would already have swallowed the key.
    const { commands } = nudging(undefined);
    expect(commands.every((command) => command.when?.(WITH_DOCUMENT) === false)).toBe(true);
  });
});

describe('copyAnnotationsCommand', () => {
  const NOTE: SelectedAnnotation = {
    index: 3,
    rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
    style: PLAIN_ITEM,
    kind: 'sticky-note',
    contents: 'copy me',
  };
  const SELECTION: AnnotationSelection = {
    page: 2,
    version: asDocVersion(7),
    items: [NOTE, { ...NOTE, index: 5, kind: 'square' }],
  };

  /** The command against a client answering `answer`, recording what was sent, asked and copied. */
  function copying(selection: AnnotationSelection | undefined, answer: unknown) {
    const sent: { id: string; params: unknown }[] = [];
    const asked: { id: string; props: unknown }[] = [];
    const copied: number[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok(answer));
    });
    return {
      sent,
      asked,
      copied,
      command: copyAnnotationsCommand({
        selection: () => selection,
        onDelete: () => undefined,
        onPlace: () => undefined,
        client,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(undefined);
        },
        onCopied: (count) => copied.push(count),
      }),
    };
  }

  it('asks main to copy EXACTLY the selection — its page, every index, and the version it was read at', async () => {
    const { command, sent, copied } = copying(SELECTION, { kind: 'copied', copied: 2, skipped: 0 });
    await command.run(WITH_DOCUMENT);
    // THE SELECTION'S PAGE (2) AND VERSION (7), not the context's page (2 here by coincidence of
    // the fixture) or version (1). The handles are positions in the walk the selection was read
    // at, so sending the shell's current version would let a stale copy through.
    expect(sent).toStrictEqual([
      {
        id: 'document.copyAnnotations',
        params: { docId: WITH_DOCUMENT.docId, page: 2, indices: [3, 5], version: asDocVersion(7) },
      },
    ]);
    expect(copied).toStrictEqual([2]);
  });

  it('a selection with nothing exchangeable is TOLD so, and nothing is counted as copied', async () => {
    // A Copy that did nothing looks exactly like one that worked until the paste finds nothing.
    const { command, asked, copied } = copying(SELECTION, { kind: 'nothing-copyable' });
    await command.run(WITH_DOCUMENT);
    expect(asked).toStrictEqual([{ id: 'dialog.command-problem', props: { code: 'not-copyable' } }]);
    expect(copied).toStrictEqual([]);
  });

  it('a stale selection is told with the stale-target sentence, and nothing is counted', async () => {
    const { command, asked, copied } = copying(SELECTION, { kind: 'stale' });
    await command.run(WITH_DOCUMENT);
    expect(asked).toStrictEqual([{ id: 'dialog.command-problem', props: { code: 'stale-target' } }]);
    expect(copied).toStrictEqual([]);
  });

  it('CONTROL: hidden with nothing selected, and sends nothing if run', async () => {
    const { command, sent } = copying(undefined, { kind: 'copied', copied: 1, skipped: 0 });
    expect(command.when?.(WITH_DOCUMENT)).toBe(false);
    await command.run(WITH_DOCUMENT);
    expect(sent).toStrictEqual([]);
  });

  it('sits FOURTH in the annotation menu, where the owner’s order puts it, and claims no chord', () => {
    const { command } = copying(SELECTION, undefined);
    expect(command.placements).toStrictEqual([{ surface: 'context-menu', context: 'annotation', order: 40 }]);
    // Ctrl+C is the selected-text Copy; one chord cannot name two commands.
    expect(command.shortcut).toBeUndefined();
  });
});
