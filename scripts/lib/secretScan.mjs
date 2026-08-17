// @ts-check
/**
 * The one place that decides HOW the secret scanner is invoked.
 *
 * The pre-commit hook and the full-history CI scan built their argument lists
 * separately, which is how the two came to differ. They are the same decision
 * about the same tool, so they are made once, here.
 *
 * ## The suppression channels, and what closes each
 *
 * gitleaks offers four ways to make a finding disappear. Three of them leave no
 * trace at the call site, and all four were reproduced against the pinned 8.30.1
 * binary before anything below was written.
 *
 * 1. **An inline `gitleaks:allow` comment.** One comment on the offending line.
 *    Measured: a repo holding one Slack token exits 0 with the comment, and 1
 *    with `--ignore-gitleaks-allow`. CLOSED by passing that flag on every scan.
 *
 * 2. **A `.gitleaksignore` fingerprint file.** No flag closes this one, which is
 *    why it is handled by refusing to scan rather than by an argument:
 *      - `--gitleaks-ignore-path` ADDS a location, it does not replace one. A
 *        repo with its own `.gitleaksignore` still exits 0 when `-i` points
 *        somewhere else entirely.
 *      - the file works while UNTRACKED AND GITIGNORED, so no check on staged or
 *        tracked content can see it.
 *      - it is read from the scan target's root as well as the working
 *        directory, so relocating the scan does not escape it.
 *    CLOSED by `unsanctionedSuppressions`, which refuses to scan while one
 *    exists. Fail-closed is the only correct direction: the alternative is a
 *    scan that reports success having been told what not to look at.
 *
 * 3. **Configuration supplied out of band.** `GITLEAKS_CONFIG`,
 *    `GITLEAKS_CONFIG_TOML`, or an untracked `.gitleaks.toml` at the root. Each
 *    measured to take a repo from exit 1 to exit 0. CLOSED by passing `--config`
 *    explicitly, which is gitleaks' highest-precedence source — measured to beat
 *    all three, and to fail rather than fall back when the file is missing.
 *
 *    The environment variables are deliberately NOT also scrubbed. `--config`
 *    already beats them by measurement, so a scrub would be a second closure
 *    whose control case could never go red — a guard that cannot fail is the
 *    green check this project bans, not extra safety.
 *
 * 4. **A baseline file.** `--baseline-path` suppresses everything it lists. We
 *    never pass it, and a baseline file merely PRESENT in the repository was
 *    measured not to be picked up implicitly, so there is nothing to close.
 *
 * What remains is one sanctioned channel: an `[allowlist]` entry in the tracked
 * `.gitleaks.toml`, which arrives in a diff and gets reviewed like any other
 * change.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { filesInCommit, repoRoot } from './gitScope.mjs';

/** The one configuration, tracked, passed explicitly on every scan. */
export const CONFIG_FILE = '.gitleaks.toml';

/** The fingerprint file no gitleaks flag can neutralise. */
const IGNORE_FILE = '.gitleaksignore';

/**
 * The tracked configuration, as an absolute path.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function configPathFor(root = repoRoot()) {
  return join(root, CONFIG_FILE);
}

/**
 * Reasons the scan would run in a suppressed state, and so must not run at all.
 *
 * Both scopes are checked because the file is effective in both: on disk it
 * works untracked, and tracked it would arrive on every contributor's machine.
 *
 * `configPath` is separate from `root` so the canary can point the real
 * configuration at a corpus outside this repository — which is the whole reason
 * the corpus can live outside it.
 *
 * @param {{ root?: string, configPath?: string }} [options]
 * @returns {string[]}
 */
export function unsanctionedSuppressions(options = {}) {
  const root = options.root ?? repoRoot();
  const configPath = options.configPath ?? configPathFor(root);
  /** @type {string[]} */
  const problems = [];

  if (existsSync(join(root, IGNORE_FILE))) {
    problems.push(
      `${IGNORE_FILE} exists at the repository root. gitleaks reads it unconditionally — ` +
        `--gitleaks-ignore-path adds a second location rather than replacing this one, so no ` +
        `flag can neutralise it and the scan below would silently skip every fingerprint it ` +
        `lists. Delete it. A genuine false positive belongs in ${CONFIG_FILE} as an allowlist ` +
        `entry, in its own commit, where it appears in a diff.`,
    );
  }

  for (const path of filesInCommit({ cwd: root })) {
    if (basename(path) !== IGNORE_FILE) continue;
    problems.push(
      `${path} is tracked or staged. A fingerprint file suppresses findings for everyone who ` +
        `clones the repository, and it never appears in the scan's output — the finding simply ` +
        `stops existing. Use an allowlist entry in ${CONFIG_FILE} instead.`,
    );
  }

  if (!existsSync(configPath)) {
    problems.push(
      `${configPath} is missing. Every scan passes it with --config, which is what stops an ` +
        `untracked config or a GITLEAKS_CONFIG environment variable from replacing the ruleset. ` +
        `Restore it rather than dropping the flag.`,
    );
  }

  return problems;
}

/**
 * The argument list, identical for both scopes but for `--staged`.
 *
 * @param {{ staged: boolean, root?: string, configPath?: string }} options
 * @returns {string[]}
 */
export function scanArgs({ staged, root = repoRoot(), configPath }) {
  return [
    'git',
    ...(staged ? ['--staged'] : []),
    // Highest-precedence configuration source. See channel 3 above.
    '--config',
    configPath ?? configPathFor(root),
    // Channel 1. Without this, one comment on one line disarms the check for
    // that line, in both the hook and the CI mirror.
    '--ignore-gitleaks-allow',
    // Findings print with the secret redacted, so a terminal scrollback or a CI
    // log never becomes a second copy of the credential just caught (L12).
    '--redact',
    '--no-banner',
    '--exit-code',
    '1',
  ];
}

/**
 * Runs the scan, refusing outright if it would run suppressed.
 *
 * @param {{
 *   binary: string,
 *   staged: boolean,
 *   root?: string,
 *   configPath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   captureOutput?: boolean,
 *   extraArgs?: readonly string[],
 * }} options
 * @returns {{ status: number, blocked: string[], stdout: string }}
 *   `blocked` is non-empty when the scan did not run because it would have been
 *   suppressed. `status` is then non-zero: a scan that could not run honestly is
 *   a failure, never a pass.
 */
export function runSecretScan({
  binary,
  staged,
  root = repoRoot(),
  configPath,
  env,
  captureOutput = false,
  extraArgs = [],
}) {
  const resolvedConfig = configPath ?? configPathFor(root);
  const blocked = unsanctionedSuppressions({ root, configPath: resolvedConfig });
  if (blocked.length > 0) return { status: 1, blocked, stdout: '' };

  const scan = spawnSync(binary, [...scanArgs({ staged, root, configPath: resolvedConfig }), ...extraArgs], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (scan.error !== undefined) {
    process.stderr.write(`\nCould not run gitleaks (${binary}): ${scan.error.message}\n`);
    return { status: 1, blocked: [], stdout: '' };
  }

  return { status: scan.status ?? 1, blocked: [], stdout: `${scan.stdout ?? ''}` };
}

/**
 * @param {readonly string[]} problems
 * @returns {string}
 */
export function formatSuppressions(problems) {
  return (
    `\nThe secret scan did not run — it would have run in a suppressed state:\n\n` +
    problems.map((problem) => `  - ${problem}`).join('\n\n') +
    `\n\nA scan that has been told what to overlook reports success for the credential it was ` +
    `told to overlook. Refusing to run is the honest outcome.\n\n`
  );
}
