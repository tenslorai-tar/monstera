import { type ContractClient, type DispatchableCommand, channels, createClient } from '@monstera/contract';
import { type DocId, type DocVersion, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyDocumentCommand, sameWalk } from './documentCommands.js';

/**
 * The command lane (the owner's O6 and W6): a run of commands a person makes faster than each answer arrives — a nudge
 * straight after a drag, a held arrow key, a colour picked twice — is sent in turn, each at the version this renderer's
 * own previous command left its target at where that command kept the target's walk.
 *
 * Main is a fake with the bus's own rule (`commandBus.ts`' stale check): a command naming a version that is not the
 * document's current one is refused `stale-target`, and every other command moves the version by one. The CONTROLS are
 * the moves the lane must not follow: one that added an item, one in another walk, and one this renderer did not send.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000aa');
const START = asDocVersion(10);
const stamp = (): { author: string; created: string } => ({ author: 'A. Tester', created: '2026-10-12T22:00:00.000Z' });

interface Main {
  readonly client: ContractClient;
  /** Each execute in arrival order: its kind, the version it named, and whether it applied. */
  readonly calls: { kind: string; named: DocVersion | undefined; applied: boolean }[];
  /** Moves the document as another window would: a version this renderer did not produce. */
  readonly elsewhere: () => void;
}

function fakeMain(): Main {
  let version = START;
  const calls: Main['calls'] = [];
  const client = createClient(channels, async (id, params) => {
    if (id !== 'document.execute') throw new Error(`this fixture has no answer for ${id}`);
    // AN ANSWER THAT TAKES A TURN OF ITS OWN, as one through main does, so commands sent together overlap.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const command = (params as { command: { kind: string; version?: DocVersion } }).command;
    const named = command.version;
    if (named !== undefined && named !== version) {
      calls.push({ kind: command.kind, named, applied: false });
      return err({ code: 'stale-target' as const });
    }
    calls.push({ kind: command.kind, named, applied: true });
    version = asDocVersion(Number(version) + 1);
    return ok({ version, byteLength: 1024, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] });
  });
  return {
    client,
    calls,
    elsewhere: () => {
      version = asDocVersion(Number(version) + 1);
    },
  };
}

function deps(client: ContractClient): Parameters<typeof applyDocumentCommand>[0] & { problems: unknown[] } {
  const problems: unknown[] = [];
  return {
    client,
    problems,
    onApplied: () => undefined,
    ask: (id, props) => {
      if (id === 'dialog.command-problem') problems.push(props);
      return Promise.resolve(undefined);
    },
    stamp,
    signatures: { warn: () => false, onOpened: () => undefined },
  };
}

const restyle = (version: DocVersion, colour: [number, number, number]): DispatchableCommand => ({
  kind: 'styleAnnotation',
  page: 0,
  indices: [0],
  colour,
  version,
});

const nudge = (version: DocVersion, x: number): DispatchableCommand => ({
  kind: 'placeAnnotation',
  page: 0,
  placements: [{ index: 0, rect: { x0: x, y0: 10, x1: x + 20, y1: 30 } }],
  version,
});

/** Sends every command at once, as a held key or a dragged picker does, and waits for them all. */
async function together(main: Main, commands: readonly DispatchableCommand[], docId: DocId = DOC): Promise<boolean[]> {
  const sending = deps(main.client);
  return Promise.all(commands.map((command) => applyDocumentCommand(sending, docId, command)));
}

describe('the command lane', () => {
  it('a nudge composed before the drag before it landed is sent where the drag left the mark, and applies', async () => {
    const main = fakeMain();
    const results = await together(main, [nudge(START, 50), nudge(START, 51)]);
    expect(results).toStrictEqual([true, true]);
    expect(main.calls.map((call) => [call.named, call.applied])).toStrictEqual([
      [START, true],
      [asDocVersion(11), true],
    ]);
  });

  it('a held key: twenty nudges composed at one version all apply, in the order they were made', async () => {
    const main = fakeMain();
    const results = await together(
      main,
      Array.from({ length: 20 }, (_unused, at) => nudge(START, 50 + at)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(main.calls.filter((call) => call.applied)).toHaveLength(20);
  });

  it('three colours picked at one version: all apply, and the last one picked is the last one written', async () => {
    const main = fakeMain();
    await together(main, [restyle(START, [1, 0, 0]), restyle(START, [0, 1, 0]), restyle(START, [0, 0, 1])]);
    expect(main.calls.map((call) => call.applied)).toStrictEqual([true, true, true]);
  });

  it('CONTROL: a command after a move that ADDED an item is refused, since its index may name another mark', async () => {
    const main = fakeMain();
    const reply: DispatchableCommand = { kind: 'replyToAnnotation', page: 0, index: 0, text: 'yes', version: START };
    const sending = deps(main.client);
    const results = await Promise.all([
      applyDocumentCommand(sending, DOC, reply),
      applyDocumentCommand(sending, DOC, restyle(START, [1, 0, 0])),
    ]);
    expect(results).toStrictEqual([true, false]);
    expect(main.calls.at(-1)).toStrictEqual({ kind: 'styleAnnotation', named: START, applied: false });
    expect(sending.problems).toStrictEqual([{ code: 'stale-target' }]);
  });

  it('CONTROL: a move in the ANNOTATION walk is not followed by a command naming a FORM FIELD', async () => {
    const main = fakeMain();
    const field: DispatchableCommand = {
      kind: 'editFormFields',
      edits: [{ field: { page: 0, index: 0, name: 'Name' }, set: { readOnly: true } }],
      version: START,
    };
    const results = await together(main, [nudge(START, 50), field]);
    expect(results).toStrictEqual([true, false]);
  });

  it('CONTROL: a move this renderer did not send is not followed, and the command is refused', async () => {
    const main = fakeMain();
    await together(main, [nudge(START, 50)]);
    main.elsewhere();
    const results = await together(main, [nudge(START, 51)]);
    expect(results).toStrictEqual([false]);
  });

  it('a field edit composed before the previous field edit landed is followed too (the forms walk’s nudge after a move)', async () => {
    const main = fakeMain();
    const move = (x: number): DispatchableCommand => ({
      kind: 'editFormFields',
      edits: [{ field: { page: 0, index: 0, name: 'Name' }, set: { rect: { x0: x, y0: 10, x1: x + 40, y1: 30 } } }],
      version: START,
    });
    expect(await together(main, [move(50), move(52)])).toStrictEqual([true, true]);
  });

  // THE OWNER'S O6a: a second press on a form 3 to 5 s after a fill, composed before the fill's re-read landed. A fill
  // keeps the widget walk (proven against the engine in `fieldWalkKeeping.test.ts`), so what follows it is followed.
  it('a fill, and a field edit, composed before the previous fill landed are followed', async () => {
    const main = fakeMain();
    const fill = (on: boolean): DispatchableCommand => ({ kind: 'fillFormField', page: 0, index: 0, value: { set: 'button', on }, version: START });
    const move: DispatchableCommand = {
      kind: 'editFormFields',
      edits: [{ field: { page: 0, index: 0, name: 'Agree' }, set: { rect: { x0: 50, y0: 10, x1: 66, y1: 26 } } }],
      version: START,
    };
    expect(await together(main, [fill(true), fill(false), move])).toStrictEqual([true, true, true]);
  });

  it('two documents have two lanes: a move in one is never followed in the other', async () => {
    const main = fakeMain();
    const other = asDocId('00000000-0000-4000-8000-0000000000bb');
    const sending = deps(main.client);
    await applyDocumentCommand(sending, DOC, nudge(START, 50));
    expect(await applyDocumentCommand(sending, other, nudge(START, 51))).toBe(false);
  });

  it('sameWalk answers the lane’s moves in both directions, and nothing else', async () => {
    const main = fakeMain();
    await together(main, [nudge(START, 50), nudge(START, 51)]);
    const twelve = asDocVersion(12);
    expect(sameWalk(main.client, DOC, 'annotation', START, twelve)).toBe(true);
    expect(sameWalk(main.client, DOC, 'annotation', twelve, START)).toBe(true);
    expect(sameWalk(main.client, DOC, 'field', START, twelve)).toBe(false);
    expect(sameWalk(main.client, DOC, 'annotation', START, asDocVersion(13))).toBe(false);
  });
});
