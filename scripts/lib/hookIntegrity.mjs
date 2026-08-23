// @ts-check
/**
 * Detects settings that disarm the project's PreToolUse hooks.
 *
 * This is the `.gitleaksignore` shape again, and it was found by asking the same
 * question of a different guard: is there a purely local file, in nobody's diff,
 * that switches this off?
 *
 * There is. Claude Code reads settings from several scopes, and two of them are
 * outside the repository or outside git: `.claude/settings.local.json` at the
 * repository root, which is personal and gitignored, and `~/.claude/settings.json`
 * in the user's home. Either can carry a `hooks` block or `disableAllHooks`.
 *
 * ## What is established, and what is not
 *
 * **Not established:** whether a `hooks` block in a higher-precedence scope
 * REPLACES the project's or MERGES with it. The published documentation
 * contradicts itself on exactly this point — its precedence table lists Local
 * ABOVE Project, while its prose asserts "the project hook persists because
 * project settings have higher precedence than local settings", which is the
 * reverse of its own table. Settling it requires a session restart, so it is
 * recorded as unverified rather than assumed either way.
 *
 * **Established and unambiguous:** `disableAllHooks` exists and turns hooks off.
 *
 * So this check is deliberately conservative. It refuses on the unambiguous
 * disarm, and on the ambiguous one — a competing `hooks` block in a
 * higher-precedence scope — because under the reading the precedence table
 * supports, that silently replaces the project's. Being wrong in that direction
 * costs a contributor one explanation. Being wrong in the other direction is a
 * seventh occurrence with the guard reported as installed.
 *
 * ## Why the check lives on the git hook rather than in the Claude Code hook
 *
 * A hook cannot detect its own absence. If hooks are disabled, the PreToolUse
 * guard does not run, so it cannot report that it did not run. The git pre-commit
 * hook is a different mechanism entirely — invoked by git, not by Claude Code —
 * so it still runs when Claude Code's hooks are off, which is exactly when this
 * needs to be said.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { claimedHooks, registeredHooks } from './registeredHooks.mjs';

/**
 * Settings scopes that can override the tracked project file, with where each
 * lives and how a contributor is expected to fix it.
 *
 * @param {string} root
 * @returns {Array<{ label: string, path: string, tracked: boolean }>}
 */
function higherPrecedenceScopes(root) {
  return [
    {
      label: 'the repository-local settings file',
      path: join(root, '.claude', 'settings.local.json'),
      tracked: false,
    },
    {
      label: 'your user settings file',
      path: join(homedir(), '.claude', 'settings.json'),
      tracked: false,
    },
  ];
}

/**
 * Reasons the project's PreToolUse hooks may not be in force.
 *
 * @param {{ root?: string, scopes?: Array<{ label: string, path: string, tracked: boolean }> }} [options]
 * @returns {string[]}
 */
export function hookDisarmament(options = {}) {
  const root = options.root ?? repoRoot();
  const scopes = options.scopes ?? higherPrecedenceScopes(root);

  /** @type {string[]} */
  const problems = [];

  const projectPath = join(root, '.claude', 'settings.json');
  if (!existsSync(projectPath)) {
    problems.push(
      `${projectPath} is missing. The escape-resolving-write guard is registered there, and ` +
        `without it nothing stops a shell command from writing a file through a path that ` +
        `resolves escape sequences — the class this repository has hit six times.`,
    );
  } else {
    /** @type {{ hooks?: { PreToolUse?: unknown[] }, disableAllHooks?: unknown }} */
    let project;
    try {
      project = JSON.parse(readFileSync(projectPath, 'utf8'));
    } catch (error) {
      problems.push(`${projectPath} is not valid JSON (${String(error)}), so no hook it declares loads.`);
      project = {};
    }
    if (project.disableAllHooks === true) {
      problems.push(`${projectPath} sets disableAllHooks, which turns off the guard it registers.`);
    }
    // EVERY HOOK THE REPOSITORY CLAIMS MUST BE REGISTERED, and this replaced a
    // literal demanding a non-empty PreToolUse array (finding AAAA-15). The
    // literal was scoped to one event and named one script in prose, so a second
    // hook could be unregistered — along with its probe entry, whose requirement
    // is derived from this very file — and every check stayed green while two
    // documents went on asserting it was in force.
    //
    // The claim is the anchor because it is the thing a reader acts on, and
    // because it lives in a file the person removing a hook has to edit
    // separately. The anchor's EVENT is enforced by the resolver rather than
    // here: one place holds that literal now.
    /** @type {readonly { script: string, name: string, documents: string[] }[]} */
    let claimed = [];
    try {
      claimed = claimedHooks(root);
    } catch (error) {
      problems.push(
        `The hook claims in the project's documents could not be read (${String(error)}), so this ` +
          `cannot tell a hook that was removed from one that was never claimed.`,
      );
    }

    /** @type {readonly import('./registeredHooks.mjs').RegisteredHook[]} */
    let registered = [];
    try {
      registered = registeredHooks(root);
    } catch (error) {
      problems.push(String(error));
    }

    for (const claim of claimed) {
      if (registered.some((hook) => hook.script === claim.script)) continue;
      problems.push(
        `${claim.documents.join(' and ')} name${claim.documents.length === 1 ? 's' : ''} ` +
          `${claim.script} as a registered hook, and ${projectPath} does not register it. A ` +
          `document that claims a mechanism nobody wired up is worse than no document, because ` +
          `the claim is what a reader trusts. Register it, or remove the claim in this commit.`,
      );
    }
  }

  for (const scope of scopes) {
    if (!existsSync(scope.path)) continue;

    /** @type {{ hooks?: Record<string, unknown>, disableAllHooks?: unknown }} */
    let settings;
    try {
      settings = JSON.parse(readFileSync(scope.path, 'utf8'));
    } catch {
      // An unreadable file at a higher-precedence scope is not evidence of
      // disarmament, and refusing on it would block commits for an unrelated
      // typo in a personal file.
      continue;
    }

    if (settings.disableAllHooks === true) {
      problems.push(
        `${scope.path} sets "disableAllHooks": true — ${scope.label}, which is not in any diff. ` +
          `Remove that key. Turning the project's guards off for yourself alone is the shape of ` +
          `defect this repository closed for .gitleaksignore in Batch 3.`,
      );
    }

    if (settings.hooks !== undefined && settings.hooks !== null) {
      problems.push(
        `${scope.path} declares its own "hooks" block — ${scope.label}, at a scope the published ` +
          `precedence table places ABOVE the project's. Whether that REPLACES the project's hooks ` +
          `or merges with them is not established: the documentation contradicts itself, its ` +
          `table putting local above project and its prose claiming the reverse. Until that is ` +
          `settled by execution, a competing hooks block is treated as disarming, because the ` +
          `cost of being wrong the other way is a guard reported as installed while it is not.`,
      );
    }
  }

  return problems;
}

/**
 * @param {readonly string[]} problems
 * @returns {string}
 */
export function formatDisarmament(problems) {
  return (
    `\nCommit blocked — the project's tool-use guards may not be in force:\n\n` +
    problems.map((problem) => `  - ${problem}`).join('\n\n') +
    `\n\nThis is checked by the GIT hook, not by the Claude Code hook, because a hook cannot ` +
    `detect its own absence: if hooks are disabled, the guard does not run and so cannot report ` +
    `that it did not run.\n\n`
  );
}
