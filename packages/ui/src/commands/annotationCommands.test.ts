import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ELLIPSE_TOOL_ID, RECTANGLE_TOOL_ID } from '../annotations/shapeTools.js';
import type { CommandContext } from '../registries/commands.js';
import { rectangleToolCommand, shapeToolCommands } from './annotationCommands.js';

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

    const toolIds = annotationTools({ ask }).map((tool) => tool.id);
    const commandIds = shapeToolCommands({
      activeTool: () => undefined,
      onSelect: () => undefined,
    }).map((command) => command.id);

    // SETS, SORTED, so the message names which id is missing rather than
    // reporting that two lists differ in length.
    expect([...commandIds].sort()).toStrictEqual([...toolIds].sort());
  });

  it('gives each control its own place, so two do not claim one slot', () => {
    const orders = shapeToolCommands({ activeTool: () => undefined, onSelect: () => undefined })
      .flatMap((command) => command.placements)
      .map((placement) => (placement.surface === 'quick-toolbar' ? placement.order : -1));
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).not.toContain(-1);
  });

  it('is placed where a person can reach it, and not on a ribbon nothing renders', () => {
    // §7 puts a drawing tool on the ribbon's Comment section, and
    // `projections.ts` computes a ribbon model nothing renders — so a ribbon
    // placement today would register into nothing, which is the display-only
    // sin arriving through the registry rather than through a button.
    expect(built(undefined).command.placements).toStrictEqual([
      { surface: 'quick-toolbar', order: 40 },
    ]);
  });
});
