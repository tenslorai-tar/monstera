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

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import {
  checkLicenceSources,
  declaredNativeComponents,
  byName,
  familyLicence,
  licenceFileIn,
  normaliseEndings,
  renderBundledAssets,
  renderCompiledIntoPackages,
  renderNotice,
  renderProgram,
  requiresLocalInstall,
  shipsOnTarget,
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

// ---------------------------------------------------------------------------
// THE NPM SIDE, which had no cases at all until a production dependency brought
// its first optional platform family (`pdfjs-dist`'s `@napi-rs/canvas`,
// 2026-08-29). Both behaviours below were written that day and both decide what
// NOTICE says about a native binary this project distributes.
// ---------------------------------------------------------------------------
{
  check(
    'a package with no os or cpu constraint always ships',
    shipsOnTarget({}) && shipsOnTarget({ os: [], cpu: [] }),
    `An ordinary package carries neither field, and every one of the 36 entries that predate ` +
      `this rule is in that shape. If this is false the NOTICE is empty, which is the failure ` +
      `mode the whole file exists to prevent.`,
  );

  check(
    "the SHIPPED platform's variant is included",
    shipsOnTarget({ os: ['win32'], cpu: ['x64'] }),
    `ADR-0018 distributes a Windows x64 build through the Microsoft Store and nothing else, so ` +
      `this is the variant that actually reaches a user's machine. Omitting it would state the ` +
      `terms of every package except the native binary.`,
  );

  check(
    'CONTROL: another platform’s variant is EXCLUDED, so the rule is not "everything"',
    !shipsOnTarget({ os: ['android'], cpu: ['arm64'] }) &&
      !shipsOnTarget({ os: ['linux'], cpu: ['x64'] }) &&
      !shipsOnTarget({ os: ['win32'], cpu: ['arm64'] }),
    `Without this the case above passes for a predicate that returns true for everything — which ` +
      `is what the code did before, and is why generating NOTICE demanded the Android build be ` +
      `installed on a Windows machine. The third one matters most: same os, wrong cpu.`,
  );

  check(
    'a NEGATED constraint is honoured the way npm honours it',
    shipsOnTarget({ os: ['!darwin'] }) && !shipsOnTarget({ os: ['!win32'] }),
    `npm reads \`!win32\` as "anywhere but Windows". Treating a negation as a plain list would ` +
      `include exactly the packages that exclude the shipped platform, and exclude the ones that ` +
      `permit it — wrong in both directions at once, and silent.`,
  );

  // -------------------------------------------------------------------------
  // C3's subject, and the day it predicted. `licenceText` asked the filesystem
  // whether `LICENSE` existed, so NTFS answered yes for a file called `license`
  // and ext4 answered no — a NOTICE that differs by platform. Seven such
  // packages arrived at once on 2026-08-29 with @lingui/core's Babel tree.
  // These cases are expressible only because the matcher now takes a listing;
  // against `existsSync` on Windows the filesystem answered before the code did.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // REPRODUCIBILITY. NOTICE is a generated file compared byte-for-byte by
  // `--check` on three jobs, two operating systems and two Node versions.
  // Anything in it that depends on the machine makes that check report a stale
  // tree for a tree nobody changed.
  // -------------------------------------------------------------------------
  check(
    'the rendered NOTICE contains NO carriage return',
    !renderNotice().includes('\r'),
    `A licence text is pasted in verbatim, so each package contributes its own line endings — ` +
      `most ship CRLF and color-name@1.1.4 ships LF. Git normalises the committed blob to LF, so ` +
      `a generator that emits any CR produces a file that can never equal the one CI checks out. ` +
      `Measured 2026-08-29: seven bytes, seven lines, and "NOTICE is stale" on all three jobs ` +
      `while it read as current here — because the local check compared the file against itself ` +
      `in the same wrong form.`,
  );

  check(
    'normaliseEndings converts CRLF and a lone CR, and leaves LF alone',
    normaliseEndings('a\r\nb\rc\nd') === 'a\nb\nc\nd',
    `The lone CR is not a convention anything still emits; including it is the difference ` +
      `between a rule that is complete and one that happens to be.`,
  );

  check(
    'the bundled list is ordered by CODE POINT, not by the machine’s collation',
    [{ name: 'a' }, { name: 'A' }].sort(byName)[0]?.name === 'A' &&
      'A'.localeCompare('a') > 0,
    `The second half is the control and it is what makes this case separate anything: on this ` +
      `runtime \`localeCompare\` puts "a" before "A" while the code points put "A" first, so a ` +
      `sort that agreed with the locale would fail here. \`localeCompare\` with no locale takes ` +
      `the runtime's default, which is a property of the machine and of the ICU its Node was ` +
      `built with — measured, a Lithuanian collation reorders the real 114-package list.`,
  );

  check(
    'a LOWER-CASE licence filename is found, so the answer does not depend on the filesystem',
    licenceFileIn(['readme.md', 'license', 'index.js']) === 'license',
    `chalk, ms, ansi-styles, camelcase, escalade, has-flag and leven all ship \`license\`. On ` +
      `NTFS the old code found them by collation and wrote their terms into NOTICE; on ext4 it ` +
      `would have thrown "ships no licence text" about packages that ship one, and the C3 step ` +
      `runs on ubuntu.`,
  );

  check(
    'the priority order is honoured, not merely some match returned',
    licenceFileIn(['COPYING', 'LICENSE', 'LICENCE']) === 'LICENSE' &&
      licenceFileIn(['COPYING', 'LICENSE-MIT.txt']) === 'COPYING',
    `The list is ordered, and lower-casing both sides must not turn it into "first entry in the ` +
      `directory wins" — a package shipping both a licence and a COPYING would then have its ` +
      `terms decided by readdir order, which is not stable across filesystems either.`,
  );

  check(
    "CONTROL: a listing with no licence returns null rather than something plausible",
    licenceFileIn(['readme.md', 'index.js', 'package.json']) === null,
    `Without this, the two cases above pass for a matcher that returns the first filename it is ` +
      `given. The throw that follows a null is the oldest guard in this generator.`,
  );

  check(
    'a dual-licence name with an extension is found (the jsesc shape)',
    licenceFileIn(['LICENSE-MIT.txt']) === 'LICENSE-MIT.txt',
    `\`jsesc@3.1.0\` ships \`LICENSE-MIT.txt\` and nothing else. \`LICENSE\` and \`LICENCE\` were ` +
      `listed bare, .md and .txt; \`LICENSE-MIT\` and \`LICENSE-APACHE\` were listed bare only — ` +
      `two of the four name shapes had three spellings and two had one, which is the asymmetry ` +
      `that made it a gap rather than a choice.`,
  );

  check(
    'an ORDINARY package missing from node_modules still means the tree is not installed',
    requiresLocalInstall({}),
    `This is the signal that predates every rule here and it must keep its teeth: a production ` +
      `dependency npm installs everywhere, absent, means somebody ran this before \`npm ci\`. ` +
      `Losing it would drop a genuinely missing package out of NOTICE without a word.`,
  );

  check(
    'CONTROL: a platform variant missing from node_modules does NOT',
    !requiresLocalInstall({ os: ['win32'] }) &&
      !requiresLocalInstall({ cpu: ['x64'] }) &&
      !requiresLocalInstall({ os: ['win32'], cpu: ['x64'] }),
    `\`ci.yml\` runs this generator on the \`shim\` job AND on both legs of the matrix build — ` +
      `the ubuntu one deliberately, because \`licenceText\` looks for upper-case filenames and ` +
      `ext4 will not match a package shipping \`license\` (C3). The win32 variant NOTICE names is ` +
      `absent there by design, and throwing for it makes this generator Windows-only, which is ` +
      `what the first version of the platform rule did. Measured: with that directory moved ` +
      `aside, \`--check\` reports NOTICE current and byte-identical.`,
  );

  check(
    "a platform binary's terms are read from its family's meta-package",
    familyLicence('@napi-rs/canvas-win32-x64-msvc', 'MIT', '1.0.8')?.from === '@napi-rs/canvas',
    `That package contains a .node binary, ICU data and a README — no licence text of any kind. ` +
      `Its terms are published once, in the meta-package npm installs beside it. Read from a ` +
      `real file, with the link asserted on scope, version and SPDX id rather than assumed.`,
  );

  check(
    'CONTROL: a family whose VERSION disagrees is refused',
    familyLicence('@napi-rs/canvas-win32-x64-msvc', 'MIT', '9.9.9') === null,
    `Without this the lookup would accept any prefix that happens to exist, which is how a ` +
      `package acquires the terms of a different release of something adjacent to it. The ` +
      `version is one of the three properties that make this an assertion rather than a guess.`,
  );

  check(
    'CONTROL: a family whose SPDX id disagrees is refused',
    familyLicence('@napi-rs/canvas-win32-x64-msvc', 'Apache-2.0', '1.0.8') === null,
    `The second of the three. A parent under different terms is not this package's licensor, and ` +
      `taking its text would state terms nobody granted — the precise harm "no guessing" names.`,
  );

  check(
    "a SCOPED variant's terms are found in its UNSCOPED namesake, which koffi publishes",
    familyLicence('@koromix/koffi-win32-x64', 'MIT', '3.1.5')?.from === 'koffi',
    `The other publishing shape, and it was invisible here until 2026-09-10: napi-rs puts the ` +
      `meta-package inside the scope, koffi puts the variants in one and the terms in plain ` +
      `\`koffi\`. A same-scope prefix walk finds nothing, so a native library the engine host ` +
      `LOADS AT RUN TIME was absent from NOTICE entirely — the lockfile had marked it dev, and a ` +
      `dependency added elsewhere made npm recompute and drop the flag.`,
  );

  check(
    'CONTROL: the unscoped walk asserts the same three properties',
    familyLicence('@koromix/koffi-win32-x64', 'MIT', '9.9.9') === null &&
      familyLicence('@koromix/koffi-win32-x64', 'Apache-2.0', '3.1.5') === null,
    `Without this the new spelling could accept any unscoped package whose name is a prefix — ` +
      `which is a wider door than the one it was opened for, since an unscoped namespace is ` +
      `shared by everybody.`,
  );

  check(
    'CONTROL: a name with no installed parent is refused rather than invented',
    familyLicence('@monstera/not-a-real-package-x64', 'MIT', '1.0.0') === null,
    `The third. A prefix walk that returned something for a name with no family would make the ` +
      `two cases above pass for a function that answers anything.`,
  );
}

// A SEPARATE PROGRAM'S TERMS ARE RENDERED IN FULL, AND A MISSING TEXT FAILS.
// Built from a constructed tree under the fixture root, so the refusal is
// about this input and not about whatever happens to be committed.
{
  const root = join(FIXTURE, 'programs');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'licences', 'tool'), { recursive: true });
  writeFileSync(join(root, 'licences', 'tool', 'LICENSE'), 'The tool licence, a known sentence.\n');
  /** @type {import('../release/generateNotice.mjs').SeparateProgram} */
  const program = {
    name: 'Tool',
    version: '1.0',
    role: 'a fixture',
    licence: 'MIT',
    origin: 'https://example.invalid/',
    source: 'https://example.invalid/tool-1.0.tar.gz',
    build: 'a fixture build',
    licenceRoot: 'licences',
    components: [{ name: 'Tool', version: '1.0', spdx: 'MIT', texts: ['tool/LICENSE'] }],
  };

  const rendered = renderProgram(program, root).join('\n');
  check(
    'CONTROL: a separate program whose texts exist renders each one in full, with the offer of source',
    rendered.includes('The tool licence, a known sentence.') && rendered.includes('WRITTEN OFFER OF SOURCE'),
    `The refusal below means nothing unless the same program with its text present renders that text.`,
  );

  const missing = { ...program, components: [{ ...program.components[0], texts: ['tool/ABSENT'] }] };
  let refusal = '';
  try {
    renderProgram(/** @type {typeof program} */ (missing), root);
  } catch (error) {
    refusal = String(error);
  }
  check(
    'a separate program whose licence text is MISSING fails the render, naming the file',
    refusal.includes('licences/tool/ABSENT') && refusal.includes('missing'),
    `renderProgram returned for a component with no text on disk (${JSON.stringify(refusal)}). A notice ` +
      `that lists a binary without its terms is the omission this generator exists to refuse.`,
  );

  writeFileSync(join(root, 'licences', 'tool', 'EMPTY'), '  \n');
  const empty = { ...program, components: [{ ...program.components[0], texts: ['tool/EMPTY'] }] };
  let emptyRefusal = '';
  try {
    renderProgram(/** @type {typeof program} */ (empty), root);
  } catch (error) {
    emptyRefusal = String(error);
  }
  check(
    'a separate program whose licence text is EMPTY fails too',
    emptyRefusal.includes('empty'),
    `An empty file satisfies "exists" and carries no terms.`,
  );
  rmSync(root, { recursive: true, force: true });
}

// A LIBRARY COMPILED INTO A BUNDLED PACKAGE IS RENDERED WITH ITS TERMS — from inside the
// package, or from a committed copy whose pin must hold — and a declaration for a package
// that does not ship fails. Constructed under the fixture root, for the case above's reason.
{
  const root = join(FIXTURE, 'compiled');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'node_modules', 'wrapper', 'codec'), { recursive: true });
  mkdirSync(join(root, 'licences'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'wrapper', 'codec', 'LICENSE.codec'), 'The inner codec licence, in the package.\n');
  const committedText = 'The inner library licence, committed.\n';
  writeFileSync(join(root, 'licences', 'inner.txt'), committedText);
  const pin = createHash('sha256').update(committedText).digest('hex');
  const shipped = [{ name: 'wrapper', path: 'node_modules/wrapper' }];
  /** @type {import('../release/generateNotice.mjs').CompiledIntoPackage} */
  const declared = {
    package: 'wrapper',
    components: [
      { name: 'Codec', version: '1', spdx: 'BSD-3-Clause', source: 'https://example.invalid/codec', texts: [{ inPackage: 'codec/LICENSE.codec' }] },
      { name: 'Inner', version: '2', spdx: 'Apache-2.0', source: 'https://example.invalid/inner', texts: [{ committed: 'licences/inner.txt', sha256: pin }] },
    ],
  };

  const rendered = renderCompiledIntoPackages([declared], shipped, root).join('\n');
  check(
    'CONTROL: a library compiled into a shipped package renders its texts, from the package and from a pinned copy',
    rendered.includes('The inner codec licence, in the package.') && rendered.includes('The inner library licence, committed.'),
    `The two refusals below mean nothing unless the same declaration renders when it is right.`,
  );

  /** @param {() => unknown} render */
  const refusalOf = (render) => {
    try {
      render();
      return '';
    } catch (error) {
      return String(error);
    }
  };
  check(
    'a declaration for a package that is NOT shipped fails, rather than rendering a stale notice',
    refusalOf(() => renderCompiledIntoPackages([declared], [], root)).includes('not in the production tree'),
    `A notice for code that does not ship reads as attribution for code that does.`,
  );
  writeFileSync(join(root, 'licences', 'inner.txt'), `${committedText}An edit.\n`);
  check(
    'a committed text that no longer matches its pin fails, naming both digests',
    refusalOf(() => renderCompiledIntoPackages([declared], shipped, root)).includes(pin),
    `A committed licence edited by hand would render as the library's terms.`,
  );
  rmSync(root, { recursive: true, force: true });
}

// A BUNDLED ASSET — the wordmark font (ADR-0100) — is rendered with its full text, and BOTH the asset and
// the text are pinned: a different font under the same file name would otherwise keep the free one's notice.
{
  const root = join(FIXTURE, 'assets');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'fonts'), { recursive: true });
  const font = 'a font, standing in by its bytes';
  const licence = 'The font licence, committed beside it.\n';
  writeFileSync(join(root, 'fonts', 'face.ttf'), font);
  writeFileSync(join(root, 'fonts', 'OFL.txt'), licence);
  /** @type {import('../release/generateNotice.mjs').BundledAsset} */
  const declared = {
    name: 'Face',
    version: 'Regular',
    spdx: 'OFL-1.1',
    role: 'a fixture',
    source: 'https://example.invalid/face',
    file: 'fonts/face.ttf',
    sha256: createHash('sha256').update(font).digest('hex'),
    texts: [{ committed: 'fonts/OFL.txt', sha256: createHash('sha256').update(licence).digest('hex') }],
  };
  /** @param {() => unknown} render */
  const refusalOf = (render) => {
    try {
      render();
      return '';
    } catch (error) {
      return String(error);
    }
  };

  check(
    'CONTROL: a bundled asset whose file and text match their pins renders its full text',
    renderBundledAssets([declared], root).join('\n').includes('The font licence, committed beside it.'),
    `The two refusals below mean nothing unless the same declaration renders when it is right.`,
  );
  writeFileSync(join(root, 'fonts', 'face.ttf'), `${font}, and a different one`);
  check(
    'a bundled asset whose FILE no longer matches its pin fails — a swapped font keeps no notice',
    refusalOf(() => renderBundledAssets([declared], root)).includes('is not the file its pin records'),
    `A different font dropped in under the same name would render the free one's terms for it.`,
  );
  writeFileSync(join(root, 'fonts', 'face.ttf'), font);
  writeFileSync(join(root, 'fonts', 'OFL.txt'), `${licence}An edit.\n`);
  check(
    'a bundled asset whose licence TEXT no longer matches its pin fails',
    refusalOf(() => renderBundledAssets([declared], root)).includes('is not the text its pin records'),
    `A licence text edited by hand would render as the font's terms.`,
  );
  rmSync(root, { recursive: true, force: true });
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
