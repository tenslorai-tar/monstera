// @ts-check
/**
 * What counts as plain-Node code in this repository, in one place.
 *
 * Two mechanisms keep `scripts/` from reaching Electron's lazy download, and
 * they cover different node types: `no-restricted-imports` owns the four static
 * shapes, `scriptsLoadingAtRuntime` owns `import()` and the `require` family.
 * **Their coverage differs by design; their SCOPE must not.**
 *
 * It did. Both globbed `.mjs`, independently, so a `.js` or `.cjs` under
 * `scripts/` was invisible to both at once — each reporting the reassuring
 * answer, neither able to say it had not looked. That is the classifier's ROOT
 * axis (X-1) and its PATTERN axis (W-1) arriving together in two files that had
 * no idea they were agreeing.
 *
 * So the list lives here and both import it. This module deliberately has no
 * dependencies: `eslint.config.js` loads it, and so does
 * `scripts/provision/electron.mjs`, which must stay runnable during
 * provisioning — before `node_modules` exists.
 *
 * @module
 */

/**
 * Extensions under `scripts/` that hold code Node will execute.
 *
 * Adding one here widens the lint rule and the runtime scan in the same edit,
 * which is the entire reason this is not two lists.
 */
export const PLAIN_NODE_EXTENSIONS = ['mjs', 'js', 'cjs'];

/**
 * Extensions under `scripts/` that are data, not code.
 *
 * Explicit rather than "everything else": the scan REFUSES an extension in
 * neither list. A `.ts` or `.mts` landing under `scripts/` is a decision
 * someone has to make, and silently sorting it into the safe pile is how a
 * search comes to report an absence it caused.
 */
export const SCAN_DATA_EXTENSIONS = ['json'];

/** The ESLint glob those code extensions make. */
export const PLAIN_NODE_GLOB = `scripts/**/*.{${PLAIN_NODE_EXTENSIONS.join(',')}}`;
