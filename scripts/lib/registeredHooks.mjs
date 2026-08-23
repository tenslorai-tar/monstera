// @ts-check
/**
 * The one answer to "which hooks does this repository register?" (rule B3a).
 *
 * ## Why this exists as a module rather than a list
 *
 * `docs/hook-probe.json` carries one entry per mechanism, and the set of
 * entries that must exist is **derived from the settings file** rather than
 * maintained beside it. A hand-kept roster is the second wiring place: register
 * a third hook, forget the roster, and the new hook silently inherits the
 * coverage the second one earned — which is finding AAAA-13's shape exactly,
 * one level up from the prose it was found in.
 *
 * Every consumer therefore asks here. The settings file is the authority on
 * what is registered; this implements its answer once.
 *
 * ## The positive control, and why it is inside the resolver
 *
 * This is a SEARCH, and a search has one output for every way it can be broken:
 * an empty list. A renamed key, a settings file that moved, a command shape
 * this stops recognising — all of them report "no hooks registered", which is
 * the reassuring answer, and the check downstream then requires nothing of
 * anybody.
 *
 * So {@link registeredHooks} refuses to return unless it has located
 * {@link ANCHOR_SCRIPT}, which is registered and must stay registered: the
 * escape-resolving-write guard is the mechanism `CLAUDE.md` calls a Stage 0
 * exit gate. Losing it is a Rule 0 event, and this throwing is the right noise
 * for that. The control is here rather than only in the proof because the proof
 * runs in CI and this gets run by hand on the day someone needs an answer.
 *
 * ## The root, which is the axis a classifier fix usually stops short of
 *
 * A classifier has three axes that fail independently — what it matches, where
 * it looks, and which states it understands — and this project has paid for the
 * ROOT one before, when the audit-scope report's pattern was corrected and its
 * directory was not. So: this reads ONE file, and hooks can be registered in
 * more than one.
 *
 * `.claude/settings.local.json` sits beside the tracked settings, is not tracked
 * itself, and its hooks are as in force as any. A hook registered there is a
 * mechanism running with no entry that could ever vouch for it, which is
 * precisely the state this record exists to make impossible — so
 * {@link locallyRegisteredHooks} names them and the document check refuses.
 * Reporting beats a wider roster: an untracked hook cannot have a tracked
 * certificate, so pretending it is covered would be the false green.
 *
 * What stays out of reach and is therefore a **declared scope, not a check**:
 * the user-level `~/.claude/settings.json` and any enterprise policy layer.
 * Those are the developer's, not the repository's, and a check that fired on
 * every contributor's personal configuration is one that gets switched off. The
 * roster is therefore *what this repository registers*, which is not the same
 * claim as *what is in force on this machine*.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Repo-relative path of the file that registers the hooks. */
export const SETTINGS_FILE = '.claude/settings.json';

/**
 * Its untracked sibling. Read only to REPORT what it registers — see the
 * header. Nothing in it can ever earn an entry, because an entry is a tracked
 * claim about a file nobody else has.
 */
export const LOCAL_SETTINGS_FILE = '.claude/settings.local.json';

/**
 * A script this resolver must find on every run, or it has not looked.
 *
 * Not a roster — one anchor. See the header for why an absence here is a
 * throw rather than a shorter list.
 */
export const ANCHOR_SCRIPT = 'scripts/hooks/blockEscapeResolvingWrites.mjs';

/**
 * The event the anchor must be registered on.
 *
 * Load-bearing rather than descriptive: the escape guard can only refuse a
 * command BEFORE it runs, so the same script wired to `PostToolUse` would
 * report on writes it had already permitted. This is the one place that literal
 * lives — `hookIntegrity.mjs` used to carry its own, which is the second
 * opinion B3a is about.
 */
export const ANCHOR_EVENT = 'PreToolUse';

/**
 * Documents whose prose is a CLAIM that a hook is registered.
 *
 * These are the two live specifications a reader acts on. Naming a hook script
 * by its full path in either of them is an assertion that it is wired up, and
 * {@link claimedHooks} is what makes the assertion true rather than decorative.
 */
export const CLAIM_DOCUMENTS = ['docs/FEATURES.md', 'CLAUDE.md'];

/**
 * The repository script a hook command runs.
 *
 * The commands are of the form `node "${CLAUDE_PROJECT_DIR}/scripts/hooks/x.mjs"`.
 * Matching the repo-relative tail rather than the whole string keeps this
 * indifferent to how the project directory is spelt, which is the part that
 * varies between platforms.
 */
const SCRIPT_IN_COMMAND = /(scripts\/[\w./-]+\.mjs)/u;

/**
 * @typedef {{
 *   name: string,
 *   event: string,
 *   matcher: string,
 *   script: string,
 *   command: string,
 * }} RegisteredHook
 */

/**
 * Every hook `.claude/settings.json` registers, in a stable order.
 *
 * @param {string} [root]
 * @returns {readonly RegisteredHook[]}
 */
export function registeredHooks(root = repoRoot()) {
  const path = join(root, SETTINGS_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `${SETTINGS_FILE} does not exist under ${root}. Nothing can be registered, so returning an ` +
        `empty list would report the absence this resolver was asked to measure as a clean result.`,
    );
  }

  const found = parseHooks(path, SETTINGS_FILE);

  if (!found.some((hook) => hook.script === ANCHOR_SCRIPT && hook.event === ANCHOR_EVENT)) {
    throw new Error(
      `The hook resolver did not find ${ANCHOR_SCRIPT} registered on ${ANCHOR_EVENT} in ` +
        `${SETTINGS_FILE}, so it cannot distinguish "nothing else is registered" from "this ` +
        `stopped being able to see".\n\n` +
        `If the escape-resolving-write guard was genuinely unregistered, or moved off ` +
        `${ANCHOR_EVENT} where it can no longer refuse anything before it runs, that is a Rule 0 ` +
        `event and this noise is correct: CLAUDE.md calls it a Stage 0 exit gate. Otherwise the ` +
        `parse above is broken and every check that consumes this list is currently requiring ` +
        `nothing.`,
    );
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Hooks registered by the untracked local settings file, if it exists.
 *
 * `present` is separate from an empty list on purpose: "there is no local
 * settings file" and "there is one and it registers nothing" are different
 * facts, and collapsing them would put the reassuring answer on both.
 *
 * There is no anchor control here, and none is possible — a local file has no
 * hook that must be in it. What stands in for one is that this shares
 * {@link parseHooks} with {@link registeredHooks}, which asserts its anchor on
 * every call in the same process. A parser that had stopped seeing would have
 * thrown before this ran.
 *
 * @param {string} [root]
 * @returns {{ present: boolean, hooks: readonly RegisteredHook[] }}
 */
export function locallyRegisteredHooks(root = repoRoot()) {
  const path = join(root, LOCAL_SETTINGS_FILE);
  if (!existsSync(path)) return { present: false, hooks: [] };
  return {
    present: true,
    hooks: parseHooks(path, LOCAL_SETTINGS_FILE).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Hook scripts this repository's live specifications CLAIM are registered.
 *
 * ## Why the claim is the anchor, and not another literal
 *
 * The roster of hooks owing evidence is derived from the settings file, which is
 * right and has one blind spot: **a requirement derived from a set cannot notice
 * that set shrinking.** Unregister a hook and delete its entry in one commit and
 * every check goes green, while two documents go on asserting the hook is in
 * force. That is finding AAAA-16, and the remedy for the whole class is an
 * anchor the shrinker has to touch SEPARATELY.
 *
 * The documents are that anchor, and they are the right one rather than a
 * convenient one: a `docs/FEATURES.md` row is a live specification of what is
 * owed, and `CLAUDE.md` is what an agent reads before acting. If either says a
 * hook is registered, that had better be true — so removing a hook now means
 * removing the claim in the same commit, which is the shape this project uses
 * everywhere else.
 *
 * ## The discriminator, and the disposition that comes with it
 *
 * A full path (`scripts/hooks/x.mjs`) is the claim; a bare basename is not.
 * `scripts/hooks/` also holds git-hook scripts and their proofs — `guardFiles`,
 * `preCommit`, `prePush`, `documentConsistency` — which are not tool-use hooks
 * and must never be registered. Measured 2026-08-24: the two documents name
 * exactly the two Claude hooks by full path and refer to every git-hook script
 * by basename, so this codifies how they are already written rather than
 * imposing a new rule.
 *
 * **The false positive that stays**, written down so nobody relitigates it:
 * spelling a git-hook script's full path in either document will demand its
 * registration. The fix is to write the basename, which is what the surrounding
 * prose already does. `.proof.mjs` files are excluded outright, since a proof is
 * never a hook.
 *
 * @param {string} [root]
 * @returns {readonly { script: string, name: string, documents: string[] }[]}
 */
export function claimedHooks(root = repoRoot()) {
  /** @type {Map<string, string[]>} */
  const claims = new Map();
  for (const document of CLAIM_DOCUMENTS) {
    const path = join(root, document);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/scripts\/hooks\/[\w.-]+\.mjs/gu)) {
      const script = match[0];
      if (script.endsWith('.proof.mjs')) continue;
      const seen = claims.get(script) ?? [];
      if (!seen.includes(document)) seen.push(document);
      claims.set(script, seen);
    }
  }

  // The positive control. This is a search over prose, and every way of breaking
  // one — a renamed document, a path spelt differently, a pattern that stopped
  // matching — reports the same empty set, after which the requirement below
  // demands nothing of anybody.
  if (!claims.has(ANCHOR_SCRIPT)) {
    throw new Error(
      `No document in ${CLAIM_DOCUMENTS.join(' or ')} names ${ANCHOR_SCRIPT} by its full path, ` +
        `so this scan cannot distinguish "nothing is claimed" from "this stopped being able to ` +
        `read". The escape guard is described at length in CLAUDE.md; if that description no ` +
        `longer spells the path, restore it — the claim is what makes unregistering the hook a ` +
        `red build.`,
    );
  }

  return [...claims.entries()]
    .map(([script, documents]) => ({ script, name: mechanismName(script), documents }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} path Absolute path to a settings file.
 * @param {string} label Repo-relative name, for the failure message.
 * @returns {RegisteredHook[]}
 */
function parseHooks(path, label) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${label} is not readable JSON: ${String(cause)}`, { cause });
  }

  /** @type {RegisteredHook[]} */
  const found = [];
  const hooks = /** @type {Record<string, unknown>} */ (parsed)?.['hooks'];
  for (const [event, groups] of Object.entries(/** @type {Record<string, unknown>} */ (hooks) ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const matcher = typeof group?.matcher === 'string' ? group.matcher : '*';
      const entries = Array.isArray(group?.hooks) ? group.hooks : [];
      for (const entry of entries) {
        const command = typeof entry?.command === 'string' ? entry.command : '';
        const script = SCRIPT_IN_COMMAND.exec(command)?.[1];
        if (script === undefined) continue;
        found.push({ name: mechanismName(script), event, matcher, script, command });
      }
    }
  }
  return found;
}

/**
 * The key a mechanism is recorded under.
 *
 * Derived from the script's own filename so that nobody chooses it, and so a
 * renamed hook reads as a new mechanism with no evidence rather than as the old
 * one with somebody else's certificate.
 *
 * @param {string} script
 * @returns {string}
 */
export function mechanismName(script) {
  const base = script.slice(script.lastIndexOf('/') + 1);
  return base.endsWith('.mjs') ? base.slice(0, -'.mjs'.length) : base;
}
