import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { SettingsRegistry } from './registries/settings.js';
import { THEME_SETTING } from './settings/appearance.js';
import { SettingsStore } from './settingsStore.js';
import { hydrateSettings, persistSettings } from './settingsSync.js';

/**
 * The renderer's half of persistence.
 *
 * ## The client is built from the CONTRACT, not from the browser shim
 *
 * `packages/ui` may not import `@monstera/testing` — the boundary lint says so,
 * and the reason is the one §1 gives: the renderer stays browser-only, and the
 * shim is a Node-side fixture. So the store below is this file's own, and
 * `createClient(channels, …)` is what makes the payloads travel through the real
 * schemas. A schema that refused what `settings.save` sends would fail here.
 *
 * ## The store is a `Map`, and it is the RESTART this file is about
 *
 * Persistence is only observable across a relaunch: a setting that resets every
 * launch and one that survives produce the same observation at the moment of
 * writing. So the fixture keeps values outside every `SettingsStore`, and the
 * cases that matter build a *second* store and hydrate it — which is what a next
 * launch is, with the process boundary removed.
 */

function freshStore(): SettingsStore {
  return new SettingsStore(new SettingsRegistry([THEME_SETTING]));
}

/**
 * A client over a stored document that outlives any `SettingsStore`.
 *
 * @param seeded what a previous run left behind
 */
function persistentClient(seeded: Readonly<Record<string, unknown>> = {}): {
  readonly client: ContractClient;
  readonly stored: () => Readonly<Record<string, unknown>>;
} {
  let held: Record<string, unknown> = { ...seeded };
  const client = createClient(channels, (id, params) => {
    if (id === 'settings.load') return Promise.resolve(ok({ stored: { ...held } }));
    if (id === 'settings.save') {
      held = { ...(params as { values: Record<string, unknown> }).values };
      return Promise.resolve(ok({ stored: true }));
    }
    throw new Error(`this fixture answers only the settings channels, not ${id}`);
  });
  // Returned as a reader rather than as the object, so a case cannot hold a
  // reference that changes underneath it and read a save it never waited for.
  return { client, stored: () => ({ ...held }) };
}

describe('settings sync', () => {
  it('hydrates from what the previous run stored', async () => {
    const { client } = persistentClient({ [THEME_SETTING.id]: 'dark' });
    const store = freshStore();

    await hydrateSettings(client, store);

    expect(store.get(THEME_SETTING.id)).toBe('dark');
  });

  it('CONTROL: with nothing stored, the registry fallback is what is read', async () => {
    // Without this the case above passes for a `hydrate` that ignores its
    // argument and for a store that already held 'dark' — the fixture the defect
    // handles correctly. `system` is the fallback and is a value no test wrote.
    const { client } = persistentClient();
    const store = freshStore();

    await hydrateSettings(client, store);

    expect(store.get(THEME_SETTING.id)).toBe('system');
  });

  it('a stored value the schema refuses falls back, and the channel carried it', async () => {
    const { client } = persistentClient({
      [THEME_SETTING.id]: 'ultraviolet',
      'unknown.setting': 1,
    });
    const store = freshStore();

    await hydrateSettings(client, store);

    // The channel carried both values untouched — that is what it is for — and
    // the registry decided what they meant. A boundary that had validated would
    // have dropped the first before the component that owns the fallback saw it.
    expect(store.get(THEME_SETTING.id)).toBe('system');
  });

  it('a change is SAVED, and read back by a store that never saw it', async () => {
    const { client } = persistentClient();
    const writer = freshStore();
    persistSettings(client, writer);

    writer.set(THEME_SETTING.id, 'dark');
    // The save is not awaited by `persistSettings` — a subscriber cannot block —
    // so the microtask queue is drained before reading. Awaiting a promise the
    // production path deliberately does not await would test a different shape.
    await Promise.resolve();
    await Promise.resolve();

    // THE RESTART, renderer-side: a second store, sharing nothing with the first
    // but the stored document. This is the observation that separates *the value
    // was written* from *the value will be there next launch*, and asserting the
    // call was made would separate neither.
    const reader = freshStore();
    await hydrateSettings(client, reader);

    expect(reader.get(THEME_SETTING.id)).toBe('dark');
  });

  it('a HYDRATE does not save, so a newer build’s setting is not deleted', async () => {
    // THE CASE THIS MECHANISM EXISTS FOR, and it is a decision rather than a
    // state — so what is asserted is the call that was NOT made.
    //
    // `hydrate` drops ids the registry does not know. That is right for a
    // setting an older build removed and catastrophic for one a NEWER build
    // added: if a hydrate triggered a save, launching this build would rewrite
    // the file without that value, before the user touched anything.
    const { client, stored } = persistentClient({ 'from.a.newer.build': 'keep me' });
    const store = freshStore();
    persistSettings(client, store);

    await hydrateSettings(client, store);
    await Promise.resolve();
    await Promise.resolve();

    // The stored document still carrying the id is the only thing that
    // distinguishes "we did not save" from "we saved everything we knew about".
    expect(stored()).toStrictEqual({ 'from.a.newer.build': 'keep me' });
  });

  it('CONTROL: and a real change DOES reach the same document', async () => {
    // The partner to the case above. Without it, `persistSettings` returning a
    // function that subscribes to nothing satisfies "a hydrate does not save"
    // perfectly — the guard passing because the mechanism is absent.
    const { client, stored } = persistentClient({ 'from.a.newer.build': 'keep me' });
    const store = freshStore();
    persistSettings(client, store);

    await hydrateSettings(client, store);
    store.set(THEME_SETTING.id, 'light');
    await Promise.resolve();
    await Promise.resolve();

    // AND THE UNKNOWN ID IS GONE, which is the honest half of the mechanism:
    // once the user changes something, the whole document is replaced by what
    // this build holds. The hydrate-does-not-save rule buys them a launch, not
    // immortality, and stating that here stops the pair reading as a promise the
    // code does not make.
    expect(stored()).toStrictEqual({ [THEME_SETTING.id]: 'light' });
  });

  it('unsubscribing stops the saves', async () => {
    const { client, stored } = persistentClient();
    const store = freshStore();
    const stop = persistSettings(client, store);

    stop();
    store.set(THEME_SETTING.id, 'dark');
    await Promise.resolve();
    await Promise.resolve();

    expect(stored()).toStrictEqual({});
  });
});
