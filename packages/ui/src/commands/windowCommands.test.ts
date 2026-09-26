import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { checkForUpdatesCommand } from './checkForUpdates.js';
import { exitCommand, startScreenCommand } from './windowCommands.js';

const WITH_DOCUMENT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-0000000000c9'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};
const NO_DOCUMENT: CommandContext = { ...WITH_DOCUMENT, docId: undefined, version: undefined, page: undefined, pageCount: undefined };

describe('File › Start screen and File › Exit (ADR-0107)', () => {
  it('Start screen shows the start screen, and exists only while a document is in front', () => {
    let shown = 0;
    const command = startScreenCommand({ showStart: () => void (shown += 1) });
    expect(command.when?.(NO_DOCUMENT)).toBe(false);
    expect(command.when?.(WITH_DOCUMENT)).toBe(true);
    void command.run(WITH_DOCUMENT);
    expect(shown).toBe(1);
  });

  it('Exit is the window’s ONE close, handed in — it closes nothing by itself', async () => {
    let asked = 0;
    const command = exitCommand({
      closeWindow: () => {
        asked += 1;
        return Promise.resolve();
      },
    });
    // ON THE START SCREEN TOO: a window with nothing open still closes.
    expect(command.when).toBeUndefined();
    await command.run(NO_DOCUMENT);
    expect(asked).toBe(1);
  });
});

describe('Help › Check for updates (ADR-0107)', () => {
  it('asks main to open the Store’s UPDATES page — the one page named, and nothing else crosses', async () => {
    const sent: unknown[] = [];
    const client: ContractClient = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ opened: true }));
    });
    await checkForUpdatesCommand({ client }).run(NO_DOCUMENT);
    expect(sent).toStrictEqual([{ id: 'app.openStore', params: { page: 'updates' } }]);
  });
});
