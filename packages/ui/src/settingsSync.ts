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
 * ## NOTHING WAITS FOR THIS, and CI taught that in two steps
 *
 * The first version was awaited before the first render, so the theme would be
 * right on the first paint. That made the shell's existence depend on main
 * answering: `proof:rendererpolicy` loads the shipped renderer with **no
 * contract handlers registered** — deliberately, because its subject is the CSP
 * — so `settings.load` never resolved and the React shell never mounted. Both
 * matrix legs red at `7e59803`.
 *
 * The second version raced the wait against a 250 ms bound. Still red, and the
 * reason is the one that matters: a bound does not remove the dependency, it
 * *times* it. "The shell mounted" became "the shell mounted within 250 ms of
 * load", and every future reader of that DOM would have inherited the race.
 *
 * **The renderer's first paint must not depend on main at all.** A blank window
 * is the least diagnosable failure this application can have, and it is what a
 * missing preload or a wedged main would produce. Weighing a theme flash against
 * *nothing at all* is not a close call; the first version weighed it against
 * nothing, because the hang had not occurred to me.
 *
 * So this is fired and not awaited. The cost is real and small: a launch paints
 * in the default theme and corrects when the answer lands, which is one IPC
 * round trip — sub-millisecond in the working case, and applied by a **layout**
 * effect in `App`, so the correction happens before the next paint rather than
 * after it.
 *
 * ## A failure hydrates NOTHING rather than throwing
 *
 * `settings.load` declares no failure codes: a first launch, a missing file and
 * a corrupt one all answer with an empty object, because none of them is
 * something a user can act on and all of them mean *use the defaults*. What is
 * left is the boundary itself failing, which is a defect in this build — and the
 * right response is still the defaults.
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
