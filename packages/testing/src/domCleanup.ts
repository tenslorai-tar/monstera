/**
 * Unmounts every React tree a test rendered, after that test, everywhere.
 *
 * Registered as vitest's one `setupFiles` entry, so it runs before every test
 * file in the repository and no file has to remember it.
 *
 * ## Why this is not left to the library's own auto-cleanup
 *
 * `@testing-library/react` registers `afterEach(cleanup)` itself — but only if
 * `afterEach` is a global, which under vitest means `test.globals: true`. This
 * repository runs with globals off and every test imports `describe`/`it`/
 * `expect` by name, so the library's registration silently does not happen.
 * That failure is quiet in the worst way: renders accumulate in `document.body`
 * across a file, and the symptom is not an error but a later query that finds
 * an earlier test's node. A passing assertion about the wrong element is
 * exactly the shape checklist item 4b exists for.
 *
 * The alternative — turning globals on — was rejected. It changes what every
 * existing test inherits from its runner, which is the *rich ambient
 * environment* axis the checklist names, for a benefit this file delivers with
 * no change to any test that does not render.
 *
 * ## The DOM check is what makes this safe to apply globally
 *
 * `@testing-library/dom` builds `screen` from `document.body` at import time,
 * so importing it in a node-environment test file would throw. Kernel,
 * contract and shared tests have no DOM by design — `packages/kernel` having
 * no Electron and no DOM is what makes the document pipeline testable in
 * milliseconds — so this file must be inert there rather than merely harmless.
 * The `typeof document` test decides that, and the import sits behind it.
 *
 * A DOM is present only in a file whose leading docblock names happy-dom as its
 * vitest environment. `scripts/lib/domEnvironment.mjs` is what keeps that
 * docblock inside `packages/ui`, and the marker is described here rather than
 * written out because that scan cannot tell a prose mention from a directive —
 * spelling it in this comment made this file its first report.
 */

import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
