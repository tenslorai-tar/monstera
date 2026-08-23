// @ts-check
/**
 * Proof that a locally disarmed tool-use guard is detected (rule B2).
 *
 * The escape-resolving-write hook was shipped and reported as installed. That
 * report is only true while the hook is actually registered, and Claude Code
 * reads settings from scopes outside git: `.claude/settings.local.json`, which
 * is personal and gitignored, and `~/.claude/settings.json`. Either can carry
 * `disableAllHooks` or a competing `hooks` block, and neither appears in a diff.
 *
 * That is the `.gitleaksignore` shape exactly — a purely local file that turns a
 * guard off with nothing to see in review — and it is closed the same way: the
 * git pre-commit hook refuses, because a hook cannot detect its own absence.
 *
 * Usage: node scripts/lib/hookIntegrity.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { hookDisarmament } from './hookIntegrity.mjs';
import { ANCHOR_EVENT, ANCHOR_SCRIPT } from './registeredHooks.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

const workspace = mkdtempSync(join(tmpdir(), 'monstera-hookint-'));

/**
 * A repository whose tracked settings register the guard properly AND whose
 * documents claim it.
 *
 * Both halves are load-bearing now, and the fixture said neither. It registered
 * `node guard.mjs` — a command naming no repository script — and carried no
 * documents at all, which was harmless while the check only counted entries in a
 * `PreToolUse` array. The moment the requirement became *what the documents
 * claim must be registered*, the fixture was modelling a repository that cannot
 * exist, and four cases went red for the fixture rather than for the code.
 *
 * @param {{ registerAnchor?: boolean, anchorEvent?: string, claim?: boolean }} [shape]
 * @returns {string}
 */
function makeRoot(shape = {}) {
  const { registerAnchor = true, anchorEvent = ANCHOR_EVENT, claim = true } = shape;
  const root = mkdtempSync(join(workspace, 'root-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: registerAnchor
        ? {
            [anchorEvent]: [
              {
                matcher: 'Bash|PowerShell',
                hooks: [{ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${ANCHOR_SCRIPT}"` }],
              },
            ],
          }
        : {},
    }),
    'utf8',
  );
  writeFileSync(
    join(root, 'CLAUDE.md'),
    claim ? `The guard is \`${ANCHOR_SCRIPT}\`, registered as a PreToolUse hook.\n` : 'No hooks here.\n',
    'utf8',
  );
  writeFileSync(join(root, 'docs', 'FEATURES.md'), '| row | status |\n', 'utf8');
  return root;
}

/** @param {string} root @param {string} name @param {unknown} body */
function writeScope(root, name, body) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(body), 'utf8');
  return { label: 'a higher-precedence scope', path, tracked: false };
}

try {
  // -------------------------------------------------------------------------
  // The quiet case. If this fails, every refusal below is meaningless.
  // -------------------------------------------------------------------------
  {
    const root = makeRoot();
    check(
      'CONTROL: a repository with the guard registered and no local override is clean',
      hookDisarmament({ root, scopes: [] }).length === 0,
      `reported: ${hookDisarmament({ root, scopes: [] }).join(' / ')}\n      A check that ` +
        `refuses unconditionally blocks every commit and gets removed within the day.`,
    );
  }

  // -------------------------------------------------------------------------
  // disableAllHooks — the unambiguous disarm.
  // -------------------------------------------------------------------------
  {
    const root = makeRoot();
    const scope = writeScope(root, 'local.json', { disableAllHooks: true });
    const problems = hookDisarmament({ root, scopes: [scope] });
    check(
      'a local settings file setting disableAllHooks is refused',
      problems.some((problem) => problem.includes('disableAllHooks')),
      `reported: ${problems.join(' / ') || 'nothing'}`,
    );
    check(
      '  ...and the message names the file, so the fix is obvious',
      problems.some((problem) => problem.includes('local.json')),
      `reported: ${problems.join(' / ') || 'nothing'}`,
    );
  }

  // -------------------------------------------------------------------------
  // A competing hooks block — the ambiguous one, treated as disarming.
  // -------------------------------------------------------------------------
  {
    const root = makeRoot();
    const scope = writeScope(root, 'local.json', { hooks: { PreToolUse: [] } });
    check(
      'a local settings file declaring its own hooks block is refused',
      hookDisarmament({ root, scopes: [scope] }).length > 0,
      'the published precedence table puts local ABOVE project, so under that reading an empty ' +
        'PreToolUse array replaces the guard entirely. The documentation contradicts itself on ' +
        'this point, and until it is settled by execution the conservative reading is the one ' +
        'whose failure costs an explanation rather than a seventh occurrence.',
    );
  }

  {
    const root = makeRoot();
    const scope = writeScope(root, 'local.json', { permissions: { allow: ['Bash(npm test)'] } });
    check(
      'CONTROL: a local settings file with unrelated keys is NOT refused',
      hookDisarmament({ root, scopes: [scope] }).length === 0,
      `reported: ${hookDisarmament({ root, scopes: [scope] }).join(' / ')}\n      Contributors ` +
        `keep personal settings; blocking on the file's mere existence would make the check the ` +
        `problem and guarantee it gets deleted.`,
    );
  }

  {
    const root = makeRoot();
    const scope = writeScope(root, 'local.json', { disableAllHooks: false });
    check(
      'CONTROL: disableAllHooks explicitly false is not treated as a disarm',
      hookDisarmament({ root, scopes: [scope] }).length === 0,
      'testing for the key rather than its value would fire on a file that turns nothing off',
    );
  }

  // -------------------------------------------------------------------------
  // The project side: the guard has to actually be registered.
  // -------------------------------------------------------------------------
  {
    const root = mkdtempSync(join(workspace, 'bare-'));
    check(
      'a repository with no .claude/settings.json is refused',
      hookDisarmament({ root, scopes: [] }).length > 0,
      'deleting the tracked settings file removes the guard as completely as disabling it',
    );
  }

  // -------------------------------------------------------------------------
  // THE CLAIM IS THE ANCHOR (finding AAAA-16). The requirement used to be a
  // literal — a non-empty PreToolUse array, one script named in prose — which
  // was scoped to one event and could not speak about any other hook. What
  // replaced it is derived from what the repository CLAIMS, so a hook cannot be
  // removed without opening a second file.
  // -------------------------------------------------------------------------
  {
    const root = makeRoot();
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [] } }), 'utf8');
    const problems = hookDisarmament({ root, scopes: [] });
    check(
      'a project settings file registering NO PreToolUse hook is refused',
      problems.length > 0,
      'emptying the array is the quiet way to remove a hook while leaving the file in place',
    );
    check(
      '  ...and the refusal names the CLAIM, so the fix is to register or retract',
      problems.some((problem) => problem.includes(ANCHOR_SCRIPT)),
      `reported: ${problems.join(' / ') || 'nothing'}`,
    );
  }

  {
    // A SECOND hook, claimed and unregistered. This is the case the old literal
    // could not express at all: it asked only whether the PreToolUse array was
    // non-empty, which stays true when a different hook is removed.
    const root = makeRoot();
    writeFileSync(
      join(root, 'docs', 'FEATURES.md'),
      `| the reporter is \`scripts/hooks/reportControlCharacters.mjs\` | done |\n`,
      'utf8',
    );
    const problems = hookDisarmament({ root, scopes: [] });
    check(
      'a SECOND hook claimed by a document and not registered is refused',
      problems.some((problem) => problem.includes('reportControlCharacters')),
      `reported: ${problems.join(' / ') || 'nothing'}\n      Deleting a hook and its probe entry ` +
        `together leaves every settings-derived requirement satisfied. The document is the one ` +
        `thing that still disagrees.`,
    );
    check(
      '  ...and the anchor, which IS registered, is not reported alongside it',
      !problems.some((problem) => problem.includes(ANCHOR_SCRIPT)),
      `reported: ${problems.join(' / ')}\n      A check that names every claim whenever any one ` +
        `is broken cannot be acted on.`,
    );
  }

  {
    // The anchor moved off PreToolUse. Same script, still registered, still
    // claimed — and unable to refuse anything, because a PostToolUse hook runs
    // after the command. The event literal lives in the resolver now, which is
    // what makes this reachable from here at all.
    const root = makeRoot({ anchorEvent: 'PostToolUse' });
    check(
      'the guard registered on the WRONG EVENT is refused, not counted as present',
      hookDisarmament({ root, scopes: [] }).some((problem) => problem.includes('PreToolUse')),
      `reported: ${hookDisarmament({ root, scopes: [] }).join(' / ') || 'nothing'}\n      A ` +
        `PostToolUse escape guard reports on writes it has already permitted.`,
    );
  }

  {
    const root = makeRoot();
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ disableAllHooks: true, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }),
      'utf8',
    );
    check(
      'a project settings file that registers a hook AND disables all hooks is refused',
      hookDisarmament({ root, scopes: [] }).some((problem) => problem.includes('disableAllHooks')),
      'the two keys together read as installed while behaving as absent',
    );
  }

  {
    const root = makeRoot();
    writeFileSync(join(root, '.claude', 'settings.json'), '{ not json', 'utf8');
    check(
      'an unparseable project settings file is refused',
      hookDisarmament({ root, scopes: [] }).length > 0,
      'a settings file the harness cannot parse registers nothing, and looks fine in a diff',
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nHook-integrity proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} hook-integrity cases passed.\n`);
