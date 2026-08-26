/**
 * How many document-scaled bytes `main` may hold, derived from ADR-0007.
 *
 * ## Derived, and the derivation is the part that is stated
 *
 * `docs/ARCHITECTURE.md` §9.17 carries one machine-read line —
 * `main = 1.5x, 1.5 GB, base 80 MB` — and `scripts/lib/memoryBudgets.mjs` is its
 * only reader. Neither the kernel nor this package can reach that module: it is
 * plain Node under `scripts/`, and the boundary is deliberate. So the number
 * below is written here and **`proof:composition` recomputes it from the
 * invariant and fails when the two differ** — the same direction the CSP takes,
 * with the document as writer of record and the code derived from it.
 *
 * The rule is `absolute cap − declared baseline`. The cap bounds the whole
 * process; the baseline is the fixed cost that is not the document's — the
 * runtime, the process itself — so what is left is what documents may occupy.
 *
 * ## One stated limit, because this number is smaller than it looks
 *
 * **No transient working set is reserved.** A save that builds a second image
 * needs room for it, and at exactly this ceiling there is none — `perf:gate`
 * measures `main` at 1.00× of file size holding one image and 2.00× holding
 * two, and the second breaches the multiplier. So this bounds what is
 * *retained*, not what a retained document costs to operate on, and the second
 * question is unmeasured.
 *
 * Stated rather than fixed by inventing a headroom fraction. A number chosen to
 * feel safe is the thing ADR-0007 exists to refuse.
 */
export const MAIN_DOCUMENT_BYTES_CEILING = 1_610_612_736 - 83_886_080;

/**
 * The engine host job's `ProcessMemoryLimit`, from the same line and by a
 * different rule (ADR-0023 §2).
 *
 * §9.17 declares `mupdf-host = 6x, 3 GB, base 128 MB`, and this is the **whole
 * absolute cap with nothing subtracted** — the opposite arithmetic to main's
 * ceiling above, from the same two terms, which is why the difference is stated
 * rather than left for a reader to infer from two similar-looking constants.
 *
 * `MAIN_DOCUMENT_BYTES_CEILING` bounds *document bytes*, so the baseline — the
 * runtime and the process itself — is subtracted to leave what documents may
 * occupy. A job's `ProcessMemoryLimit` bounds the **process commit**: the
 * runtime, the statically linked engine and the document, all of it. Subtracting
 * the baseline there would enforce a limit 128 MB tighter than the one §9.17
 * declares, and the host would die inside its own budget.
 *
 * **Undefaulted at the call site, which is the part ADR-0023 §2 insists on.**
 * The factory takes the limit as a required argument and this is what the shell
 * passes; a default in the factory is how a number nobody chose becomes the
 * number in force, and a `0` there means *no limit* to Win32 rather than an
 * obviously missing value.
 *
 * §9.17 is the writer of record and `proof:composition` recomputes both
 * constants from it, in the same direction and for the same reason.
 */
export const ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES = 3_221_225_472;
