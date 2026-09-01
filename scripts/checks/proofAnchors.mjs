// @ts-check
/**
 * Reports any proof that declares no case count, and any allowlist entry that
 * has since gained one.
 *
 * See `scripts/lib/proofAnchors.mjs` for why this exists — finding YYYYY-1, in
 * which a proof went from 29 cases to 26 and reported success on both matrix
 * legs, because the total was derived from the cases that ran.
 *
 * Usage: node scripts/checks/proofAnchors.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { classifyProofs, UNANCHORED } from '../lib/proofAnchors.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const DIRECTORY = join(ROOT, 'scripts', 'proofs');

try {
  const proofs = readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.proof.mjs'))
    .map((name) => ({ name, source: readFileSync(join(DIRECTORY, name), 'utf8') }));

  const { missing, stale, gone, anchored } = classifyProofs(proofs);

  process.stdout.write(
    `\n  ok  ${String(anchored)} of ${String(proofs.length)} proof(s) declare a case count\n`,
  );

  if (stale.length > 0) {
    process.stderr.write(
      `\n${String(stale.length)} allowlist entry(ies) have GAINED an anchor and must leave the ` +
        `list:\n\n  - ${stale.join('\n  - ')}\n\n  A list that keeps entries after they are paid ` +
        `stops being a debt and becomes furniture: the next reader cannot tell a stale entry\n  ` +
        `from a real one, and the count stops meaning anything.\n`,
    );
    process.exitCode = 1;
  }

  if (gone.length > 0) {
    process.stderr.write(
      `\n${String(gone.length)} allowlist entry(ies) name a proof that no longer exists:\n\n` +
        `  - ${gone.join('\n  - ')}\n\n  The walk above only sees the proofs that are there, so ` +
        `an entry for a deleted one is\n  reported by nothing and keeps being counted. That is ` +
        `the same furniture a paid entry\n  becomes, in the direction a scan over the present ` +
        `set cannot look.\n`,
    );
    process.exitCode = 1;
  }

  if (missing.length > 0) {
    process.stderr.write(
      `\n${String(missing.length)} proof(s) declare no case count:\n\n  - ${missing.join('\n  - ')}\n\n` +
        `  A total printed from the cases that RAN agrees with any collection, including one\n` +
        `  that has quietly shrunk — which is how finding YYYYY-1 hid. Take a roster:\n\n` +
        `      const roster = createRoster(failures, { cases: N });\n\n` +
        `  and book a case that could not run on this runner with\n` +
        `  \`roster.record(mark, label, false)\`, so the number is the same everywhere.\n`,
    );
    process.exitCode = 1;
  }

  if (missing.length === 0 && stale.length === 0 && gone.length === 0) {
    process.stdout.write(
      `  --  ${String(UNANCHORED.length)} proof(s) owe one and are named in the allowlist\n\n`,
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
