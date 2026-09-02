import { type ContractClient, channels, createClient } from '@monstera/contract';
import { INTERNAL_FAILURE, err, ok } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_PROBLEM_DIALOG_ID } from './dialogs/settingsProblem.js';
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

  it('a LATE answer still lands, because the store notifies', async () => {
    // Nothing waits for the hydrate — `main.tsx` fires it and renders — so an
    // answer always arrives after the first paint, and this is the case that
    // says a late one is still applied rather than dropped. Without it, a
    // `hydrateSettings` that ignored a slow answer would be indistinguishable
    // from one that works, on any client that answers immediately.
    //
    // A promise resolved by hand is the fixture, because "answers eventually" is
    // the shape a real IPC round trip has and an immediate mock does not.
    let answer: ((value: unknown) => void) | undefined;
    const client = createClient(channels, () => new Promise((resolve) => (answer = resolve)));
    const store = freshStore();

    const hydrating = hydrateSettings(client, store);
    expect(store.get(THEME_SETTING.id)).toBe('system');

    answer?.(ok({ stored: { [THEME_SETTING.id]: 'dark' } }));
    await hydrating;

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
    persistSettings(client, writer, vi.fn());

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
    persistSettings(client, store, vi.fn());

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
    persistSettings(client, store, vi.fn());

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

  it('a save that FAILS is reported, naming the setting from the registry', async () => {
    // ROW 292'S OWED CLAUSE. The write is fired and not awaited — a subscriber
    // cannot block — so the failure has to be handled in a continuation, and
    // until this case existed nothing looked at the answer at all.
    //
    // `settings.save` declares no failure codes, so the reachable failure is
    // `internal`: main's handler calls `write` and a throw becomes an internal
    // failure carrying an incident id. That is what a full disk looks like from
    // here.
    const shown: { id: string; props: unknown }[] = [];
    const client = createClient(channels, (id) =>
      id === 'settings.save'
        ? Promise.resolve(err({ code: INTERNAL_FAILURE, incident: 'incident-1' }))
        : Promise.resolve(ok({ stored: {} })),
    );
    const store = freshStore();
    persistSettings(client, store, (id, props) => shown.push({ id, props }));

    store.set(THEME_SETTING.id, 'dark');
    await Promise.resolve();
    await Promise.resolve();

    // THE SETTING'S OWN TITLE, from the registry rather than from the caller —
    // asserting only that *a* dialog opened would pass for one naming the wrong
    // preference, which is the whole thing a user needs from it.
    expect(shown).toStrictEqual([
      { id: SETTINGS_PROBLEM_DIALOG_ID, props: { setting: THEME_SETTING.title } },
    ]);

    // AND THE VALUE IS STILL APPLIED, which is what the dialog says and what
    // makes the report worth making. A case that only checked the dialog would
    // pass for an implementation that also rolled the change back — leaving the
    // user with an error about something that then did not happen.
    expect(store.get(THEME_SETTING.id)).toBe('dark');
  });

  it('CONTROL: a save that SUCCEEDS reports nothing', async () => {
    // Without this, `persistSettings` opening the dialog on every write
    // satisfies the case above perfectly — and a preference that reported a
    // failure every time it worked is worse than one that reported none.
    const shown: { id: string; props: unknown }[] = [];
    const { client } = persistentClient();
    const store = freshStore();
    persistSettings(client, store, (id, props) => shown.push({ id, props }));

    store.set(THEME_SETTING.id, 'dark');
    await Promise.resolve();
    await Promise.resolve();

    expect(shown).toStrictEqual([]);
  });

  it('unsubscribing stops the saves', async () => {
    const { client, stored } = persistentClient();
    const store = freshStore();
    const stop = persistSettings(client, store, vi.fn());

    stop();
    store.set(THEME_SETTING.id, 'dark');
    await Promise.resolve();
    await Promise.resolve();

    expect(stored()).toStrictEqual({});
  });
});
