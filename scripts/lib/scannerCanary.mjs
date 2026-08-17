// @ts-check
/**
 * Proves the resolved gitleaks binary can actually FIND SECRETS, before it is
 * trusted to say a commit is clean.
 *
 * The check it replaces asked the binary for its version and treated exit 0 as
 * evidence. That verifies a process starts. It says nothing about the ruleset,
 * which is the entire product — and the ruleset is exactly what varies between
 * the pinned release and the `gitleaks` a contributor's package manager put on
 * PATH. A distribution build two years old exits 0 for `version` and misses
 * whole rule families in silence.
 *
 * ## Why the corpus is generated rather than stored
 *
 * A canary is a credential shape. Writing one into this tree would put a
 * credential-shaped string in a public repository permanently, one `git add -A`
 * from a commit — and the fact that it is synthetic is not visible to anyone
 * scanning the history later. So no complete shape appears as a literal here:
 * each is assembled at runtime from a prefix and a deterministic body, and
 * written only into a throwaway repository under the OS temp directory.
 *
 * Determinism matters for the cache below, so the bodies come from SHA-256 of a
 * fixed seed rather than from a random source.
 *
 * ## Why it asserts rule IDs and not an exit code
 *
 * A single AWS-shaped canary and a `!== 0` check pass against a scanner that has
 * lost every other rule family. Worse, a config file without `[extend]
 * useDefault = true` replaces the whole default ruleset while still exiting 1 on
 * a custom rule — measured. So each shape names the rule that must fire, and a
 * binary that finds the secret under a different rule is reported as divergent
 * rather than quietly accepted.
 *
 * ## Why it runs once per binary
 *
 * A scan costs roughly half a second, and the pre-commit hook is the most
 * frequent action anyone performs here. A check that adds latency to every
 * commit is a check people route around, which is how the boundary proof came to
 * take ten minutes before it was made to take twenty-three seconds. The verdict
 * is therefore cached against the SHA-256 of the binary itself, so it runs once
 * per scanner rather than once per commit — and a different binary, including a
 * silent upgrade in place, is a different key.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { commandPath } from './commandPath.mjs';
import { repoRoot } from './gitScope.mjs';
import { digestInputs } from './verdict.mjs';
import { configPathFor, runSecretScan } from './secretScan.mjs';

/** Bump when the corpus changes, so every cached verdict is recomputed. */
const CORPUS_VERSION = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BASE64 = `${ALNUM}+/`;

/**
 * A deterministic body in the given alphabet.
 *
 * @param {string} alphabet
 * @param {number} length
 * @param {string} seed
 * @returns {string}
 */
function body(alphabet, length, seed) {
  let out = '';
  for (let round = 0; out.length < length; round += 1) {
    for (const byte of createHash('sha256').update(`monstera-canary:${seed}:${round}`).digest()) {
      if (out.length >= length) break;
      out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

/**
 * The secret families that matter to THIS project, each mapped to the rule the
 * pinned scanner must fire.
 *
 * Every `rule` below was measured against 8.30.1 rather than read from
 * documentation, and one of those measurements corrected a canary rather than
 * the scanner: an AWS key body containing `0` never matched, because a real
 * access key ID is base32 and `0` is not in that alphabet. The scanner was
 * right. Asserting it without checking would have produced a permanently red
 * canary blamed on the binary.
 *
 * @typedef {{ key: string, rule: string, why: string, file: string, build: () => string }} Family
 * @type {readonly Family[]}
 */
const FAMILIES = [
  {
    key: 'code-signing-key',
    rule: 'private-key',
    why: 'the packaging signing key — the highest-consequence secret this project will hold',
    file: 'deploy/signing.txt',
    build: () =>
      ['-----BEGIN RSA PRIVATE', 'KEY-----']
        .join(' ')
        .concat('\n', body(BASE64, 64, 'signing-a'), '\n', body(BASE64, 64, 'signing-b'), '\n')
        .concat(['-----END RSA PRIVATE', 'KEY-----'].join(' '), '\n'),
  },
  {
    key: 'ci-token',
    rule: 'github-pat',
    why: 'a token with write access to this repository',
    file: 'ci/deploy.ts',
    build: () => `const token = "ghp_${body(ALNUM, 36, 'ci-token')}";\n`,
  },
  {
    key: 'cloud-object-store',
    rule: 'aws-access-token',
    why: 'Stage 9 cloud providers; an object-store key reaches user documents',
    file: 'src/providers/objectStore.ts',
    build: () => `const accessKeyId = "AKIA${body(BASE32, 16, 'object-store')}";\n`,
  },
  {
    key: 'cloud-connection-string',
    rule: 'generic-api-key',
    why: 'the entropy engine, which is what catches shapes no rule anticipates',
    file: 'src/providers/blobStore.ts',
    build: () =>
      'const connection = "DefaultEndpointsProtocol=https;AccountName=monstera;' +
      `AccountKey=${body(BASE64, 86, 'blob-store')}==;";\n`,
  },
  {
    key: 'ai-provider-anthropic',
    rule: 'monstera-anthropic-api-key',
    why: 'Stage 9 AI providers; the default ruleset misses this shape entirely',
    file: 'src/ai/anthropic.ts',
    build: () => `const apiKey = "sk-ant-api03-${body(ALNUM, 48, 'anthropic')}";\n`,
  },
  {
    key: 'ai-provider-openai',
    rule: 'monstera-openai-scoped-key',
    why: 'Stage 9 AI providers; also invisible to the default ruleset',
    file: 'src/ai/openai.ts',
    build: () => `const apiKey = "sk-proj-${body(ALNUM, 40, 'openai')}";\n`,
  },
];

/**
 * The family whose file also carries an inline allow comment.
 *
 * It must still be found. That is the permanent control for
 * `--ignore-gitleaks-allow`: delete the flag from scanArgs and this canary goes
 * red, which is the only thing that stops the flag being dropped as noise.
 */
const ALLOW_COMMENT_FAMILY = 'ci-token';

/** An allow-everything config, handed to the child through the environment. */
const HOSTILE_CONFIG =
  'title = "hostile"\n[allowlist]\ndescription = "all"\nregexes = [".*"]\npaths = [".*"]\n';

/** @param {string} path @returns {string} */
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Whether a reported version string is the pinned one.
 *
 * Derived from both arguments at the point of use rather than read from a field
 * computed earlier. The earlier form made `pinnedVersion` decorative in the two
 * reporting functions — they took the parameter and decided from a stale
 * boolean — so passing a deliberately different version produced no notice. The
 * proof's resolution case is what surfaced it: an instrument that reports the
 * same answer for two inputs it exists to distinguish is measuring neither.
 *
 * @param {string} reported
 * @param {string} pinnedVersion
 * @returns {boolean}
 */
function isPinned(reported, pinnedVersion) {
  return reported !== '' && reported.includes(pinnedVersion);
}

/**
 * Everything this verdict's truth rests on, besides the scanner binary itself.
 *
 * Declared rather than hand-hashed, through scripts/lib/verdict.mjs. The first
 * version of this cache key covered the binary alone and the stage audit caught
 * it: the canary scans with .gitleaks.toml, so deleting `[extend] useDefault =
 * true` changes what the scanner finds while the binary stays byte-identical,
 * and the stale "ok" would have been reused on every commit.
 *
 * @param {string} binaryPath
 * @returns {import('./verdict.mjs').Input[]}
 */
function verdictInputs(binaryPath) {
  return [
    { file: binaryPath, why: 'a different scanner is a different ruleset' },
    { file: configPathFor(), why: 'the configuration decides which rules run at all' },
    {
      literal: 'corpus',
      value: `${CORPUS_VERSION}\0${ALLOW_COMMENT_FAMILY}\0${FAMILIES.map(
        (family) => `${family.key}:${family.rule}:${family.build()}`,
      ).join('\0')}`,
      why: 'adding a family or changing an expected rule ID must re-measure',
    },
  ];
}

/** @param {string} binaryHash @returns {string} */
function cachePath(binaryHash) {
  // A sibling of .tools/gitleaks, not a child. gitleaks.proof.mjs cold-starts by
  // deleting its own subtree, and a cache living inside it would be collateral —
  // the same mistake that once deleted a 69 MB download mid-flight.
  return join(repoRoot(), '.tools', 'scanner-canary', `${binaryHash}.json`);
}

/**
 * @param {string} binary
 * @returns {string} The version the binary reports, or '' if it will not say.
 */
function reportedVersion(binary) {
  const probe = spawnSync(binary, ['version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) return '';
  return `${probe.stdout}`.trim();
}

/**
 * Writes the corpus into a fresh git repository and stages it.
 *
 * Exported so the proof can drive the same corpus through a deliberately
 * weakened scan. Sharing the definition is the point: a control case that builds
 * its own approximation of the corpus stops testing the real one the moment a
 * family is added.
 *
 * @param {string} directory An existing, empty directory.
 * @returns {readonly Family[]}
 */
export function buildCorpus(directory) {
  const git = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: directory });
  git(['init', '-q']);
  // No commit is ever made, but git refuses to stage without an identity.
  git(['config', 'user.email', 'canary@monstera.invalid']);
  git(['config', 'user.name', 'canary']);

  for (const family of FAMILIES) {
    const target = join(directory, family.file);
    mkdirSync(dirname(target), { recursive: true });
    const content =
      family.key === ALLOW_COMMENT_FAMILY
        ? `${family.build().trimEnd()} // gitleaks:allow\n`
        : family.build();
    writeFileSync(target, content, 'utf8');
  }
  git(['add', '-A']);
  return FAMILIES;
}

/** The corpus family whose file carries the inline allow comment. */
export const ALLOW_COMMENTED_FILE =
  FAMILIES.find((family) => family.key === ALLOW_COMMENT_FAMILY)?.file ?? '';

export { HOSTILE_CONFIG };

/**
 * Maps a gitleaks JSON report onto the corpus families.
 *
 * @param {string} reportJson
 * @returns {{ found: Record<string, string[]>, parseError: string | null }}
 */
export function attributeFindings(reportJson) {
  const open = reportJson.indexOf('[');
  const close = reportJson.lastIndexOf(']');
  if (open === -1 || close <= open) {
    return { found: {}, parseError: 'the scan produced no JSON report.' };
  }
  /** @type {Array<{ File: string, RuleID: string }>} */
  let findings;
  try {
    findings = JSON.parse(reportJson.slice(open, close + 1));
  } catch {
    return {
      found: {},
      parseError: 'the JSON report could not be parsed, so nothing about the scan is known.',
    };
  }

  /** @type {Record<string, string[]>} */
  const found = {};
  for (const family of FAMILIES) {
    found[family.key] = [
      ...new Set(
        findings
          .filter((finding) => `${finding.File}`.replace(/\\/g, '/') === family.file)
          .map((finding) => `${finding.RuleID}`),
      ),
    ];
  }
  return { found, parseError: null };
}

/**
 * Runs the corpus and reports which families the binary actually caught.
 *
 * @param {string} binary
 * @returns {{ problems: string[], found: Record<string, string[]> }}
 */
function measure(binary) {
  const corpus = mkdtempSync(join(tmpdir(), 'monstera-canary-'));
  try {
    buildCorpus(corpus);

    const scan = runSecretScan({
      binary,
      staged: true,
      root: corpus,
      // The real configuration, applied to a corpus outside the repository it
      // lives in. This is what makes the custom rules part of what is proven.
      configPath: configPathFor(),
      // Hostile: an allow-everything config offered through the environment. If
      // --config ever stops being passed, every family below goes missing at
      // once and this canary says so.
      env: { ...process.env, GITLEAKS_CONFIG_TOML: HOSTILE_CONFIG },
      captureOutput: true,
      extraArgs: ['--report-format', 'json', '--report-path', '-'],
    });

    /** @type {string[]} */
    const problems = [];
    if (scan.blocked.length > 0) {
      problems.push(`the canary scan refused to run: ${scan.blocked.join(' / ')}`);
      return { problems, found: {} };
    }

    const { found, parseError } = attributeFindings(scan.stdout);
    if (parseError !== null) problems.push(parseError);

    for (const family of FAMILIES) {
      const rules = found[family.key] ?? [];
      if (rules.length === 0) {
        problems.push(
          `${family.key} was NOT DETECTED. Expected rule ${family.rule}. This family is ` +
            `${family.why}.`,
        );
      } else if (!rules.includes(family.rule)) {
        problems.push(
          `${family.key} was detected as [${rules.join(', ')}] rather than ${family.rule}. The ` +
            `secret was caught, but by a different rule than the pinned scanner uses — the ` +
            `ruleset is not the one this repository was verified against.`,
        );
      }
    }

    return { problems, found };
  } finally {
    rmSync(corpus, { recursive: true, force: true });
  }
}

/**
 * @typedef {{
 *   ok: boolean,
 *   problems: string[],
 *   version: string,
 *   pinned: boolean,
 *   cached: boolean,
 *   binaryPath: string,
 * }} CanaryResult
 */

/**
 * @param {{ binary: string, pinnedVersion: string, force?: boolean }} options
 * @returns {CanaryResult}
 */
export function verifyScannerCapability({ binary, pinnedVersion, force = false }) {
  const binaryPath = commandPath(binary);

  if (binaryPath === null) {
    return {
      ok: false,
      problems: [
        `${binary} could not be resolved to a file on disk, so its capability cannot be ` +
          `established or cached.`,
      ],
      version: '',
      pinned: false,
      cached: false,
      binaryPath: '',
    };
  }

  const inputs = verdictInputs(binaryPath);
  const digest = digestInputs(inputs).digest;
  const cacheFile = cachePath(sha256File(binaryPath));

  // The warm path spawns nothing. Reading the version back from the cache rather
  // than asking the binary again is sound because the cache key IS the binary's
  // hash: a build that hashes the same reports the same version, and a build
  // that does not gets a different key and is measured afresh.
  //
  // This is not a micro-optimisation. `gitleaks version` costs about 600 ms on
  // Windows, on the most frequent action in the project, for an answer already
  // on disk — and a check that makes every commit noticeably slower is a check
  // that gets argued out of the hook.
  if (!force && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (cached.inputs === digest && cached.ok === true && typeof cached.version === 'string') {
        return {
          ok: true,
          problems: [],
          version: cached.version,
          pinned: `${cached.version}`.includes(pinnedVersion),
          cached: true,
          binaryPath,
        };
      }
    } catch {
      // A damaged cache entry means the verdict is unknown, which is the same
      // as not having one. Fall through and measure.
    }
  }

  const version = reportedVersion(binary);
  const pinned = version.includes(pinnedVersion);
  const { problems } = measure(binary);
  const ok = problems.length === 0;

  if (ok) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(
      cacheFile,
      `${JSON.stringify({ ok, inputs: digest, version, binaryPath }, null, 2)}\n`,
      'utf8',
    );
  }

  return { ok, problems, version, pinned, cached: false, binaryPath };
}

/**
 * @param {CanaryResult} result
 * @param {string} pinnedVersion
 * @returns {string}
 */
export function formatCanaryFailure(result, pinnedVersion) {
  return (
    `\nThe secret scanner failed its capability check — it did not find secrets a scan is ` +
    `expected to find:\n\n` +
    result.problems.map((problem) => `  - ${problem}`).join('\n\n') +
    `\n\nScanner: ${result.binaryPath || '(unresolved)'}\n` +
    `Reports: ${result.version || '(no version)'}\n` +
    `Pinned:  ${pinnedVersion}\n\n` +
    (isPinned(result.version, pinnedVersion)
      ? `This is the pinned build, so the ruleset itself is not what changed — look at ` +
        `${configPathFor()} and at scripts/lib/secretScan.mjs.\n\n`
      : `This is NOT the pinned build. Run: node scripts/provision/gitleaks.mjs\n\n`)
  );
}

/**
 * A one-line notice whenever the scanner in use is not the pinned one.
 *
 * Divergence that nobody sees is divergence nobody acts on: the previous check
 * accepted any binary that could print a version, so a contributor scanning with
 * a build from years ago got the same silent green as one running the pin.
 *
 * @param {CanaryResult} result
 * @param {string} pinnedVersion
 * @returns {string}
 */
export function divergenceNotice(result, pinnedVersion) {
  if (isPinned(result.version, pinnedVersion)) return '';
  return (
    `Secret scanner: using ${result.version || '(unknown version)'} at ${result.binaryPath}, ` +
    `not the pinned ${pinnedVersion}. It passed the capability check, so the families in ` +
    `scripts/lib/scannerCanary.mjs are covered; rules added since it was built are not. ` +
    `Run node scripts/provision/gitleaks.mjs for the pinned build.\n`
  );
}
