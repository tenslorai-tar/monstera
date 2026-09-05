import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { RECTANGLE_TOOL_ID } from '../annotations/rectangleTool.js';
import type { CommandContext } from '../registries/commands.js';
import { rectangleToolCommand } from './annotationCommands.js';

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
    // registered, *toggle* and *switch to me* agree on every input — this is
    // the case that says which one was written, before the second tool makes
    // the difference visible to a person.
    const { command, selected } = built('annotate.ink');
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
