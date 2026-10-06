import type { DispatchableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { LINK_ADDRESS_LABEL, LINK_ADDRESS_SCHEME, LINK_PAGE_LABEL, LINK_PAGE_NOT_A_NUMBER } from '../messages/en.js';
import type { WriteRequest } from '../pageWriting.js';
import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import { LINK_ADDRESS_TOOL_ID, LINK_PAGE_TOOL_ID, linkTools } from './linkTools.js';

/**
 * The two link tools' controllers.
 *
 * The subject is what crosses: a rectangle in PDF space, and a target that says which kind it is — never a URI with a
 * page number encoded in it — and what the tool asks the page for: a line beside the region drawn (ADR-0154), named
 * for what is typed and carrying its rule.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

function built(answer: string | undefined): {
  readonly tools: readonly UiTool[];
  readonly requests: WriteRequest[];
} {
  const requests: WriteRequest[] = [];
  const tools = linkTools({
    ask: () => Promise.reject(new Error('a dialog was opened')),
    write: (request) => {
      requests.push(request);
      return Promise.resolve(answer);
    },
    style: PLAIN_STYLE,
  });
  return { tools, requests };
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
): Promise<DispatchableCommand | undefined> {
  const started = tool.controller.begin(viewportPoint(from[0], from[1]));
  const moved = tool.controller.update(started, viewportPoint(to[0], to[1]));
  return tool.controller.commit(moved, 3, overlayTransform(PAGE));
}

describe('linkTools', () => {
  it('asks the page for a LINE beside the region, named Address, and builds a URI target from it', async () => {
    const { tools, requests } = built('https://example.org/a');
    const command = await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [100, 60]);
    // (20, 20) and (100, 60) at zoom 2 over a box starting at (50, 400).
    const rect = { x0: 60, y0: 390, x1: 100, y1: 370 };
    expect(requests.map(({ check: _rule, ...request }) => request)).toStrictEqual([
      { page: 3, box: rect, shape: 'line', initial: '', label: LINK_ADDRESS_LABEL },
    ]);
    expect(command).toStrictEqual({ kind: 'addLink', page: 3, rect, target: { kind: 'uri', uri: 'https://example.org/a' } });
  });

  it('carries the ADDRESS rule: a scheme this build allows passes, a bare host is refused', async () => {
    const { tools, requests } = built(undefined);
    await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [100, 60]);
    const rule = requests[0]?.check;
    expect([rule?.('https://example.org/a'), rule?.('example.org/a')]).toStrictEqual([undefined, LINK_ADDRESS_SCHEME]);
  });

  it('turns the typed page number into a ZERO-BASED target, by the page rule', async () => {
    // Every surface counts from 1 and every payload counts from 0. The conversion is the tool's, so it has one place
    // rather than a half in the rule and a half here — the off-by-one this project has shipped once.
    const { tools, requests } = built('3');
    expect(await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60])).toMatchObject({
      target: { kind: 'page', page: 2 },
    });
    expect(requests[0]?.label).toBe(LINK_PAGE_LABEL);
    expect([requests[0]?.check?.('3'), requests[0]?.check?.('four'), requests[0]?.check?.('1e3')]).toStrictEqual([
      undefined,
      LINK_PAGE_NOT_A_NUMBER,
      LINK_PAGE_NOT_A_NUMBER,
    ]);
  });

  it('sends a TARGET UNION rather than a URI with a convention in it', async () => {
    // MuPDF spells an internal destination as a URI too, and one string would have been easy. The schema could then
    // not tell a link to page 3 from a link to a site called `#page=3`, and this build would be parsing its own
    // convention out of a person's text.
    const { tools } = built('3');
    const command = await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60]);
    expect(JSON.stringify(command)).not.toContain('#page');
  });

  it('sends nothing when nothing was typed', async () => {
    const { tools } = built(undefined);
    expect(await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [100, 60])).toBeUndefined();
  });

  it('sends nothing, and ASKS NOTHING, for a press that drew no region', async () => {
    // The order matters: a stray click must not open a line asking where nothing should go. Asserted on the requests
    // rather than on the command, because a tool that asked and then discarded the answer produces the same
    // `undefined`.
    const { tools, requests } = built('https://example.org/a');
    expect(await drag(toolFor(tools, LINK_ADDRESS_TOOL_ID), [20, 20], [22, 21])).toBeUndefined();
    expect(requests).toStrictEqual([]);
  });

  it('sends nothing for an answer the rule would not have passed', async () => {
    // The line answers only words its rule passes, so arriving here means the two disagree. The page tool's own parse
    // is the second gate, and it refuses quietly: there is nothing to build a command from and the page is unchanged.
    const { tools } = built('seven');
    expect(await drag(toolFor(tools, LINK_PAGE_TOOL_ID), [20, 20], [100, 60])).toBeUndefined();
  });

  it('previews the region, once it is one', () => {
    const { tools } = built(undefined);
    const { controller } = toolFor(tools, LINK_ADDRESS_TOOL_ID);
    const started = controller.begin(viewportPoint(20, 20));
    expect(controller.preview(controller.update(started, viewportPoint(22, 21)), 3, overlayTransform(PAGE))).toBeUndefined();
    expect(controller.preview(controller.update(started, viewportPoint(100, 60)), 3, overlayTransform(PAGE))).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 80,
      height: 40,
    });
  });
});
