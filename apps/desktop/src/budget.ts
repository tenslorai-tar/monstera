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

/** How a host call's deadline is worked out: a floor, plus an allowance per MiB of the documents open. */
export interface HostCallDeadlinePolicy {
  readonly floorMs: number;
  readonly msPerMiB: number;
}

/**
 * How long one engine-host call may go unanswered before its host is treated as wedged, killed and rebuilt
 * (ADR-0023 §3, corrected 2026-10-03). Scaled by the documents open when the call is sent, because those bound the
 * input any one call is given: a fixed figure long enough for the largest document would leave a wedged host holding
 * every small one for as long.
 *
 * Measured 2026-10-03 on Windows 11 (4 logical processors), on a real contained host and through the kernel calls
 * the hosts make. The slowest legitimate call was a Word export of the 200 MiB scan fixture: 167 s and 275 s in two
 * runs, 1.38 s per MiB at the slower. Then a Word export of the 200 MiB picture fixture, 26 to 57 s; saving 10,000
 * pages, 5.1 to 6.9 s; recognising one page of the scan, 2.0 s. So 5 s per MiB is 3.6 times the slowest rate, and
 * the floor is 60 times the slowest call on a small document. A 10 MB document's deadline is about 3 minutes; at the
 * open-document ceiling (1.42 GiB) it is about 2 hours, where a legitimate Word export may take about 35 minutes.
 */
export const HOST_CALL_DEADLINE: HostCallDeadlinePolicy = { floorMs: 120_000, msPerMiB: 5_000 };
