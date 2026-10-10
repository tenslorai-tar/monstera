// @ts-check
/** The protection fixture exception admits one public option, never credentials. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveGitleaks } from '../provision/gitleaks.mjs';
import { configPathFor } from '../lib/secretScan.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });
/** @param {string} label @param {boolean} condition */
function check(label, condition) {
  const mark = roster.mark();
  if (!condition) failures.push(label);
  roster.record(mark, label);
}

const binary = await resolveGitleaks();
assert.notEqual(binary, null, 'The scanner must be available');
const scratch = mkdtempSync(join(tmpdir(), 'monstera-protection-scan-'));
const target = 'packages/kernel/src/host/coreChannels.test.ts';
const option = 'encrypt=aes-256';
const config = configPathFor();

/** @param {string} path @param {string} value @param {string} rules */
function scan(path, value, rules) {
  const root = mkdtempSync(join(scratch, 'case-'));
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `const prior = { passwordTerms: '${value}' };\n`);
  const result = spawnSync(
    /** @type {string} */ (binary),
    ['dir', root, '--config', rules, '--ignore-gitleaks-allow', '--redact',
      '--no-banner', '--report-format', 'json', '--report-path', '-'],
    { encoding: 'utf8' },
  );
  assert.equal(result.error, undefined, 'The scanner must run');
  assert.ok(result.status === 0 || result.status === 1, 'The scanner must complete');
  const findings = /** @type {{ RuleID: string }[]} */ (JSON.parse(result.stdout));
  return findings.some((finding) => finding.RuleID === 'generic-api-key');
}

try {
  check('The public option is admitted', !scan(target, option, config));
  check('A different value in the same field and file is still detected',
    scan(target, 'C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA4', config));
  check('The same value in another file is still detected', scan('different.test.ts', option, config));
  const original = readFileSync(config, 'utf8');
  const marker = '# Finding: generic-api-key on passwordTerms:';
  assert.ok(original.includes(marker), 'The exact exception must exist');
  const control = join(scratch, 'control.toml');
  writeFileSync(control, original.slice(0, original.indexOf(marker)));
  check('Removing the exception restores the finding', scan(target, option, control));
  process.stdout.write(failures.length === 0 ? roster.format('protection scanner case')
    : `${failures.length} protection scanner case(s) FAILED:\n${failures.join('\n')}\n`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
