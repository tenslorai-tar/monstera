import type { ShellComposition } from './composition.js';
import { createRecentFiles } from './recentFiles.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * The surfaces a harness composes the shell with, in one place.
 *
 * ## THIS OBJECT EXISTS SO THAT ADDING A DEPENDENCY IS NOT AN EDIT TO AN OBSERVER
 *
 * `apps/desktop/src/pickerProbe.ts` is **digested by `docs/picker-probe.json`**
 * — the record of a person opening Electron's real file dialog, which no proof
 * can reach and which `check:docs` refuses the open row's `done` without. Its
 * bytes are the certificate, so any edit to that file expires the observation.
 *
 * Three times, a new dependency on `createShellDependencies` was exactly that
 * edit: the probe passes every surface, so a new one meant a new argument in
 * the probe, so the record died and a person had to click again. Each time the
 * thing actually being observed — `documentPicker.ts` — was byte-identical.
 * The third time it stopped a feature rather than costing a click, which is
 * what moved it from friction to a blocker.
 *
 * **The digest is not narrowed, and narrowing it would be the wrong fix.** A
 * probe that stopped driving the real dialog, or stopped reading what came
 * back, would genuinely invalidate what a person saw — that is the case the
 * digest exists for and it still fires. What changed is the *churn*: a new
 * surface is added to `ShellComposition`, to the production entry, and to this
 * object, and every harness that spreads this one is untouched.
 *
 * ## Every surface here REFUSES, and none of them answers plausibly
 *
 * A picker that returned a path would let a harness put a file on a developer's
 * disk while its run reported success — the failure that does not announce
 * itself, since the harness measures something else and passes either way. So
 * the shape is a throw carrying the harness's name, and a harness that needs a
 * surface to *work* overrides that one field by name:
 *
 * ```ts
 * createShellDependencies({
 *   ...harnessSurfaces('the canvas proof'),
 *   appInfo: { version: app.getVersion(), installChannel: 'development' },
 *   pickDocument: () => Promise.resolve(fixture),
 * });
 * ```
 *
 * The override is visible at the call site and the refusals are not, which is
 * the right way round: what a harness *does* exercise is the interesting part,
 * and what it does not is boilerplate that was being copied.
 *
 * ## The stores are EPHEMERAL, and that is not tidiness
 *
 * A harness that wrote into the real `userData` would leave the application
 * configured by having been measured — settings changed, the developer's own
 * recent list carrying fixtures, and the clean-exit marker set by a run that
 * was never a launch, which makes the next crash-recovery offer silent.
 *
 * They are **built per call**, not shared module state: two harnesses in one
 * process would otherwise see each other's writes, and a test asserting an
 * empty recent list would pass or fail on what ran before it.
 *
 * ## Why `settings` and `recent` are real objects where the pickers throw
 *
 * The renderer hydrates from `settings.load` before its first render, so that
 * surface **is** reached on every launch and a throw would make every harness
 * fail at startup for a reason unrelated to what it measures. The pickers are
 * reached only when a user asks, which in a harness is never.
 */
export function harnessSurfaces(
  harness: string,
): Omit<ShellComposition, 'appInfo'> {
  return {
    pickDocument: () => {
      throw new Error(`${harness} does not open a document, so nothing may pick one`);
    },
    pickDestination: () => {
      throw new Error(`${harness} writes no copy, so nothing may pick a destination`);
    },
    settings: createEphemeralSettings(),
    recent: createRecentFiles(createEphemeralSettings()),
    // NULL, which is the state every unit test and every non-Windows run is in:
    // no engine host platform, so a document opened here is poisoned rather
    // than left sessionless. Spelt rather than left to the optional field's
    // default, because a harness reading this object should see what it gets.
    enginePlatform: null,
  };
}
