/**
 * How many document-scaled bytes `main` may hold, derived from ADR-0007.
 *
 * ## Derived, and the derivation is the part that is stated
 *
 * `docs/ARCHITECTURE.md` §9.17 carries one machine-read line —
 * `main = 1.5x, 1.5 GB, base 96 MB` — and `scripts/lib/memoryBudgets.mjs` is its
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
export const MAIN_DOCUMENT_BYTES_CEILING = 1_610_612_736 - 100_663_296;
