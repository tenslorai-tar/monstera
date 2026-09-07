import type { AnnotationRect, RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import {
  MINIMUM_REGION,
  SNAPSHOT_SCALE,
  SNAPSHOT_TOOL_ID,
  snapshotTool,
} from './snapshotTool.js';

/**
 * The snapshot tool, driven without a DOM.
 *
 * ## What is asserted is the CALL, not a returned command
 *
 * This tool produces no `RenderableCommand`, so a case that only checked
 * `commit`'s answer would pass for a tool that did nothing at all — `undefined`
 * is both the correct answer and what a dead control returns. So every case
 * here reads what reached `onSnapshot`, and the one that reads the return value
 * asserts it *stays* undefined, which is a separate claim: a snapshot in the
 * undo log would be an entry undo cannot reverse.
 *
 * That is the audit's own rule about deciding — assert the call that was or was
 * not made, because the end state a correct decision produces is the state an
 * absent one produces too.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The fixture every file in this directory shares: a non-zero origin and a
  // zoom that is not 1, so a tool passing pixels through would fail rather than
  // coincide.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** What one drag sent, or `undefined` if it sent nothing. */
function dragged(
  from: readonly [number, number],
  to: readonly [number, number],
): {
  readonly sent: readonly { page: number; rect: AnnotationRect; scale: number }[];
  readonly command: RenderableCommand | undefined;
  readonly tool: UiTool;
} {
  const sent: { page: number; rect: AnnotationRect; scale: number }[] = [];
  const tool = snapshotTool({
    onSnapshot: (page, rect, scale) => {
      sent.push({ page, rect, scale });
    },
  });
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  const command = controller.commit(moved, 3, overlayTransform(PAGE)) as
    | RenderableCommand
    | undefined;
  return { sent, command, tool };
}

describe('the snapshot tool', () => {
  it('sends the region it was dragged over, converted by the one adapter', () => {
    // (20, 20) at zoom 2 on a page whose visible box starts at (50, 400) is
    // (60, 390) — the conversion every file in this directory asserts, and the
    // reason a snapshot and a rectangle drawn over the same region carry the
    // same numbers.
    const { sent } = dragged([20, 20], [120, 80]);
    expect(sent).toStrictEqual([
      {
        page: 3,
        rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
        scale: SNAPSHOT_SCALE,
      },
    ]);
  });

  it('SENDS NOTHING TO THE COMMAND BUS, which is what a snapshot is', () => {
    // A snapshot changes no document. A command here would put an entry in the
    // undo log for an operation undo cannot reverse — a file has been written
    // by the time anyone could press it.
    const { command, sent } = dragged([20, 20], [120, 80]);
    expect(command).toBeUndefined();
    // AND THE CALL WAS MADE, which is what stops the line above from passing
    // for a tool that does nothing: both halves are `undefined` for a dead
    // control and only one of them is for a working one.
    expect(sent).toHaveLength(1);
  });

  it('refuses a drag that did not travel in BOTH axes', () => {
    // A region flat in one direction has no area, and the kernel refuses it —
    // so refusing here is what keeps a slip from opening a save dialog for a
    // snapshot that will then fail. A line tool's single-axis minimum would
    // send this one.
    expect(dragged([20, 20], [120, 20 + MINIMUM_REGION - 1]).sent).toStrictEqual([]);
    expect(dragged([20, 20], [20 + MINIMUM_REGION - 1, 120]).sent).toStrictEqual([]);
  });

  it('CONTROL: a drag just past the minimum in both axes IS sent', () => {
    // The partner the refusals need: a minimum written the wrong way round
    // refuses every drag, and the two cases above read as rigour while the
    // tool does nothing at all.
    expect(
      dragged([20, 20], [20 + MINIMUM_REGION + 1, 20 + MINIMUM_REGION + 1]).sent,
    ).toHaveLength(1);
  });

  it('previews the region as a rectangle', () => {
    const tool = snapshotTool({ onSnapshot: () => undefined });
    const started = tool.controller.begin(viewportPoint(120, 80));
    const moved = tool.controller.update(started, viewportPoint(20, 20));
    // DRAGGED UP AND LEFT, so the preview's own normalisation is what is being
    // read: a rectangle with a negative width draws nothing in SVG.
    expect(tool.controller.preview(moved)).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
    });
  });

  it('sends an UNORDERED rectangle, because the kernel normalises', () => {
    // The rule is stated once, in `placedRect`, and a tool that ordered here
    // would be a second place it lives — agreeing today and diverging the first
    // time either changes.
    const { sent } = dragged([120, 80], [20, 20]);
    expect(sent[0]?.rect).toStrictEqual({ x0: 110, y0: 360, x1: 60, y1: 390 });
  });

  it('claims the id its command selects', () => {
    expect(dragged([20, 20], [120, 80]).tool.id).toBe(SNAPSHOT_TOOL_ID);
  });
});
