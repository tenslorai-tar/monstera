// @ts-check
/**
 * Proof that every bundled licence NOTICE states is checked against the file it
 * was read from, and that a change in those terms turns the build red (rule B2).
 *
 * ## What was wrong
 *
 * NOTICE listed sixteen bundled libraries and a licence for each, and the
 * sentence justifying them — "read from each library's own licence file in the
 * provisioned source tree" — was prose. Nothing verified it, and nothing could:
 * the reader was told where the terms came from in general and never which file
 * in particular, so doubting an entry meant disputing it rather than looking.
 *
 * Two of the sixteen are not where a reader would look. leptonica keeps its
 * terms in `leptonica-license.txt` with no LICENSE or COPYING at its root, and
 * libjpeg ships no licence file at all — its terms are a section of README.
 *
 * The sharper risk is a RELICENSING. These libraries arrive inside someone
 * else's tarball, so an upstream version bump can change a component's terms
 * with nobody here reviewing them at the moment they change. mujs is the live
 * example: Artifex positions MuJS publicly as AGPL-or-commercial, while the
 * vendored tree grants ISC. The shipped grant governs, but only a check that
 * reads the shipped file keeps that true after the next bump.
 *
 * ## The cases
 *
 * The fixture tree is the point. `verifyLicenceSources` takes values and a
 * source root, so the resolution test runs on any machine rather than only one
 * with a 69 MB tree provisioned — and mutating a declaration needs no write to
 * a tracked file.
 *
 *   - a declaration matching its file passes;
 *   - a marker off by ONE LETTER fails (the resolution test: a relicensing that
 *     kept the file in place is exactly this size of difference);
 *   - a file that has moved fails, naming the path;
 *   - and the control that makes the rest mean something: a check that reported
 *     a problem for everything would satisfy every failure case above, so the
 *     passing case is asserted to produce no problems at all.
 *
 * The real declaration is then verified against the real tree when one is
 * provisioned, and reported as skipped when it is not — never silently passed.
 *
 * Usage: node scripts/proofs/licenceProvenance.proof.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import {
  checkLicenceSources,
  declaredNativeComponents,
  renderNotice,
  verifyLicenceSources,
} from '../release/generateNotice.mjs';

const ROOT = repoRoot();
const FIXTURE = join(ROOT, '.probe', 'licence-provenance');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} relative @param {string} content */
function writeFixture(relative, content) {
  const path = join(FIXTURE, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/**
 * @param {Record<string, import('../release/generateNotice.mjs').BundledLicence>} licences
 * @returns {import('../release/generateNotice.mjs').NativeComponent[]}
 */
function componentsWith(licences) {
  return [
    {
      name: 'Fixture',
      role: 'proof fixture',
      licence: 'AGPL-3.0-or-later',
      origin: 'https://example.invalid/',
      source: 'https://example.invalid/source',
      bundled: Object.keys(licences),
      licences,
    },
  ];
}

try {
  rmSync(FIXTURE, { recursive: true, force: true });
  writeFixture('thirdparty/widget/COPYING', 'ISC License\n\nCopyright (c) 2013-2020 Someone.\n');

  const declaration = {
    spdx: 'ISC',
    file: 'thirdparty/widget/COPYING',
    marker: 'ISC License',
  };

  check(
    'a declaration matching its file produces no problems',
    verifyLicenceSources(componentsWith({ widget: declaration }), FIXTURE).length === 0,
    'the passing case must be clean, or every failure case below is satisfied by a check ' +
      'that simply complains about everything',
  );

  // RESOLUTION TEST (stage audit 4a), run before this instrument is trusted with
  // anything real. One letter is the size of difference a relicensing leaves
  // behind when the file keeps its name — "ISC License" becoming anything else
  // must be visible, or the check only notices deletions.
  {
    const problems = verifyLicenceSources(
      componentsWith({ widget: { ...declaration, marker: 'ISC Licence' } }),
      FIXTURE,
    );
    check(
      'RESOLUTION: a marker off by one letter is reported',
      problems.length === 1 && `${problems[0]}`.includes('no longer contains'),
      `got ${problems.length} problem(s): ${problems.join(' | ') || '(none)'} — if this passes ` +
        `clean, the check cannot distinguish the terms it claims from any other terms`,
    );
  }

  {
    const problems = verifyLicenceSources(
      componentsWith({ widget: { ...declaration, file: 'thirdparty/widget/LICENSE' } }),
      FIXTURE,
    );
    check(
      'a licence file that has moved is reported, naming the path',
      problems.length === 1 && `${problems[0]}`.includes('thirdparty/widget/LICENSE'),
      `got: ${problems.join(' | ') || '(none)'}`,
    );
  }

  // A second component keeps the first from masking it: a loop that stopped at
  // the first problem would report one entry and look correct.
  {
    writeFixture('thirdparty/other/LICENSE', 'Apache License\nVersion 2.0\n');
    const problems = verifyLicenceSources(
      componentsWith({
        widget: { ...declaration, marker: 'ISC Licence' },
        other: { spdx: 'Apache-2.0', file: 'thirdparty/other/LICENSE', marker: 'BSD License' },
      }),
      FIXTURE,
    );
    check(
      'two broken declarations are both reported',
      problems.length === 2,
      `got ${problems.length}: ${problems.join(' | ') || '(none)'} — one failure masking another ` +
        `is how a table gets fixed one line at a time and stays wrong`,
    );
  }
} finally {
  rmSync(FIXTURE, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The FTL obligation, in NOTICE's rendered bytes.
//
// FreeType's binary-distribution clause does not ask to be named in a licence
// table: it requires a disclaimer stating the software is based in part on the
// work of the FreeType Team, in the distribution documentation. Listing
// "freetype — FreeType License" satisfies attribution and not this clause, so
// the sentence is asserted verbatim. Whether it REACHES a distribution is the
// packaging test's half; this one only proves the text exists to be shipped.
// ---------------------------------------------------------------------------
{
  const notice = renderNotice();
  check(
    'NOTICE carries the FreeType disclaimer verbatim, not a paraphrase',
    notice.includes('This software is based in part on the work of the FreeType Team.'),
    'the FTL requires this sentence in the distribution documentation; naming FreeType in a ' +
      'licence table is attribution, which is a different obligation',
  );

  const declared = declaredNativeComponents();
  const freetype = declared[0]?.licences?.['freetype'];
  check(
    'the FreeType entry records the option TAKEN, citing FTL.TXT itself',
    freetype?.file === 'thirdparty/freetype/docs/FTL.TXT',
    `cites ${freetype?.file ?? '(nothing)'} — for a dual licence, a notice that cites the file ` +
      `describing the choice rather than the licence chosen leaves the redistributor to guess ` +
      `which terms bind them`,
  );

  const mujs = declared[0]?.licences?.['mujs'];
  check(
    'the mujs entry records both the file and the version its grant was read from',
    mujs?.file === 'thirdparty/mujs/COPYING' && mujs.version !== undefined,
    `file=${mujs?.file ?? '(none)'} version=${mujs?.version ?? '(none)'} — this is the one ` +
      `component whose shipped terms differ from how its vendor positions it publicly, so a ` +
      `reader needs to be able to check rather than dispute it`,
  );

  for (const [name, licence] of Object.entries(declared[0]?.licences ?? {})) {
    check(
      `NOTICE states where ${name}'s terms were read from`,
      notice.includes(`read from: ${licence.file}`),
      'a licence claim with no cited source is one a reader can only take on trust',
    );
  }
}

// ---------------------------------------------------------------------------
// The real declaration against the real tree, when one is present.
// ---------------------------------------------------------------------------
{
  const real = checkLicenceSources();
  if (real.checked) {
    check(
      'every declared licence checks out against the provisioned MuPDF source',
      real.problems.length === 0,
      real.problems.join('\n      '),
    );
  } else {
    passed.push('SKIPPED: MuPDF source not provisioned — the real tree was NOT checked here');
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nLicence provenance proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} licence provenance cases passed.\n`);
