// @ts-check
/**
 * What the visual run keeps of a failing case, and where — ONE place, because two readers need it and one of them is a
 * workflow file that cannot import anything.
 *
 * ## Why a failure keeps anything
 *
 * A case that fails once in sixty runs is decided by what the page was doing at that moment, and the runner's log carries
 * only the assertion. Measured: main's run 39408814593 (755ec950, 2026-10-20) waited 5 s for the Watermark dialog
 * after a fast first three seconds, and the `error-context.md` Playwright wrote — the page as it was — was left on a
 * runner nobody can read, so which link of the dialog's chain stalled could not be established. A trace kept ON FAILURE
 * records each action's DOM, network and console; passing cases discard theirs.
 *
 * ## Two readers, one value
 *
 * `visual.config.mjs` writes there, and the visual job in `.github/workflows/ci.yml` uploads from there on failure. The
 * workflow cannot import this module, so its path is a copy, and `proof:visualfailures` fails when the two differ —
 * the shape the renderer's CSP takes (copy only where the reader cannot reach the source). Dependency-free, so that
 * proof runs on the job that installs nothing.
 */

/** Where a visual case's output lands, from the repository's root: its `error-context.md` and, on failure, its trace. */
export const VISUAL_OUTPUT_DIR = 'test-results/visual';

/** Playwright's trace mode for the visual run: recorded for every case, kept only for one that fails. */
export const VISUAL_TRACE = 'retain-on-failure';
