import type { ContractClient } from '@monstera/contract';

import { SETTINGS_PROBLEM_DIALOG_ID } from './dialogs/settingsProblem.js';
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
 * ## The result is not awaited, and the failure IS reported — since 2026-09-02
 *
 * A subscriber cannot block: it runs inside `set`, which a command calls from
 * an event handler. So the write is still fired rather than awaited, and the
 * answer is handled in a continuation.
 *
 * **This closes row 292's owed clause, and the trigger was `set` acquiring its
 * first shipped caller** — the rulers' toggle commands. Until then no write
 * could fail under a user, so there was nothing to report; the row said so.
 *
 * Reporting matters here more than it looks: the change DID take effect in
 * memory, so the ruler appears and the user has every reason to think the
 * matter is settled. What failed is only that it will not survive a restart —
 * which they meet in a later session with no way to connect it to what they
 * did. Silence puts the failure where it cannot be diagnosed.
 *
 * ## The title comes from the REGISTRY, not from the caller
 *
 * `ask` is handed the setting's own declared title, looked up by id, so the
 * dialog names the preference a user recognises rather than an id. A caller
 * passing its own wording would be a second name for one setting (B3).
 */
export function persistSettings(
  client: ContractClient,
  store: SettingsStore,
  ask: (id: string, props: unknown) => Promise<unknown>,
): () => void {
  return store.subscribe((id) => {
    if (id === '*') return;
    // CAPTURED BEFORE THE AWAIT. `store.get` would answer whatever the value is
    // when the write comes back, and a user who changed it twice would be told
    // about the wrong one.
    const title = store.definition(id)?.title;
    void client['settings.save']({ values: store.all() }).then(
      (answer) => {
        if (answer.ok || title === undefined) return;
        void ask(SETTINGS_PROBLEM_DIALOG_ID, { setting: title });
      },
      () => {
        // A REJECTION IS NOT AN ANSWER. The boundary rejects when the channel
        // itself failed — no preload, a wedged main — which is a defect in this
        // build rather than a storage problem, and the user's position is
        // identical either way: applied now, not remembered. Reporting both
        // through one dialog is honest; swallowing this one would make the
        // worst case the quiet one.
        if (title !== undefined) void ask(SETTINGS_PROBLEM_DIALOG_ID, { setting: title });
      },
    );
  });
}
