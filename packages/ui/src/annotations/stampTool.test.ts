import type { DispatchableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { STAMP_DIALOG_ID } from '../dialogs/stamp.js';
import { overlayTransform } from './annotationSpace.js';
import { type AnnotationStyle, PLAIN_STYLE } from './annotationStyle.js';
import { STAMP_TOOL_ID, stampTool } from './stampTool.js';

/**
 * The stamp tool's controller, driven without a DOM — `textTools.test.ts`' shape and its fixture: a non-zero crop
 * origin and a zoom that is not 1, so a controller passing pixels straight through fails rather than coincides.
 */
const PAGE: Parameters<typeof overlayTransform>[0] = { crop: [50, 100, 250, 400], rotation: 0, zoom: 2 };

function toolAnswering(
  answer: unknown,
  style: AnnotationStyle = PLAIN_STYLE,
): { readonly tool: ReturnType<typeof stampTool>; readonly asked: string[] } {
  const asked: string[] = [];
  const tool = stampTool({
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(answer);
    },
    style,
  });
  return { tool, asked };
}

async function drag(
  tool: ReturnType<typeof stampTool>,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<DispatchableCommand | undefined> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, 3, overlayTransform(PAGE));
}

describe('stampTool', () => {
  it('asks the stamp chooser, then builds a stamp with the chosen word in the box drawn', async () => {
    const { tool, asked } = toolAnswering({ stamp: 'void' });
    expect(tool.id).toBe(STAMP_TOOL_ID);
    expect(await drag(tool, [20, 20], [120, 80])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'stamp',
        stamp: 'void',
        // THE SAME RECTANGLE THE TEXT BOX GETS for this drag on this page — one adapter for both.
        rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
        // VOID's own red, since PLAIN_STYLE chooses no colour.
        colour: [0.8, 0.1, 0.1],
        opacity: 1,
      },
    });
    expect(asked).toStrictEqual([STAMP_DIALOG_ID]);
  });

  it('gives each stamp its own ink unless a colour was chosen — CONTROL: a chosen colour wins for every stamp', async () => {
    const own = async (stamp: string): Promise<unknown> => {
      const command = await drag(toolAnswering({ stamp }).tool, [20, 20], [120, 80]);
      return command?.kind === 'addAnnotation' ? command.annotation.colour : undefined;
    };
    expect(await own('approved')).toStrictEqual([0.1, 0.5, 0.2]);
    expect(await own('draft')).toStrictEqual([0.1, 0.3, 0.7]);
    const chosen: AnnotationStyle = { ...PLAIN_STYLE, colour: () => [0, 0, 1] };
    const command = await drag(toolAnswering({ stamp: 'approved' }, chosen).tool, [20, 20], [120, 80]);
    expect(command?.kind === 'addAnnotation' ? command.annotation.colour : undefined).toStrictEqual([0, 0, 1]);
  });

  it('sends NOTHING when the chooser is dismissed, or answers a stamp the library does not have', async () => {
    expect(await drag(toolAnswering(undefined).tool, [20, 20], [120, 80])).toBeUndefined();
    expect(await drag(toolAnswering({ stamp: 'paid' }).tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('opens no chooser for a drag too small to be a box', async () => {
    const { tool, asked } = toolAnswering({ stamp: 'void' });
    expect(await drag(tool, [20, 20], [23, 60])).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });
});
