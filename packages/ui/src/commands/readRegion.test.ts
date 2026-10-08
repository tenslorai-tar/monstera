import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { styleFrom } from '../annotations/annotationStyle.js';
import { REGION_READ_DIALOG_ID } from '../dialogs/regionRead.js';
import type { DialogReports } from '../registries/dialogs.js';
import type { OverlayPage } from '../annotations/annotationSpace.js';
import { type RegionReadCommand, isRegionRead, readRegionInPanel } from './readRegion.js';

/**
 * The box's read and the panel that shows it (Step 7c). The kernel half — that the words become an invisible layer on the
 * page — is the OCR proofs'; these assert what the panel is shown, in what order, and what its two actions send.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c7');
const REGION = { x0: 50, y0: 100, x1: 250, y1: 160 };
const COMMAND: RegionReadCommand = { kind: 'ocrPage', page: 1, languages: ['eng'], engine: 'claude', region: REGION };
const APPLIED = { version: asDocVersion(5), byteLength: 4096, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] };
/** A Letter page at zoom 1, turned 0, with the crop box at the origin: display y runs down from 792, PDF y up from 0. */
const PAGE: OverlayPage = { crop: [0, 0, 612, 792], rotation: 0, zoom: 1 };
/**
 * A line the text layer holds: a bare string is a line of its own, one row below the one before; an object names its row and
 * column, so cells of one table row share a height. A box is 10 high and 60 wide, on a 20-point row pitch and a 100-point
 * column pitch.
 */
type Placed = string | { readonly text: string; readonly row: number; readonly column: number };
const layer = (entries: readonly Placed[]): { text: string; box: { x0: number; y0: number; x1: number; y1: number } }[] =>
  entries.map((entry, index) => {
    const { text, row, column } = typeof entry === 'string' ? { text: entry, row: index, column: 0 } : entry;
    return { text, box: { x0: column * 100, y0: row * 20, x1: column * 100 + 60, y1: row * 20 + 10 } };
  });

interface Rig {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
  readonly opened: { id: string; props: unknown }[];
  readonly replies: unknown[];
  readonly copied: string[];
  readonly toasts: unknown[];
  readonly report: (report: unknown) => void;
  /** The registry commands the panel started, by id. */
  readonly ran: string[];
  readonly run: () => Promise<boolean>;
}

/**
 * The read over a client whose text layer says `before` until the command lands and `after` once it has, with a panel that
 * reports `ready` as the real body does.
 */
function rig(before: readonly Placed[], after: readonly Placed[], execute: 'ok' | 'refused' = 'ok'): Rig {
  const ran: string[] = [];
  const sent: { id: string; params: unknown }[] = [];
  const opened: { id: string; props: unknown }[] = [];
  const replies: unknown[] = [];
  const copied: string[] = [];
  const toasts: unknown[] = [];
  let landed = false;
  let onReport: DialogReports | undefined;
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'document.pageTextLayer') {
      const lines = layer(landed ? after : before);
      return Promise.resolve(ok({ version: asDocVersion(1), lines, truncated: false, kind: 'text' } as never));
    }
    if (id === 'window.copyText') {
      copied.push((params as { text: string }).text);
      return Promise.resolve(ok({ copied: true } as never));
    }
    if (id !== 'document.execute') throw new Error(`this fixture has no answer for ${id}`);
    const command = (params as { command: { kind: string } }).command;
    if (command.kind === 'ocrPage') {
      if (execute === 'refused') return Promise.resolve(err({ code: 'service-refused' } as never));
      landed = true;
    }
    return Promise.resolve(ok(APPLIED as never));
  });
  const report = (value: unknown): void => {
    onReport?.(value, (props) => replies.push(props));
  };
  return {
    client,
    sent,
    opened,
    replies,
    copied,
    toasts,
    report,
    ran,
    run: () =>
      readRegionInPanel(
        {
          client,
          onApplied: () => undefined,
          stamp: () => ({ author: 'A. Tester', created: '2026-10-08T09:00:00.000Z' }),
          signatures: { warn: () => false, onOpened: () => undefined },
          toast: (...args: unknown[]) => toasts.push(args),
          style: styleFrom({} as never),
          run: (id: string) => {
            ran.push(id);
          },
          ask: (id: string, props: unknown, reports?: DialogReports) => {
            opened.push({ id, props });
            onReport = reports;
            // THE REAL BODY tells the command it is up as it mounts; the panel stays open (the promise never settles).
            reports?.({ kind: 'ready' }, (next: unknown) => replies.push(next));
            return new Promise<unknown>(() => undefined);
          },
        },
        DOC,
        COMMAND,
        PAGE,
      ),
  };
}

describe('isRegionRead', () => {
  it('is a read carrying a region, and not a whole-page read', () => {
    expect(isRegionRead(COMMAND)).toBe(true);
    expect(isRegionRead({ kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' })).toBe(false);
  });
});

describe('a box read in the panel', () => {
  it('opens the panel as READING first, then answers it in place with the words the read added', async () => {
    const r = rig(['old line'], ['old line', 'hello', 'world']);
    const moved = await r.run();
    expect(moved).toBe(true);
    expect(r.opened).toStrictEqual([{ id: REGION_READ_DIALOG_ID, props: { state: 'reading', engine: 'claude' } }]);
    expect(r.replies).toStrictEqual([{ state: 'read', engine: 'claude', text: 'hello\nworld', table: false }]);
  });

  it('shows a TABLE a row to a line with its cells a tab apart, never a word to a line, and says it is a table', async () => {
    const cells: Placed[] = [
      { text: 'Names', row: 0, column: 0 },
      { text: 'Hours', row: 0, column: 1 },
      { text: 'John', row: 1, column: 0 },
      { text: '7', row: 1, column: 1 },
    ];
    const r = rig([], cells);
    await r.run();
    expect(r.replies).toStrictEqual([{ state: 'read', engine: 'claude', text: 'Names\tHours\nJohn\t7', table: true }]);
    // CONTROL: the same four words with no shared height are four lines, and not a table.
    const apart = rig([], ['Names', 'Hours', 'John', '7']);
    await apart.run();
    expect(apart.replies).toStrictEqual([{ state: 'read', engine: 'claude', text: 'Names\nHours\nJohn\n7', table: false }]);
  });

  it('Export to Word and to Excel start the page’s own exports', async () => {
    const r = rig([], [{ text: 'a', row: 0, column: 0 }, { text: 'b', row: 0, column: 1 }, { text: 'c', row: 1, column: 0 }, { text: 'd', row: 1, column: 1 }]);
    await r.run();
    r.report({ kind: 'word' });
    r.report({ kind: 'excel' });
    expect(r.ran).toStrictEqual(['document.export-word', 'document.export-excel']);
  });

  it('says a box that held nothing, in the panel', async () => {
    const r = rig(['old line'], ['old line']);
    await r.run();
    expect(r.replies).toStrictEqual([{ state: 'nothing', engine: 'claude' }]);
  });

  it('says a refused read in the panel, naming the problem, and reports the document unchanged', async () => {
    const r = rig([], [], 'refused');
    const moved = await r.run();
    expect(moved).toBe(false);
    expect(r.replies).toStrictEqual([{ state: 'failed', engine: 'claude', problem: { code: 'service-refused' } }]);
    // The generic problem dialog would have REPLACED the panel: it was never asked.
    expect(r.opened.map((o) => o.id)).toStrictEqual([REGION_READ_DIALOG_ID]);
  });

  it('Copy sends exactly the words shown to the clipboard', async () => {
    const r = rig([], ['hello']);
    await r.run();
    r.report({ kind: 'copy' });
    await Promise.resolve();
    await Promise.resolve();
    expect(r.copied).toStrictEqual(['hello']);
  });

  it('Insert puts EACH LINE back where it was read — its own box turned into the page’s space, sized to fit, in black — as one gesture', async () => {
    const r = rig([], [{ text: 'Names', row: 0, column: 0 }, { text: 'Hours', row: 0, column: 1 }, { text: 'John', row: 1, column: 0 }]);
    await r.run();
    r.report({ kind: 'insert' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sentOnes = r.sent.filter((s) => s.id === 'document.execute');
    const added = sentOnes
      .map((s) => s.params as { command: { kind: string; page?: number; annotation?: Record<string, unknown> }; joinsStep?: unknown })
      .filter((p) => p.command.kind === 'addAnnotation');
    expect(added).toHaveLength(3);
    expect(added.every((p) => p.command.page === 1)).toBe(true);
    // NO BOX, and the ordinary text colour: not the annotation colour, which is what drew small yellow serif text.
    expect(added.map((p) => p.command.annotation)).toMatchObject([
      // DISPLAY (0,0)-(60,10) on a 792-high page is PDF y 782-792, widened by 2 each way.
      { type: 'typewriter', text: 'Names', colour: [0, 0, 0], font: 'sans', rect: { x0: -2, y0: 780, x1: 62, y1: 794 } },
      { type: 'typewriter', text: 'Hours', rect: { x0: 98, y0: 780, x1: 162, y1: 794 } },
      { type: 'typewriter', text: 'John', rect: { x0: -2, y0: 760, x1: 62, y1: 774 } },
    ]);
    // ONE UNDO STEP: the first line starts the step, each later one joins the step the one before produced.
    expect(added[0]?.joinsStep).toBeUndefined();
    expect(added[1]?.joinsStep).toBe(APPLIED.version);
    expect(added[2]?.joinsStep).toBe(APPLIED.version);
    // CONTROL: the size fits the 10-point line, so it is not the style's 12.
    expect(added[0]?.command.annotation?.['fontSize']).toBeLessThan(12);
  });

  it('CONTROL: the actions do nothing before there are words to act on', async () => {
    const r = rig([], [], 'refused');
    await r.run();
    r.report({ kind: 'copy' });
    r.report({ kind: 'insert' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.copied).toStrictEqual([]);
    expect(r.sent.some((s) => (s.params as { command?: { kind: string } }).command?.kind === 'addAnnotation')).toBe(false);
  });
});
