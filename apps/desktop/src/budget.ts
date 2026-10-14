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

/**
 * The compose host's V8 heap limit, in MiB: a gibibyte under its job limit, so V8 collects before the job object ends it.
 *
 * **Measured 2026-10-13.** The Electron binary in Node mode (43.7.7, Linux) reports a default heap limit of 4,192 MiB
 * (`v8.getHeapStatistics().heap_size_limit`), above the job limit, so garbage a composition left could carry the process
 * past 3 GiB while V8 saw no reason to collect it. `scripts/research/csvParts.mjs` composing a 12 MiB CSV in 1 MiB parts
 * peaked (`ru_maxrss`) at 2,601 MiB uncapped and 2,069 MiB under this limit; at 1,536 MiB, 1,137. The gibibyte left is for
 * what lives outside the heap (fonts, buffers). The heaviest one-part composition on record, four mebibytes of Markdown at
 * 1,742 MiB resident (`MAX_MARKDOWN_BYTES`, 2026-09-13), is under it, so no composition that ran before is refused by it.
 *
 * **NOT SHOWN TO BOUND A FILE IN PARTS, and the readings say why** (same script and date, under this limit). A second
 * 12 MiB run peaked at 2,190 MiB: resident memory climbed over the first five parts to about 2,170 and stayed there for the
 * last eight, with `external` (buffers outside the heap) level at about 900 MiB. A 24 MiB file in 25 parts peaked at 2,680
 * MiB, all of it before the join (the join added nothing). So the peak still grew with the file between 12 and 24 MiB, and
 * 24 MiB left about 390 MiB under the job limit; past that a CSV may end the host, which answers as the host's failure.
 * Measuring it in the installed app on Windows is owed.
 *
 * **The `external` level was HarfBuzz, and it is gone** (same script, 2026-10-14, Linux, plain Node with its default heap
 * limit, so no cap helped). A shaping buffer per call was freed only by a finalizer, which never ran inside a
 * synchronous part (`textShaping.ts`); one buffer per face now. 12 MiB peaked at 1,283 MiB and 24 MiB at 1,414, with
 * `external` at 105 to 173 MiB across every part, against 2,190 and 2,680 before. Resident memory still steps up by about
 * 11 MiB a part past the twelfth, which this script's own list of finished parts accounts for (about 0.8 MiB each held
 * for the join) only in part; the installed app on Windows is still where this is owed.
 */
export const COMPOSE_HOST_HEAP_LIMIT_MIB = 2048;

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

/** How a host's memory is watched below the job's limit: how often, and how far below it the kill comes. */
export interface HostMemorySampling {
  readonly intervalMs: number;
  readonly headroomBytes: number;
}

/**
 * ADR-0023 §3's primary, corrected 2026-10-03: a sampler on its own thread kills a host whose private commit reaches
 * `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES` less this headroom, which stays the hard limit as the backstop. A kill AT
 * the limit could never come first, since the allocation that crosses it fails inside the engine.
 *
 * Measured 2026-10-03 on Windows 11 (4 logical processors), a sampler on its own thread every 10 ms through opening,
 * saving and a Word export of the 200 MiB fixtures: the largest rise in private commit was 234 MiB within 100 ms and
 * 321 MiB within 250 ms (its longest gap between samples, under load, 533 ms). 512 MiB is 1.6 times the 250 ms rise,
 * sampled every 100 ms.
 */
export const HOST_MEMORY_SAMPLING: HostMemorySampling = { intervalMs: 100, headroomBytes: 536_870_912 };
