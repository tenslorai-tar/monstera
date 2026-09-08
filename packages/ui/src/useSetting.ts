import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { z } from 'zod';

import type { SettingDefinition } from './registries/settings.js';
import type { SettingsStore } from './settingsStore.js';

/**
 * A setting's live value, re-rendering when it changes.
 *
 * ## Why a hook and not three subscriptions
 *
 * `useTheme` subscribes by hand because it writes an attribute rather than
 * rendering — it has no value to return. Every other reader does have one, and
 * three components each writing their own `subscribe`/`unsubscribe` pair is
 * three chances to leak a listener into a closed document. One hook is B3 for
 * *how a component reads a setting*.
 *
 * ## `useSyncExternalStore`, which is the one that cannot tear
 *
 * The store is mutable and lives outside React. An effect that copied its value
 * into state would render one frame with the old value on every change, and
 * would read a value that had already moved during a concurrent render. This is
 * React's own answer to that, and using anything else here would be a second
 * one.
 *
 * The subscription is filtered to the id, so a change to an unrelated setting
 * does not re-render this component.
 *
 * ## `getSnapshot` HAS TO RETURN THE SAME REFERENCE, and it did not for objects
 *
 * This paragraph read *"which holds here because the values are primitives"*
 * until 2026-09-08, and it was a **stated limitation with nothing enforcing
 * it**. `SettingsStore.get` answers `registry.read(id, …)`, which ends in
 * `schema.safeParse(candidate).data` — and zod builds a **new array or object**
 * every call. So the first non-primitive setting would have made every reader
 * of it return a fresh reference on every `getSnapshot`, which React treats as
 * a change: an infinite render loop, in a component that looks exactly like the
 * six that work.
 *
 * The personal dictionary is the first such setting, and it does not go through
 * this hook — which is precisely why this was worth fixing rather than noting:
 * the limitation would have stayed true and untested until somebody added a
 * non-primitive setting a *component* reads, and the failure then is a hang
 * with no obvious cause.
 *
 * So the snapshot is **held**, and replaced only when the value it serialises
 * to changes. Primitives skip the cache entirely, so the six existing readers
 * are byte-for-byte unchanged in behaviour. `JSON.stringify` is the comparison
 * because a setting's value is by construction something that survives being
 * written to and read from a settings file — there is no value in this store it
 * cannot compare.
 */
export function useSetting<Schema extends z.ZodType>(
  store: SettingsStore,
  setting: SettingDefinition<Schema>,
): z.infer<Schema> {
  /** The last object-valued snapshot handed out, and what it serialised to. */
  const held = useRef<{ key: string; value: unknown } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe((id) => {
        if (id === setting.id) onChange();
      }),
    [store, setting.id],
  );

  const snapshot = useCallback((): z.infer<Schema> => {
    const next = store.get(setting.id);
    // THE TYPE COMES FROM THE DECLARATION'S OWN SCHEMA, which is what makes
    // this a narrowing rather than an assertion: a caller cannot ask for a
    // `boolean` from an enum setting, because the return type is derived from
    // the definition it was handed.
    //
    // The cast is still here because `get` answers `unknown` — the store holds
    // many schemas and cannot say which — and it is sound for the reason the
    // store's own header gives: `set` validates before storing and `read`
    // applies the fallback, so what comes back has been through this schema.
    if (typeof next !== 'object' || next === null) return next as z.infer<Schema>;

    const key = JSON.stringify(next);
    if (held.current?.key !== key) held.current = { key, value: next };
    return held.current.value as z.infer<Schema>;
  }, [store, setting.id]);

  return useSyncExternalStore(subscribe, snapshot);
}
