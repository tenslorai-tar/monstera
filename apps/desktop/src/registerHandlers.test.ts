import { type Incident, channelIds } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { type AppInfo, createContractHandlers } from './contractHandlers.js';
import { type DocumentCommands } from './documentCommands.js';
import { type IpcHandleTarget, registerContractHandlers } from './registerHandlers.js';

/**
 * Registration, and the assembly it registers.
 *
 * `document.execute`'s behaviour is covered end to end against a real engine in
 * `documentCommands.test.ts` — a real `DocumentService` over a real file, a real
 * `CommandBus`, a real `wrapHandler`. What is new here is the *wiring*: that
 * every declared channel reaches the IPC layer, that the listener hands the
 * boundary what the renderer sent, and that `app.info` has a handler at all.
 *
 * That last one is finding CC-2: `channels.ts` says a channel is added only when
 * a real handler exists, and `app.info` had none outside test fixtures from the
 * day it was declared.
 */

/** Records what was registered, in place of `ipcMain`. */
function recorder(): IpcHandleTarget & {
  readonly seen: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
} {
  const seen = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    seen,
    handle: (channel, listener) => {
      if (seen.has(channel)) throw new Error(`registered twice: ${channel}`);
      seen.set(channel, listener);
    },
  };
}

const appInfo: AppInfo = { version: '9.9.9', installChannel: 'web' };

/**
 * The command bus is not exercised by anything in this file.
 *
 * `app.info` never touches it, and the registration cases below stop at the
 * boundary — a `document.execute` call here would be a second, worse copy of a
 * test that already runs against the real engine one file over. Standing in for
 * it keeps these cases at milliseconds and needs no PDF on disk.
 */
const unusedCommands = {} as unknown as DocumentCommands;

function handlers() {
  return createContractHandlers({ commands: unusedCommands, appInfo });
}

describe('main-process contract registration', () => {
  it('registers EVERY declared channel, and each exactly once', () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined);

    // Compared against the registry, not against a list written here. A literal
    // list would be the second place a channel is written down, which is the
    // defect this registration exists to avoid, reproduced in its own test.
    expect([...ipc.seen.keys()].sort()).toEqual([...channelIds].sort());
  });

  it('answers app.info with the values it was built with', async () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined);

    const listener = ipc.seen.get('app.info');
    expect(listener).toBeDefined();
    const envelope = await listener?.({}, {});

    expect(envelope).toEqual({ ok: true, value: { version: '9.9.9', installChannel: 'web' } });
  });

  // THE ASSERTION IS ON THE DIAGNOSTIC, and the first draft of this case was
  // wrong in a way its own name hid. It sent `'not an object'` and asserted the
  // envelope was `ok: false` — but a listener that dropped args[0] entirely and
  // passed `undefined` ALSO fails the schema, so the case passed under the exact
  // mutation it was written to catch. Measured: replacing the listener with
  // `() => wrapped[id](undefined)` left this green while two other cases went
  // red.
  //
  // A fixture whose expected output the bug also produces separates nothing.
  // What distinguishes them is what the parse SAW, so the case reads the
  // withheld diagnostic and requires it to name the string that was sent.
  it('hands the boundary what the renderer sent, from args[0]', async () => {
    const seen: Incident[] = [];
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), (incident) => {
      seen.push(incident);
    });

    const listener = ipc.seen.get('app.info');
    const envelope = (await listener?.({}, 'not an object')) as { ok: boolean };

    expect(envelope.ok).toBe(false);
    expect(seen).toHaveLength(1);
    // `string` appears only if the string reached the schema. A dropped argument
    // produces a complaint about `undefined` instead.
    expect(seen[0]?.diagnostic.message).toContain('string');
    expect(seen[0]?.diagnostic.message).not.toContain('undefined');
  });

  it('records a malformed call as an incident instead of rejecting', async () => {
    const seen: Incident[] = [];
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), (incident) => {
      seen.push(incident);
    });

    const listener = ipc.seen.get('document.execute');
    const envelope = (await listener?.({}, { docId: '', command: null })) as {
      ok: boolean;
      error: { code: string; incident?: string };
    };

    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('internal');
    expect(envelope.error.incident).toBeTruthy();

    // THE HALF THAT MATTERS. The diagnostic names the channel and the fields;
    // it stayed here, and the renderer got an id. A schema error is a disclosure
    // question exactly as an fs error is.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channel).toBe('document.execute');
    expect(JSON.stringify(envelope)).not.toContain('docId');
  });

  it('CONTROL: a well-formed call is not refused by the same path', async () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined);

    // Without this, every case above is satisfied by a registration that refuses
    // everything — the failure mode a "does it reject?" assertion cannot see.
    const envelope = (await ipc.seen.get('app.info')?.({}, {})) as { ok: boolean };
    expect(envelope.ok).toBe(true);
  });
});
