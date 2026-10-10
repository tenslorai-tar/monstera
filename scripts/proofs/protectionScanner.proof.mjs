// @ts-check
/** The protection fixture exception admits one public option, never credentials. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveGitleaks } from '../provision/gitleaks.mjs';
import { configPathFor } from '../lib/secretScan.mjs';

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
  assert.equal(scan(target, option, config), false, 'The public option is admitted');
  assert.equal(scan(target, 'C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA4', config), true,
    'A different value in the same field and file is still detected');
  assert.equal(scan('different.test.ts', option, config), true,
    'The same value in another file is still detected');
  const original = readFileSync(config, 'utf8');
  const marker = '# Finding: generic-api-key on passwordTerms:';
  assert.ok(original.includes(marker), 'The exact exception must exist');
  const control = join(scratch, 'control.toml');
  writeFileSync(control, original.slice(0, original.indexOf(marker)));
  assert.equal(scan(target, option, control), true,
    'Removing the exception restores the finding');
  process.stdout.write('4 protection scanner cases passed, including the removed-exception control.\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
