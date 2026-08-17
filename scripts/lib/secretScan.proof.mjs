// @ts-check
/**
 * Proof that the secret scan cannot be silently disarmed (rule B2).
 *
 * Each closure gets a PAIR of cases, and neither half counts alone:
 *
 *   - a structural case asserting the code passes the flag. Delete the flag from
 *     scanArgs and this goes red.
 *   - a control case running the same corpus WITHOUT that flag and confirming
 *     the secret escapes. This is what stops the structural case degenerating
 *     into "the string is still in the array" long after the flag stopped
 *     mattering.
 *
 * The corpus is the canary's own, imported rather than reconstructed, so a
 * family added there is covered here on the next run without anyone remembering.
 * It is written to a throwaway repository under the OS temp directory — never
 * into this tree, where a credential-shaped string would be one `git add -A`
 * from a permanent public commit.
 *
 * Usage: node scripts/lib/secretScan.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ALLOW_COMMENTED_FILE,
  attributeFindings,
  buildCorpus,
  divergenceNotice,
  HOSTILE_CONFIG,
  verifyScannerCapability,
} from './scannerCanary.mjs';
import {
  CONFIG_FILE,
  configPathFor,
  scanArgs,
  unsanctionedSuppressions,
} from './secretScan.mjs';
import { GITLEAKS_VERSION, resolveGitleaks } from '../provision/gitleaks.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} detail
 */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * Scans a prepared corpus with an explicit argument list.
 *
 * @param {{ binary: string, corpus: string, args: readonly string[], env?: NodeJS.ProcessEnv }} options
 * @returns {Record<string, string[]>}
 */
function scanCorpus({ binary, corpus, args, env }) {
  const result = spawnSync(
    binary,
    ['git', '--staged', '--no-banner', '--exit-code', '1', '--report-format', 'json',
      '--report-path', '-', ...args],
    { cwd: corpus, env: env ?? process.env, encoding: 'utf8' },
  );
  return attributeFindings(`${result.stdout ?? ''}`).found;
}

/** @param {Record<string, string[]>} found @returns {string[]} */
function familiesDetected(found) {
  return Object.entries(found)
    .filter(([, rules]) => rules.length > 0)
    .map(([key]) => key);
}

async function main() {
  const binary = await resolveGitleaks();
  if (binary === null) {
    process.stderr.write(
      'No gitleaks available. Run: node scripts/provision/gitleaks.mjs\n' +
        'This proof cannot be skipped quietly — a proof that reports success without a scanner ' +
        'is the failure it exists to catch.\n',
    );
    return 1;
  }

  const realConfig = configPathFor();

  // -------------------------------------------------------------------------
  // Structural half: the code passes the flags.
  // -------------------------------------------------------------------------
  const staged = scanArgs({ staged: true });
  const history = scanArgs({ staged: false });

  check(
    'scanArgs passes --ignore-gitleaks-allow in both scopes',
    staged.includes('--ignore-gitleaks-allow') && history.includes('--ignore-gitleaks-allow'),
    `staged=[${staged.join(' ')}]\n      history=[${history.join(' ')}]`,
  );
  check(
    'scanArgs passes --config pointing at the tracked configuration',
    staged[staged.indexOf('--config') + 1] === realConfig &&
      history[history.indexOf('--config') + 1] === realConfig,
    `expected ${realConfig}`,
  );
  check(
    'scanArgs passes --redact in both scopes, so a finding never reprints the secret',
    staged.includes('--redact') && history.includes('--redact'),
    'a finding printed in full copies the credential into scrollback and CI logs (L12)',
  );
  check(
    'scanArgs never passes --baseline-path',
    !staged.includes('--baseline-path') && !history.includes('--baseline-path'),
    'a baseline suppresses every finding it lists, invisibly at the call site',
  );

  // -------------------------------------------------------------------------
  // Control half: without each flag, the corpus escapes.
  // -------------------------------------------------------------------------
  const corpus = mkdtempSync(join(tmpdir(), 'monstera-scanproof-'));
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-scanproof-cfg-'));
  try {
    const families = buildCorpus(corpus);
    const allKeys = families.map((family) => family.key).sort();

    // Baseline: the real argument list finds everything, through a hostile
    // environment. If this fails, nothing below means anything.
    const baseline = scanCorpus({
      binary,
      corpus,
      args: ['--config', realConfig, '--ignore-gitleaks-allow'],
      env: { ...process.env, GITLEAKS_CONFIG_TOML: HOSTILE_CONFIG },
    });
    check(
      'baseline: the shipped argument list detects every family',
      familiesDetected(baseline).sort().join(',') === allKeys.join(','),
      `detected [${familiesDetected(baseline).join(', ')}] of [${allKeys.join(', ')}]`,
    );

    // Control 1 — drop --ignore-gitleaks-allow.
    const noAllowFlag = scanCorpus({
      binary,
      corpus,
      args: ['--config', realConfig],
    });
    const allowFamily = families.find((family) => family.file === ALLOW_COMMENTED_FILE);
    check(
      'CONTROL: without --ignore-gitleaks-allow, one comment hides the secret',
      allowFamily !== undefined && (noAllowFlag[allowFamily.key] ?? []).length === 0,
      `${ALLOW_COMMENTED_FILE} was still detected without the flag, so the flag is not what ` +
        `closes this channel and the structural case above proves nothing.`,
    );
    check(
      'CONTROL: dropping that flag hides ONLY the commented file',
      familiesDetected(noAllowFlag).length === allKeys.length - 1,
      `detected [${familiesDetected(noAllowFlag).join(', ')}] — the control should differ from ` +
        `the baseline by exactly one family, or it is measuring something else.`,
    );

    // Control 2 — drop --config while the environment offers a permissive one.
    const noConfig = scanCorpus({
      binary,
      corpus,
      args: ['--ignore-gitleaks-allow'],
      env: { ...process.env, GITLEAKS_CONFIG_TOML: HOSTILE_CONFIG },
    });
    check(
      'CONTROL: without --config, GITLEAKS_CONFIG_TOML disarms the whole scan',
      familiesDetected(noConfig).length === 0,
      `detected [${familiesDetected(noConfig).join(', ')}] — expected none. --config is what ` +
        `outranks the environment; if it is not, the closure is somewhere else.`,
    );

    // Control 3 — a config without [extend] useDefault = true.
    const replacingConfig = join(scratch, 'replacing.toml');
    writeFileSync(
      replacingConfig,
      'title = "no extend"\n\n[[rules]]\nid = "monstera-anthropic-api-key"\n' +
        'description = "Anthropic API key"\n' +
        "regex = '''\\bsk-ant-(?:admin|api)[0-9]{2}-[A-Za-z0-9_-]{32,}'''\n" +
        'keywords = ["sk-ant-"]\n',
      'utf8',
    );
    const withoutExtend = scanCorpus({
      binary,
      corpus,
      args: ['--config', replacingConfig, '--ignore-gitleaks-allow'],
    });
    check(
      'CONTROL: a config without [extend] silently drops every built-in rule',
      familiesDetected(withoutExtend).join(',') === 'ai-provider-anthropic',
      `detected [${familiesDetected(withoutExtend).join(', ')}] — expected only the one custom ` +
        `rule. This case is why the canary asserts rule IDs: this scan still exits 1.`,
    );
    check(
      'the shipped configuration does carry [extend] useDefault = true',
      /^\s*useDefault\s*=\s*true\s*$/m.test(readFileSync(realConfig, 'utf8')),
      `${CONFIG_FILE} must extend the default ruleset, or the control above becomes the ` +
        `shipped behaviour — a scan that exits 1 on one custom rule while every built-in rule ` +
        `is switched off.`,
    );

    // -----------------------------------------------------------------------
    // The .gitleaksignore channel: closed by refusing to scan, since no flag
    // closes it.
    // -----------------------------------------------------------------------
    const clean = unsanctionedSuppressions({ root: corpus, configPath: realConfig });
    check(
      'a corpus with no suppression artefacts is allowed to scan',
      clean.length === 0,
      `refused with: ${clean.join(' / ')} — a precondition that always refuses would make ` +
        `every case below vacuous.`,
    );

    const ignorePath = join(corpus, '.gitleaksignore');
    writeFileSync(ignorePath, 'placeholder:rule:1\n', 'utf8');
    const withUntracked = unsanctionedSuppressions({ root: corpus, configPath: realConfig });
    check(
      'an UNTRACKED .gitleaksignore is refused',
      withUntracked.length > 0,
      'the file suppresses findings while gitignored, so no check on tracked content can see it',
    );

    spawnSync('git', ['add', '-A'], { cwd: corpus });
    const withTracked = unsanctionedSuppressions({ root: corpus, configPath: realConfig });
    check(
      'a TRACKED .gitleaksignore is refused',
      withTracked.length > 0,
      'a tracked fingerprint file suppresses findings for everyone who clones the repository',
    );

    // Control: gitleaks really does honour it, so refusing is not superstition.
    const suppressed = scanCorpus({
      binary,
      corpus,
      args: ['--config', realConfig, '--ignore-gitleaks-allow'],
    });
    const fingerprints = Object.entries(suppressed)
      .filter(([, rules]) => rules.length > 0)
      .map(([key]) => key);
    writeFileSync(
      ignorePath,
      families
        .filter((family) => fingerprints.includes(family.key))
        .map((family) => `${family.file}:${family.rule}:1`)
        .join('\n') + '\n',
      'utf8',
    );
    spawnSync('git', ['add', '-A'], { cwd: corpus });
    const afterIgnore = scanCorpus({
      binary,
      corpus,
      args: ['--config', realConfig, '--ignore-gitleaks-allow',
        '--gitleaks-ignore-path', scratch],
    });
    check(
      'CONTROL: .gitleaksignore suppresses findings even with -i pointed elsewhere',
      familiesDetected(afterIgnore).length < familiesDetected(baseline).length,
      `detected [${familiesDetected(afterIgnore).join(', ')}] — if -i had closed the channel ` +
        `this would match the baseline, and refusing to scan would be unnecessary.`,
    );

    rmSync(ignorePath, { force: true });
    spawnSync('git', ['add', '-A'], { cwd: corpus });

    // -----------------------------------------------------------------------
    // A missing configuration must refuse, not fall back.
    // -----------------------------------------------------------------------
    const missingConfig = unsanctionedSuppressions({
      root: corpus,
      configPath: join(scratch, 'absent.toml'),
    });
    check(
      'a missing configuration is refused rather than scanned without one',
      missingConfig.length > 0,
      'falling back to the default ruleset would drop the custom rules and reopen channel 3',
    );
  } finally {
    rmSync(corpus, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  // The canary itself, and its reporting.
  // -------------------------------------------------------------------------
  const canary = verifyScannerCapability({ binary, pinnedVersion: GITLEAKS_VERSION, force: true });
  check(
    'the resolved scanner passes the capability canary',
    canary.ok,
    canary.problems.join('\n      '),
  );

  check(
    'divergence is silent for the pinned version',
    divergenceNotice(canary, GITLEAKS_VERSION) === '',
    'a notice printed on every commit is a notice nobody reads',
  );
  check(
    'divergence is REPORTED for any other version',
    divergenceNotice(canary, '0.0.0-not-this-one') !== '',
    'this is the resolution test for the reporting itself: if it cannot distinguish the pinned ' +
      'version from another, silent divergence stays silent.',
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nSecret-scan proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        `\n\n`,
    );
    return 1;
  }

  for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
  process.stdout.write(`\n${passed.length} secret-scan cases passed.\n`);
  return 0;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
