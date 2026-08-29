import type { ContractClient } from '@monstera/contract';

import type { SettingsStore } from './settingsStore.js';

/**
 * The two halves that make a setting survive a restart.
 *
 * `SettingsStore`'s own header says persistence is owed and why it cannot live
 * there: the renderer holds no filesystem path (invariant 2), so writing a file
 * is unrepresentable rather than discouraged. This is the seam that was owed —
 * values out over `settings.save`, values in over `settings.load`, and nothing
 * about *where* on this side of the boundary.
 */

/**
 * Loads what the last run stored into `store`.
 *
 * ## Awaited BEFORE the first render, and that is not a preference
 *
 * The theme setting is applied to the root element by an effect. Rendering
 * first and hydrating second means the application paints in the default theme
 * and then changes — a visible flash on every launch for anyone who chose
 * anything but the default, which §10 bans in the same breath as spinner-only
 * loading states.
 *
 * ## A failure hydrates NOTHING rather than throwing
 *
 * `settings.load` declares no failure codes: a first launch, a missing file and
 * a corrupt one all answer with an empty object, because none of them is
 * something a user can act on and all of them mean *use the defaults*. What is
 * left is the boundary itself failing, which is a defect in this build — and the
 * right response is still the defaults, because refusing to start over a
 * preferences file would be the least recoverable failure this application has.
 */
export async function hydrateSettings(client: ContractClient, store: SettingsStore): Promise<void> {
  const answer = await client['settings.load']({});
  if (!answer.ok) return;
  store.hydrate(answer.value.stored);
}

/**
 * Persists every change to `store`, and returns the unsubscribe.
 *
 * ## A HYDRATE IS NOT A CHANGE, and writing on one would destroy data
 *
 * `SettingsStore.subscribe` reports `'*'` after a hydrate and an id after a
 * `set`. Saving on both looks harmless — it would write back what was just read
 * — except that `hydrate` **drops ids the registry does not know**, which is
 * correct for a setting an older build removed and catastrophic for one a
 * *newer* build added. A user who runs a newer build, sets something, then
 * launches this one would have that value silently deleted from disk by a write
 * nobody asked for, on startup, before touching anything.
 *
 * So only a real change persists. The stored document then keeps ids this build
 * does not understand until the user actually changes something, and even then
 * the loss is theirs to have caused rather than a launch's.
 *
 * ## `all()` rather than the one id that moved
 *
 * `settings.save` replaces the whole document, so what crosses is the store's
 * current state — the shape where *what is on disk* has one answer. A per-id
 * write would make the file the sum of a sequence, and an interrupted sequence
 * leaves a state no single write produced.
 *
 * ## The result is not awaited, and the failure is not reported
 *
 * A subscriber cannot block: it runs inside `set`, which the settings dialog
 * calls from an event handler. A write that fails is a preference that will not
 * survive the restart, which the user discovers at the restart — reporting it at
 * the moment of the change would need a dialog this application does not have
 * yet, and inventing one here would be a surface with no registration behind it.
 * The gap is real and is named in the FEATURES row rather than papered over.
 */
export function persistSettings(client: ContractClient, store: SettingsStore): () => void {
  return store.subscribe((id) => {
    if (id === '*') return;
    void client['settings.save']({ values: store.all() });
  });
}
