import { MIN_SNAPSHOT_SCALE } from '@monstera/contract';
import { fitsClaudeImage } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { pictureForAsk, type PictureEngine } from './askPicture.js';
import { PageTooLargeToPicture } from './documentCommands.js';

/** An engine whose page is `width` × `height` points, recording every scale it is asked to draw at. */
function recordingEngine(width: number, height: number): { engine: PictureEngine; drawn: number[] } {
  const drawn: number[] = [];
  return {
    drawn,
    engine: {
      size: () => Promise.resolve({ width, height }),
      draw: (_page, scale) => {
        drawn.push(scale);
        return Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      },
    },
  };
}

describe('pictureForAsk', () => {
  it('draws an A0 drawing below the snapshot floor, within Claude’s image limits (table A row 11)', async () => {
    // 2,384 × 3,370 pt: every A0 drawing. At the snapshot's floor it was refused as too large to send as a picture.
    const { engine, drawn } = recordingEngine(2384, 3370);
    await expect(pictureForAsk(engine, 0)).resolves.toBeInstanceOf(Uint8Array);
    expect(drawn).toHaveLength(1);
    const [scale] = drawn;
    if (scale === undefined) throw new Error('nothing was drawn');
    expect(scale).toBeLessThan(MIN_SNAPSHOT_SCALE);
    expect(fitsClaudeImage(Math.ceil(2384 * scale), Math.ceil(3370 * scale))).toBe(true);
  });

  it('draws a page that fits at the ceiling at the ceiling, not lower', async () => {
    const { engine, drawn } = recordingEngine(612, 792);
    await pictureForAsk(engine, 0);
    expect(drawn[0]).toBeGreaterThanOrEqual(MIN_SNAPSHOT_SCALE);
  });

  it('still names a page no floor can picture, rather than drawing nothing', async () => {
    // CONTROL: a page far past anything PDF allows keeps the typed refusal, so the case above is the floor's doing.
    const { engine, drawn } = recordingEngine(10_000_000, 10_000_000);
    await expect(pictureForAsk(engine, 3)).rejects.toBeInstanceOf(PageTooLargeToPicture);
    expect(drawn).toEqual([]);
  });
});
