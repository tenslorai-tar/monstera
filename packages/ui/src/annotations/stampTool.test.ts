import type { AnnotationRect, DispatchableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { STAMP_DIALOG_ID } from '../dialogs/stamp.js';
import type { StampPicture } from '../dialogs/stampResult.js';
import { overlayTransform } from './annotationSpace.js';
import { type AnnotationStyle, PLAIN_STYLE } from './annotationStyle.js';
import { STAMP_TOOL_ID, stampTool } from './stampTool.js';

/**
 * The stamp tool's controller, driven without a DOM — `textTools.test.ts`' shape and its fixture: a non-zero crop
 * origin and a zoom that is not 1, so a controller passing pixels straight through fails rather than coincides.
 */
const PAGE: Parameters<typeof overlayTransform>[0] = { crop: [50, 100, 250, 400], rotation: 0, zoom: 2 };

const KEPT: StampPicture = { id: '8f14e45f-ceea-467a-9b36-5a0b3e5c2f11', name: 'paid', src: 'blob:kept-1' };

/** A tool whose chooser answers each of `answers` in turn, and the record of everything it did. */
function toolAnswering(
  answers: readonly unknown[],
  style: AnnotationStyle = PLAIN_STYLE,
): {
  readonly tool: ReturnType<typeof stampTool>;
  readonly asked: { id: string; props: unknown }[];
  readonly did: string[];
  readonly placed: { page: number; rect: AnnotationRect; picture: string }[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const did: string[] = [];
  const placed: { page: number; rect: AnnotationRect; picture: string }[] = [];
  let round = 0;
  const tool = stampTool({
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(answers[asked.length - 1]);
    },
    style,
    stampPictures: () => {
      round += 1;
      const mine = round;
      did.push(`listed ${String(mine)}`);
      return Promise.resolve({
        pictures: [KEPT],
        release: () => {
          did.push(`released ${String(mine)}`);
        },
      });
    },
    addStampPicture: () => {
      did.push('added');
      return Promise.resolve();
    },
    removeStampPicture: (id) => {
      did.push(`removed ${id}`);
      return Promise.resolve();
    },
    onPlaceStampPicture: (page, rect, picture) => {
      placed.push({ page, rect, picture });
    },
  });
  return { tool, asked, did, placed };
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

/** THE SAME RECTANGLE THE TEXT BOX GETS for this drag on this page — one adapter for both. */
const RECT = { x0: 60, y0: 390, x1: 110, y1: 360 };

describe('stampTool', () => {
  it('asks the stamp chooser WITH THE KEPT PICTURES, then builds a stamp with the chosen word in the box drawn', async () => {
    const { tool, asked, did } = toolAnswering([{ stamp: 'void' }]);
    expect(tool.id).toBe(STAMP_TOOL_ID);
    expect(await drag(tool, [20, 20], [120, 80])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      // VOID's own red, since PLAIN_STYLE chooses no colour.
      annotation: { type: 'stamp', stamp: 'void', rect: RECT, colour: [0.8, 0.1, 0.1], opacity: 1 },
    });
    expect(asked).toStrictEqual([{ id: STAMP_DIALOG_ID, props: { pictures: [KEPT] } }]);
    // THE PREVIEWS LET GO once the chooser has answered.
    expect(did).toStrictEqual(['listed 1', 'released 1']);
  });

  it('gives each stamp its own ink unless a colour was chosen — CONTROL: a chosen colour wins for every stamp', async () => {
    const own = async (stamp: string): Promise<unknown> => {
      const command = await drag(toolAnswering([{ stamp }]).tool, [20, 20], [120, 80]);
      return command?.kind === 'addAnnotation' ? command.annotation.colour : undefined;
    };
    expect(await own('approved')).toStrictEqual([0.1, 0.5, 0.2]);
    expect(await own('draft')).toStrictEqual([0.1, 0.3, 0.7]);
    const chosen: AnnotationStyle = { ...PLAIN_STYLE, colour: () => [0, 0, 1] };
    const command = await drag(toolAnswering([{ stamp: 'approved' }], chosen).tool, [20, 20], [120, 80]);
    expect(command?.kind === 'addAnnotation' ? command.annotation.colour : undefined).toStrictEqual([0, 0, 1]);
  });

  it('hands a KEPT PICTURE to main with the page and the box, and builds no command itself', async () => {
    const { tool, placed } = toolAnswering([{ picture: KEPT.id }]);
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
    expect(placed).toStrictEqual([{ page: 3, rect: RECT, picture: KEPT.id }]);
  });

  it('ADDING or REMOVING a picture changes the library and ASKS AGAIN, letting go of each round’s previews', async () => {
    const { tool, asked, did } = toolAnswering([{ library: 'add' }, { library: 'remove', id: KEPT.id }, { stamp: 'copy' }]);
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(command?.kind === 'addAnnotation' && command.annotation.type === 'stamp' ? command.annotation.stamp : undefined).toBe(
      'copy',
    );
    expect(asked).toHaveLength(3);
    expect(did).toStrictEqual([
      'listed 1',
      'released 1',
      'added',
      'listed 2',
      'released 2',
      `removed ${KEPT.id}`,
      'listed 3',
      'released 3',
    ]);
  });

  it('sends NOTHING when the chooser is dismissed, or answers a stamp the library does not have', async () => {
    const dismissed = toolAnswering([undefined]);
    expect(await drag(dismissed.tool, [20, 20], [120, 80])).toBeUndefined();
    // AND LETS GO of the previews even so.
    expect(dismissed.did).toStrictEqual(['listed 1', 'released 1']);
    expect(await drag(toolAnswering([{ stamp: 'paid' }]).tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('opens no chooser for a drag too small to be a box', async () => {
    const { tool, asked, did } = toolAnswering([{ stamp: 'void' }]);
    expect(await drag(tool, [20, 20], [23, 60])).toBeUndefined();
    expect(asked).toStrictEqual([]);
    expect(did).toStrictEqual([]);
  });
});
