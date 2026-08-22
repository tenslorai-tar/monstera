// @ts-check
/**
 * Which reachability verdicts have their symbols **derived** rather than
 * witnessed. One definition, taken by everything that needs the distinction.
 *
 * ## Why the distinction matters at all
 *
 * A derivation has a provisioning condition; a witness does not. So for a
 * derived claim, an unwitnessed symbol on a runner that cannot derive is
 * reported **unverifiable** rather than as a failure — which is correct, because
 * *could not look* is not *looked and found nothing*, and it is the register's
 * own philosophy. It also means that any check reasoning *"a witness problem is
 * a hard failure"* must first know whether the claim is derived, or it is only
 * right on machines where the derivation happens to run.
 *
 * ## Why it is a module of its own (finding ZZ-1)
 *
 * `advisoryRegister.proof.mjs` needed exactly this list and had no way to ask
 * for it, so it located "a verdict carrying a witness" and got one whose symbols
 * are derived. Three of its mutations then became unverifiable instead of
 * failing: **green on a machine with `node_modules`, red on the Guards job**,
 * which installs nothing.
 *
 * The obvious home was `engineAdvisories.mjs`, and it is the wrong one: that
 * module calls `main()` at import, so importing it for a constant would run the
 * whole advisory check — network and all — as a side effect. A shared value does
 * not belong in a module that does something when you load it.
 *
 * Two opinions about which claims are derived is what produced ZZ-1 (B3a), and
 * there is now one.
 */

/**
 * @type {readonly ['ocr', 'engine-host-containment']}
 *
 * `ocr` derives its doors from the MuPDF source (`deriveOcrDoors`);
 * `engine-host-containment` derives its Electron spawn surface from
 * `electron.d.ts` by parsing declarations (`electronSurface.mjs`). Its four
 * Win32 names are *not* derived — nothing can enumerate kernel32 entry points
 * for us — and carry witnesses instead, which is why the claim appears here and
 * still has a `witness` block.
 */
export const DERIVED_CLAIMS = ['ocr', 'engine-host-containment'];
