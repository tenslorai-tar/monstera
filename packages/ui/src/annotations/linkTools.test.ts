import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { LINK_ADDRESS_DIALOG_ID, LINK_PAGE_DIALOG_ID } from '../dialogs/annotationLink.js';
import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import { LINK_ADDRESS_TOOL_ID, LINK_PAGE_TOOL_ID, linkTools } from './linkTools.js';

/**
 * The two link tools' controllers.
 *
 * The subject is what crosses: a rectangle in PDF space, and a target that says
 * which kind it is — never a URI with a page number encoded in it.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

function built(answer: unknown): {
  readonly tools: readonly UiTool[];
  readonly asked: string[];
} {
  const asked: string[] = [];
  const tools = linkTools({
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(answer);
    },
    style: PLAIN_STYLE,
  });
  return { tools, asked };
}

function toolFor(tools: readonly UiTool[], id: string): UiTool {
  const found = tools.find((tool) => tool.id === id);
  if (found === undefined) throw new Error(`no tool ${id}`);
  return found;
}

async function drag(
  tool: UiTool,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<RenderableCommand | undefined> {
  const started = tool.controller.begin(viewportPoint(from[0], from[1]));
  const moved = tool.controller.update(started, viewportPoint(to[0], to[1]));
  return tool.controller.commit(moved, 3, overlayTransform(PAGE));
}

describe('linkTools', () => {
  it('asks its OWN dialog and builds a URI target from the answer', async () => {
    const { tools, asked } = built({ text: 'https://example.org/a' });
    const command = await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [100, 60]);
    expect(asked).toStrictEqual([LINK_ADDRESS_DIALOG_ID]);
    expect(command).toStrictEqual({
      kind: 'addLink',
      page: 3,
      // (20, 20) and (100, 60) at zoom 2 over a box starting at (50, 400).
      rect: { x0: 60, y0: 390, x1: 100, y1: 370 },
      target: { kind: 'uri', uri: 'https://example.org/a' },
    });
  });

  it('turns the typed page number into a ZERO-BASED target', async () => {
    // Every surface counts from 1 and every payload counts from 0. The
    // conversion is the tool's, so it has one place rather than a half in the
    // dialog and a half here — the off-by-one this project has shipped once.
    const { tools, asked } = built({ text: '3' });
    expect(await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60])).toMatchObject({
      target: { kind: 'page', page: 2 },
    });
    expect(asked).toStrictEqual([LINK_PAGE_DIALOG_ID]);
  });

  it('sends a TARGET UNION rather than a URI with a convention in it', async () => {
    // MuPDF spells an internal destination as a URI too, and one string would
    // have been easy. The schema could then not tell a link to page 3 from a
    // link to a site called `#page=3`, and this build would be parsing its own
    // convention out of a person's text.
    const { tools } = built({ text: '3' });
    const command = await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60]);
    expect(JSON.stringify(command)).not.toContain('#page');
  });

  it('sends nothing when the dialog is dismissed', async () => {
    const { tools } = built(undefined);
    expect(await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [100, 60])).toBeUndefined();
  });

  it('sends nothing, and ASKS NOTHING, for a press that drew no region', async () => {
    // The order matters: a stray click must not open a dialog asking where
    // nothing should go. Asserted on `asked` rather than on the command,
    // because a tool that asked and then discarded the answer produces the same
    // `undefined`.
    const { tools, asked } = built({ text: 'https://example.org/a' });
    expect(await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [22, 21])).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });

  it('sends nothing for an answer the dialog should not have produced', async () => {
    // `LINK_TEXT_RESULT` refuses an empty string, so arriving here means a
    // dialog answered a shape this tool cannot use. The page tool's own parse
    // is the second gate, and it refuses quietly for the platform's reason:
    // there is nothing to build a command from and the page is unchanged.
    const { tools } = built({ text: 'seven' });
    expect(await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60])).toBeUndefined();
  });

  it('previews the region, once it is one', () => {
    const { tools } = built(undefined);
    const { controller } = toolFor(tools, LINK_ADDRESS_TOOL_ID);
    const started = controller.begin(viewportPoint(20, 20));
    expect(controller.preview(controller.update(started, viewportPoint(22, 21)))).toBeUndefined();
    expect(controller.preview(controller.update(started, viewportPoint(100, 60)))).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 80,
      height: 40,
    });
  });
});
