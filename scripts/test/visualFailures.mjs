// @ts-check
/**
 * What a rendered run keeps of a failing case, and where — ONE place, because two readers need it and one of them is a
 * workflow file that cannot import anything. Two runs keep their failures: the visual comparison and the accessibility
 * gate, which runs every `*.pw.ts` case ({@link KEPT_RUNS}).
 *
 * ## Why a failure keeps anything
 *
 * A case that fails once in sixty runs is decided by what the page was doing at that moment, and the runner's log carries
 * only the assertion. Measured: main's run 39408814593 (755ec950, 2026-10-20) waited 5 s for the Watermark dialog
 * after a fast first three seconds, and the `error-context.md` Playwright wrote — the page as it was — was left on a
 * runner nobody can read, so which link of the dialog's chain stalled could not be established. A trace kept ON FAILURE
 * records each action's DOM, network and console; passing cases discard theirs. It is recorded on CI only
 * ({@link failureTrace}).
 *
 * The accessibility gate had the same hole until 2026-10-31: run 41212601632 (acd10faa) failed
 * `editTextLeaving.pw.ts:218` once on Windows, its log named an `error-context.md` under `test-results`, and the job
 * uploaded nothing, so which of two mechanisms held the refusal's sentence could not be read.
 *
 * ## Two readers, one value
 *
 * Each run's config writes to its directory, and its job in `.github/workflows/ci.yml` uploads from there on failure.
 * The workflow cannot import this module, so its paths are copies, and `proof:visualfailures` fails when they differ —
 * the shape the renderer's CSP takes (copy only where the reader cannot reach the source). Dependency-free, so that
 * proof runs on the job that installs nothing.
 */

/** Where a visual case's output lands, from the repository's root: its `error-context.md` and, on CI, its trace. */
export const VISUAL_OUTPUT_DIR = 'test-results/visual';
/** Where an accessibility-gate case's output lands, the same two files. */
export const ACCESSIBILITY_OUTPUT_DIR = 'test-results/accessibility';

/**
 * @typedef {{ readonly job: string, readonly run: string, readonly dir: string, readonly artifact: string, readonly config: string }} KeptRun
 * `job` is the job's key in `ci.yml`; `run` the npm script its step runs, which the upload must follow; `dir` where the
 * config writes; `artifact` the upload's name; `config` the Playwright config, from `scripts/test/`.
 */

/** @type {readonly KeptRun[]} */
export const KEPT_RUNS = [
  { job: 'visual', run: 'test:visual', dir: VISUAL_OUTPUT_DIR, artifact: 'visual-failures', config: 'visual.config.mjs' },
  // THE BUILD JOB RUNS ON TWO LEGS, and two uploads of one name in one run collide: its name carries the leg.
  { job: 'build', run: 'test:a11y', dir: ACCESSIBILITY_OUTPUT_DIR, artifact: 'accessibility-failures-${{ matrix.os }}', config: 'playwright.config.mjs' },
];

/**
 * Whether this process runs on a GitHub Actions runner: the runner's own `GITHUB_ACTIONS`, which it sets to `true` on
 * every step. Not `CI`, which other tools set on a developer's machine too.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function onGithubActions(env) {
  return env['GITHUB_ACTIONS'] === 'true';
}

/**
 * Playwright's trace mode for a run that keeps its failures. ON CI, recorded for every case and kept only for one that
 * fails, which the job uploads. LOCALLY, off: recording cost the visual file 196 s → 231 s at 2 workers (measured
 * 2026-10-20), and `editTextLeaving.pw.ts` 104 s and 112 s → 155 s and 147 s at 4 workers, runs alternated (measured
 * 2026-10-31 on the owner's machine, `--workers=4`, all 22 passing), on the owner's machine while it is blocked by the
 * run, and a local failure is read where it happened. What it costs the accessibility gate ON CI is read from that
 * step's own duration, whose spread before tracing was 948–1213 s on windows-latest and 867–1234 s on ubuntu-latest
 * (runs 41207675823, 41212601632, 41212728867).
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {'retain-on-failure' | 'off'}
 */
export function failureTrace(env) {
  return onGithubActions(env) ? 'retain-on-failure' : 'off';
}
