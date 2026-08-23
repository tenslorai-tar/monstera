// @ts-check
/**
 * The two questions anyone asks about a reachability claim's `symbols` list, in
 * one place with two names (findings OOO-1, QQQ-3, TTT-2).
 *
 * ## Why this is a module and not two expressions
 *
 * `docs/security/engine-advisories.json` defines the shape; this owns the rule
 * for reading one field of it. B3a: many readers are fine, many opinions about
 * what the format says are not.
 *
 * The count has gone 2 → 3 → 4 and only the last step made it a module:
 *
 *   1. Two call sites in `engineAdvisories.mjs` spelt `claim.symbols ?? [name]`.
 *   2. **OOO-1's fix added a third**, spelt `claim.symbols ?? []`, written by
 *      the author who had just consolidated the other two — inside the hour. It
 *      reported a correct entry as an orphan witness on its first run.
 *   3. **QQQ-3 named both rules** as `watchedSymbols` and `declaredSymbols`,
 *      because a rule living in call sites and prose is one the next caller
 *      re-derives. That fixed the file.
 *   4. **TTT-2 found a fourth reader in a different file.**
 *      `scripts/proofs/ocrDoors.proof.mjs` reads the register's JSON directly,
 *      with its own hand-written type for the shape, and spelt the second rule
 *      inline. The paragraph explaining why *that* site wants the empty default
 *      and not the key default had been deleted from `engineAdvisories.mjs`
 *      along with the code, and never added to the file that now had it — so a
 *      reader saw the exact spelling OOO-1's defect had, with nothing saying why
 *      it was right there.
 *
 * Step 4 is why the helpers moved out of a module that cannot be imported for
 * them: `engineAdvisories.mjs` calls `main()` at module scope, so importing it
 * to reach a two-line function would run the whole register check as a side
 * effect. That is `scripts/lib/gitScope.mjs`'s situation exactly — a rule two
 * files needed and neither could reach.
 *
 * ## The two rules are not interchangeable and that is the whole point
 *
 * Keeping them as two exported names is what makes the choice a pick from a
 * list rather than a paragraph someone has to read and reject (B5 over a
 * comment). Defaulting the wrong way is silent in both directions: the empty
 * default stops watching a symbol, and the key default invents one.
 *
 * ## What no fixture reaches, found by mutating rather than by reading
 *
 * Both callers of `declaredSymbols` pass the OCR verdict, which HAS a `symbols`
 * list — so the `??` fallback fires in neither, and a mutation that changes only
 * the default left `check:advisories` and `proof:ocrdoors` both green. Mutating
 * the function to ignore the list instead reddens both, which is what proves the
 * extraction is wired; the default itself is a live branch with no case behind
 * it.
 *
 * That is the branch to build a case for if anyone adds a reachability verdict
 * with no `symbols` list, and it is not hypothetical — `watchedSymbols` exists
 * precisely because `pdf_subset_fonts` is that shape. Getting the default wrong
 * HERE is the silent direction: an absent list would read as naming nothing,
 * a derived surface would be compared against an empty set, and the comparison
 * would agree with any input at all.
 */

/**
 * The symbols a verdict WATCHES.
 *
 * A verdict may omit `symbols` entirely, in which case its own key IS the
 * symbol — `pdf_subset_fonts` is that shape. OCR is the other, where eleven
 * doors are listed because a verdict resting on the obvious one would survive a
 * feature calling any of the other ten.
 *
 * @param {string} name The verdict's own key.
 * @param {{ symbols?: string[] }} claim
 * @returns {readonly string[]}
 */
export function watchedSymbols(name, claim) {
  return claim.symbols ?? [name];
}

/**
 * The symbols a verdict's list EXPLICITLY NAMES.
 *
 * {@link watchedSymbols} answers *what does this verdict watch*, where an
 * omitted list means the verdict's own key. This answers *what did someone write
 * down*, which is what a DERIVED surface is compared against — and there the key
 * fallback would be wrong, because a verdict's key is not a symbol the engine
 * source or `electron.d.ts` can ever declare, so it would report as permanently
 * uncovered.
 *
 * @param {{ symbols?: string[] } | undefined} claim
 * @returns {readonly string[]}
 */
export function declaredSymbols(claim) {
  return claim?.symbols ?? [];
}
