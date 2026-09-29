// @ts-check
/**
 * Removes a workspace's build output.
 *
 * ## Why this file exists instead of one line of `node -e`
 *
 * All six workspaces carried
 * `node -e "require('node:fs').rmSync('dist',{recursive:true,force:true})"`.
 * That is the exact invocation CLAUDE.md's standing rule bans and
 * `scripts/hooks/blockEscapeResolvingWrites.mjs` denies — and npm hid it: the
 * hook sees `npm run clean`, never the `node -e` inside it, so the repository
 * shipped six working copies of the banned form in a channel the guard cannot
 * reach.
 *
 * These particular commands delete rather than write, so nothing was ever
 * corrupted by them. The reason to remove them anyway is precedent: a rule with
 * six sanctioned-looking counter-examples inside the repository is one the next
 * person cites rather than follows. `scripts/hooks/guardFiles.mjs` now rejects
 * the form in any tracked package.json script, which is what closes the channel;
 * this file is what the six were replaced with.
 *
 * Refuses anything outside the calling workspace, because a clean script that
 * can be pointed at an arbitrary path is a delete primitive. The stage audit
 * records a proof that deleted the whole `.tools` root and took a 69 MB
 * in-flight download with it.
 *
 * Usage:
 *   node ../../scripts/clean.mjs dist
 */

import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const targets = process.argv.slice(2);
if (targets.length === 0) {
  process.stderr.write('usage: node scripts/clean.mjs <directory> [...]\n');
  process.exit(1);
}

const cwd = process.cwd();
for (const target of targets) {
  if (isAbsolute(target)) {
    process.stderr.write(`refusing an absolute path: ${target}\n`);
    process.exit(1);
  }

  const path = resolve(cwd, target);
  const inside = relative(cwd, path);
  if (inside === '' || inside.startsWith('..')) {
    process.stderr.write(
      `refusing ${target}: it resolves outside ${cwd}. A clean script that can be aimed anywhere ` +
        `is a delete primitive.\n`,
    );
    process.exit(1);
  }

  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

// THE BUILD INFO GOES WITH THE OUTPUT. `tsconfig.tsbuildinfo` is TypeScript's record of what the workspace's `dist/`
// holds, and `tsc --build` trusts it: measured 2026-09-29, `npm run clean --workspaces` then `npm run build` emitted
// nothing for the referenced projects — the record said they were current — and the desktop package failed with 638
// errors, every one "cannot find module '@monstera/…'". A clean that removes the output and keeps the record is a clean
// the next build does not notice.
rmSync(resolve(cwd, 'tsconfig.tsbuildinfo'), { force: true });
