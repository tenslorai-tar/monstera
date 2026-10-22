import { type Incident, PRELOAD_CHANNEL_IDS, channelIds } from '@monstera/contract';
import type { CapabilityRegistry, DocumentService } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { createAssistant } from './assistant.js';
import { noChatHistory } from './chatHistory.js';
import { unconfiguredCloud } from './cloudSession.js';
import { type AppInfo, createContractHandlers } from './contractHandlers.js';
import type { DocumentCommands } from './documentCommands.js';
import { NO_RECENT_PICTURES } from './recentPictures.js';
import { NO_ATTACHMENTS } from './askAttachments.js';
import { unusedLibrarySurface } from './personalLibrary.js';
import { NO_REVIEW_PROMPT } from './engagement.js';
import { NO_MEMORY_RELEASE } from './memoryRelease.js';
import { NO_RENDERER_ENDING } from './rendererEnding.js';
import {
  type IpcHandleTarget,
  type IpcSenderCheck,
  UntrustedSenderError,
  registerContractHandlers,
} from './registerHandlers.js';

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

const appInfo: AppInfo = { version: '9.9.9', installChannel: 'web', userName: 'A. Tester', cloudProviders: ['onedrive', 'google-drive'], mediaFoundation: true };

/**
 * The command bus is not exercised by anything in this file.
 *
 * `app.info` never touches it, and the registration cases below stop at the
 * boundary — a `document.execute` call here would be a second, worse copy of a
 * test that already runs against the real engine one file over. Standing in for
 * it keeps these cases at milliseconds and needs no PDF on disk.
 */
const unusedCommands = {} as unknown as DocumentCommands;

/**
 * The cases about registration and the boundary are not about the sender check,
 * so they say so rather than passing a check that happens to accept `{}`.
 *
 * The sender check has its own describe block below, with both directions.
 */
const trustAll: IpcSenderCheck = () => true;

function handlers(regionalLocale?: () => string, physicalMemory?: () => number) {
  return createContractHandlers({
    physicalMemory,
    // Same reasoning as the parts below: these cases are about which channels register.
    assistant: createAssistant({
      secret: () => undefined,
      setting: (definition) => definition.fallback,
      send: () => undefined,
      openInBrowser: () => Promise.resolve(),
    }),
    appInfo,
    regionalLocale,
    // Same reasoning as `unusedCommands` above: these cases are about which
    // channels get registered and by what route, not about what any handler
    // does. A picker that throws says so — if a case in this file ever reaches
    // it, the case is about something else than it claims.
    capabilities: {} as unknown as CapabilityRegistry,
    commands: unusedCommands,
    documents: {} as unknown as DocumentService,
    openedDocument: () => {
      throw new Error('registration cases must not reach the session opener');
    },
    unlockDocument: () => {
      throw new Error('registration cases must not reach the session opener');
    },
    pickDocument: () => {
      throw new Error('registration cases must not reach the picker');
    },
    // A THROWING `RecentFiles`, not `createRecentFiles` over a throwing file:
    // the real one reads and writes at construction — it clears the clean-exit
    // marker immediately — so a throwing file surface would fail while these
    // cases were being built rather than if one reached the list.
    recent: {
      list: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      record: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      lastExitClean: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      markCleanExit: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      opened: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      closed: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      lastSession: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      clear: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      has: () => {
        throw new Error('registration cases must not reach the recent list');
      },
      // REGISTERING a listener is construction, not a use of the list, so it does not throw.
      onDropped: () => undefined,
    },
    recentRoots: [],
    recentPictures: NO_RECENT_PICTURES,
    fileIdentity: () => {
      throw new Error('registration cases must not reach the recent list');
    },
    library: unusedLibrarySurface(),
    reviewPrompt: NO_REVIEW_PROMPT,
    memoryRelease: NO_MEMORY_RELEASE,
    rendererEnding: NO_RENDERER_ENDING,
    settings: {
      read: () => {
        throw new Error('registration cases must not reach the settings surface');
      },
      write: () => {
        throw new Error('registration cases must not reach the settings surface');
      },
    },
    secrets: {
      available: () => {
        throw new Error('registration cases must not reach the secret store');
      },
      read: () => {
        throw new Error('registration cases must not reach the secret store');
      },
      write: () => {
        throw new Error('registration cases must not reach the secret store');
      },
    },
    pickSettingsFile: () => {
      throw new Error('registration cases must not reach the file picker');
    },
    openSettingsFile: () => {
      throw new Error('registration cases must not reach the file picker');
    },
    // EVERY OPERATION THROWS, this fixture's rule; `noChatHistory()` would answer a load quietly.
    chatHistory: {
      ...noChatHistory(),
      available: () => {
        throw new Error('registration cases must not reach the chat history');
      },
      load: () => {
        throw new Error('registration cases must not reach the chat history');
      },
      clear: () => {
        throw new Error('registration cases must not reach the chat history');
      },
    },
    titleBarOverlay: () => {
      throw new Error('registration cases must not reach the window');
    },
    confirmClose: () => {
      throw new Error('registration cases must not reach the window');
    },
    edit: () => {
      throw new Error('registration cases must not reach the window');
    },
    copyText: () => {
      throw new Error('registration cases must not reach the clipboard');
    },
    openWebPage: () => {
      throw new Error('registration cases must not reach the browser');
    },
    openLink: () => {
      throw new Error('registration cases must not follow a link');
    },
    postForm: () => {
      throw new Error('registration cases must not send a form');
    },
    postDocument: () => {
      throw new Error('registration cases must not send a document');
    },
    openStore: () => {
      throw new Error('registration cases must not reach the Store');
    },
    closeListening: () => {
      throw new Error('registration cases must not reach the window');
    },
    cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
    revealLog: () => {
      throw new Error('registration cases must not reach the log');
    },
    revealPath: () => {
      throw new Error('registration cases must not reach the file manager');
    },
    readDictionary: () => {
      throw new Error('registration cases must not read a dictionary');
    },
    ocrLanguages: () => {
      throw new Error('registration cases must not read the model directory');
    },
    components: () => {
      throw new Error('registration cases must not read the native components');
    },
    prepareEditing: () => {
      throw new Error('registration cases must not start an engine');
    },
  });
}

describe('main-process contract registration', () => {
  it('registers EVERY declared channel, and each exactly once', () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined, trustAll);

    // Compared against the registry, not against a list written here. A literal
    // list would be the second place a channel is written down, which is the
    // defect this registration exists to avoid, reproduced in its own test.
    // The preload's channels register with the rest (ADR-0099), from the contract's own list.
    expect([...ipc.seen.keys()].sort()).toEqual([...channelIds, ...PRELOAD_CHANNEL_IDS].sort());
  });

  it('answers app.info with the values it was built with', async () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined, trustAll);

    const listener = ipc.seen.get('app.info');
    expect(listener).toBeDefined();
    const envelope = await listener?.({}, {});

    // NO READER, a harness's position: the region is empty and the renderer's own default stands.
    expect(envelope).toEqual({
      ok: true,
      value: { version: '9.9.9', installChannel: 'web', userName: 'A. Tester', cloudProviders: ['onedrive', 'google-drive'], mediaFoundation: true, regionalLocale: '', physicalMemory: 0 },
    });
  });

  it('reads the computer’s region WHEN app.info IS ASKED, never when the handlers are built (the owner’s F10)', async () => {
    // `app.getSystemLocale()` before Electron's `ready` aborts the process, and the handlers are built before it: a
    // reader that throws until asked is the shape of that, so building with it must not call it.
    let ready = false;
    const read = () => {
      if (!ready) throw new Error('read before ready');
      return 'en-GB';
    };
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(read), () => undefined, trustAll);
    ready = true;
    const envelope = (await ipc.seen.get('app.info')?.({}, {})) as { value: { regionalLocale: string } };
    expect(envelope.value.regionalLocale).toBe('en-GB');
    // A POSIX NAME, as Linux answers, crosses as its tag.
    const posix = recorder();
    registerContractHandlers(posix, handlers(() => 'en_US@posix'), () => undefined, trustAll);
    expect(((await posix.seen.get('app.info')?.({}, {})) as { value: { regionalLocale: string } }).value.regionalLocale).toBe('en-US');
  });

  it('app.info carries the computer’s physical memory for the Memory for pages limit, and 0 where none is read (ADR-0247)', async () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(undefined, () => 8 * 1024 ** 3), () => undefined, trustAll);
    const answer = (await ipc.seen.get('app.info')?.({}, {})) as { value: { physicalMemory: number } };
    expect(answer.value.physicalMemory).toBe(8 * 1024 ** 3);
    // CONTROL: a harness that reads none answers 0, which the renderer takes as no limit yet.
    const none = recorder();
    registerContractHandlers(none, handlers(), () => undefined, trustAll);
    expect(((await none.seen.get('app.info')?.({}, {})) as { value: { physicalMemory: number } }).value.physicalMemory).toBe(0);
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
  //
  // The second draft read the withheld diagnostic and required it to name the
  // string that was sent. That held while the diagnostic was zod's message, and
  // stopped separating anything when X4 (50682806) put the issues in our words:
  // a string and `undefined` both read `invalid_type at depth 0`, deliberately,
  // since the words carry no value the peer chose. So the case now asserts the
  // one outcome only the correct path produces: `app.info` takes `{}`, which
  // only args[0] supplies, and a dropped argument is refused.
  it('hands the boundary what the renderer sent, from args[0]', async () => {
    const seen: Incident[] = [];
    const ipc = recorder();
    registerContractHandlers(
      ipc,
      handlers(),
      (incident) => {
        seen.push(incident);
      },
      trustAll,
    );

    const listener = ipc.seen.get('app.info');
    const accepted = (await listener?.({}, {})) as { ok: boolean };
    expect(accepted.ok).toBe(true);
    expect(seen).toHaveLength(0);

    // CONTROL: the same listener handed a value the schema refuses is refused and recorded, so the acceptance above is
    // the parse passing and not a listener that never parses.
    const refused = (await listener?.({}, 'not an object')) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect(seen.map((incident) => incident.diagnostic.message)).toStrictEqual(['Invalid params for "app.info": invalid_type at depth 0']);
  });

  it('records a malformed call as an incident instead of rejecting', async () => {
    const seen: Incident[] = [];
    const ipc = recorder();
    registerContractHandlers(
      ipc,
      handlers(),
      (incident) => {
        seen.push(incident);
      },
      trustAll,
    );

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
    registerContractHandlers(ipc, handlers(), () => undefined, trustAll);

    // Without this, every case above is satisfied by a registration that refuses
    // everything — the failure mode a "does it reject?" assertion cannot see.
    const envelope = (await ipc.seen.get('app.info')?.({}, {})) as { ok: boolean };
    expect(envelope.ok).toBe(true);
  });
});

describe('sender check', () => {
  const trusted = { senderId: 1 };
  const check: IpcSenderCheck = (event) => event === trusted;

  it('refuses EVERY channel when the sender is not the shell’s own frame', () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined, check);

    // Every channel, from the registry. A check applied to one channel and
    // forgotten on the next is exactly the "loop that already looks finished"
    // trap, and a single-channel case cannot see it. The preload's channels too (ADR-0099).
    for (const id of [...channelIds, ...PRELOAD_CHANNEL_IDS]) {
      expect(() => ipc.seen.get(id)?.({ senderId: 2 }, {})).toThrow(UntrustedSenderError);
    }
  });

  it('CONTROL: the trusted sender is not refused on any channel', async () => {
    const ipc = recorder();
    registerContractHandlers(ipc, handlers(), () => undefined, check);

    // Without this, the case above is satisfied by a listener that throws for
    // every event — "it rejected" and "it rejects everything" are the same
    // observation otherwise, and the second is a shell that cannot work at all.
    const envelope = (await ipc.seen.get('app.info')?.(trusted, {})) as { ok: boolean };
    expect(envelope.ok).toBe(true);
  });

  it('refuses BEFORE the arguments are parsed, so an untrusted sender never reaches the schema', () => {
    const seen: Incident[] = [];
    const ipc = recorder();
    registerContractHandlers(
      ipc,
      handlers(),
      (incident) => {
        seen.push(incident);
      },
      check,
    );

    // `'not an object'` is the payload that produces a schema incident on the
    // trusted path — proven one describe block up. From an untrusted sender it
    // must produce NO incident, which is what distinguishes "refused early" from
    // "refused after being parsed and logged".
    expect(() => ipc.seen.get('app.info')?.({ senderId: 2 }, 'not an object')).toThrow(
      UntrustedSenderError,
    );
    expect(seen).toHaveLength(0);
  });

  it('names the channel it refused, and discloses nothing else', () => {
    const error = new UntrustedSenderError('document.execute');

    expect(error.message).toContain('document.execute');
    // No incident id: IncidentLog.record is documented as the only place a
    // thrown value becomes an id, and a second counter means two `i1`s.
    expect(error.message).not.toMatch(/\bi\d+\b/u);
  });
});
