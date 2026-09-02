import { useSyncExternalStore } from 'react';
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
 * does not re-render this component. `getSnapshot` must be stable enough to
 * return the same reference for an unchanged value — which holds here because
 * the values are primitives.
 */
export function useSetting<Schema extends z.ZodType>(
  store: SettingsStore,
  setting: SettingDefinition<Schema>,
): z.infer<Schema> {
  return useSyncExternalStore(
    (onChange) =>
      store.subscribe((id) => {
        if (id === setting.id) onChange();
      }),
    // THE TYPE COMES FROM THE DECLARATION'S OWN SCHEMA, which is what makes
    // this a narrowing rather than an assertion: a caller cannot ask for a
    // `boolean` from an enum setting, because the return type is derived from
    // the definition it was handed.
    //
    // The cast is still here because `get` answers `unknown` — the store holds
    // many schemas and cannot say which — and it is sound for the reason the
    // store's own header gives: `set` validates before storing and `read`
    // applies the fallback, so what comes back has been through this schema.
    () => store.get(setting.id) as z.infer<Schema>,
  );
}
