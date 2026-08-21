// @ts-check
/**
 * Prints the absolute path of Chromium's SUID sandbox helper in the provisioned
 * runtime.
 *
 * ## Why this file exists at all
 *
 * The workflow step that configures the helper had the version written into it:
 * `.tools/electron/43.4.1/chrome-sandbox`. That made **three** places naming
 * `ELECTRON_VERSION` in executable form — this module, `apps/desktop/package.json`,
 * and the YAML — of which only the first two are tied together, by
 * `proof:electronprovision`'s version-agreement case. The workflow's copy was
 * tied to nothing.
 *
 * **B3a, and it is the same ruling the launcher got**: the name is the module's
 * return value, not a string that matches it today. It did not read as that
 * ruling because it arrived in YAML rather than in JavaScript, which is worth
 * recording — a second opinion does not stop being one by changing language.
 *
 * ## It failed loudly, in the wrong language
 *
 * The step runs under `bash -euo pipefail` and `chown` on a missing path exits
 * non-zero, so a version bump would have gone red. But it would have read
 * `chown: cannot access '.tools/electron/43.4.1/chrome-sandbox'` — which says
 * *the provisioner did not produce the file*, and sends the reader to the
 * provisioner. FF-2's lesson, from this repository's own audit entry one commit
 * earlier: a failure that is impossible to miss and impossible to attribute is
 * worth little more than a silent one.
 *
 * ## Not asserted to exist
 *
 * This prints a path; it does not check for one. The caller is `chown`, which
 * fails perfectly well on a missing file and says so — adding an existence check
 * here would be a second opinion about a question the next command already
 * answers.
 *
 * Usage: node scripts/ci/sandboxHelperPath.mjs
 */

import { join } from 'node:path';

import { electronRoot } from '../provision/electron.mjs';

process.stdout.write(`${join(electronRoot(), 'chrome-sandbox')}\n`);
