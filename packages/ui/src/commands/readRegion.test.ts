import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { styleFrom } from '../annotations/annotationStyle.js';
import { REGION_READ_DIALOG_ID } from '../dialogs/regionRead.js';
import type { DialogReports } from '../registries/dialogs.js';
import { type RegionReadCommand, addedLines, isRegionRead, readRegionInPanel } from './readRegion.js';

/**
 * The box's read and the panel that shows it (Step 7c). The kernel half — that the words become an invisible layer on the
 * page — is the OCR proofs'; these assert what the panel is shown, in what order, and what its two actions send.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c7');
const REGION = { x0: 50, y0: 100, x1: 250, y1: 160 };
const COMMAND: RegionReadCommand = { kind: 'ocrPage', page: 1, languages: ['eng'], engine: 'claude', region: REGION };
const APPLIED = { version: asDocVersion(5), byteLength: 4096, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] };
const LINE_BOX = { x0: 0, y0: 0, x1: 10, y1: 10 };

interface Rig {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
  readonly opened: { id: string; props: unknown }[];
  readonly replies: unknown[];
  readonly copied: string[];
  readonly toasts: unknown[];
  readonly report: (report: unknown) => void;
  readonly run: () => Promise<boolean>;
}

/**
 * The read over a client whose text layer says `before` until the command lands and `after` once it has, with a panel that
 * reports `ready` as the real body does.
 */
function rig(before: readonly string[], after: readonly string[], execute: 'ok' | 'refused' = 'ok'): Rig {
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
      const lines = (landed ? after : before).map((text) => ({ text, box: LINE_BOX }));
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
    run: () =>
      readRegionInPanel(
        {
          client,
          onApplied: () => undefined,
          stamp: () => ({ author: 'A. Tester', created: '2026-10-08T09:00:00.000Z' }),
          signatures: { warn: () => false, onOpened: () => undefined },
          toast: (...args: unknown[]) => toasts.push(args),
          style: styleFrom({} as never),
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
      ),
  };
}

describe('the lines a read ADDED', () => {
  it('takes a line out once per occurrence, so a box over words the page already had still shows what is new', () => {
    expect(addedLines(['a', 'b'], ['a', 'b', 'c'])).toStrictEqual(['c']);
    expect(addedLines(['a'], ['a', 'a', 'c'])).toStrictEqual(['a', 'c']);
  });

  it('CONTROL: a read that added nothing adds nothing, and a page that had nothing shows everything', () => {
    expect(addedLines(['a', 'b'], ['a', 'b'])).toStrictEqual([]);
    expect(addedLines([], ['x', 'y'])).toStrictEqual(['x', 'y']);
  });
});

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
    expect(r.replies).toStrictEqual([{ state: 'read', engine: 'claude', text: 'hello\nworld' }]);
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

  it('Insert adds the words as a text box where the box was', async () => {
    const r = rig([], ['hello']);
    await r.run();
    r.report({ kind: 'insert' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const executes = r.sent.filter((s) => s.id === 'document.execute').map((s) => (s.params as { command: Record<string, unknown> }).command);
    const added = executes.find((c) => c['kind'] === 'addAnnotation') as { page: number; annotation: Record<string, unknown> } | undefined;
    expect(added?.page).toBe(1);
    expect(added?.annotation).toMatchObject({ type: 'text-box', rect: REGION, text: 'hello' });
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
