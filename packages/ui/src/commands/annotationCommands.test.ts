import { asDocId, asDocVersion } from '@monstera/shared';

import { GROUP_MARKUP } from '../messages/en.js';
import { describe, expect, it } from 'vitest';

import { PLAIN_STYLE } from '../annotations/annotationStyle.js';

/** The style a selected annotation carries. These cases do not read it. */
const PLAIN_ITEM = { colour: [1, 0, 0], opacity: 1, borderWidth: 2 } as const;
import { ELLIPSE_TOOL_ID, RECTANGLE_TOOL_ID } from '../annotations/shapeTools.js';
import type { CommandContext } from '../registries/commands.js';
import {
  deleteSelectionCommand,
  nudgeSelectionCommands,
  rectangleToolCommand,
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
      { index: 1, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, style: PLAIN_ITEM },
      { index: 4, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, style: PLAIN_ITEM },
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
    expect(command.placements).toStrictEqual([
      { surface: 'context-menu', context: 'annotation', order: 10 },
    ]);
  });
});

describe('nudgeSelectionCommands', () => {
  const SELECTION = {
    page: 2,
    version: asDocVersion(7),
    items: [{ index: 1, rect: { x0: 10, y0: 20, x1: 30, y1: 40 }, style: PLAIN_ITEM }],
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
