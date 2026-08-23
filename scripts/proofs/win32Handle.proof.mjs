// @ts-check
/**
 * The invalid-handle check, and the control that reproduces the bug it closes.
 *
 * Three research files each decided for themselves whether a Win32 HANDLE was
 * `INVALID_HANDLE_VALUE`, and all three were wrong the same way — the failure
 * branch was unreachable, so a refused `CreateFileW` carried on into `ReadFile`
 * and reported `ERROR_INVALID_HANDLE` (finding TT-2).
 *
 * **The control is the load-bearing case and it is written against the OLD
 * spellings**, not against the new one: it asserts that every comparison those
 * files made answers `false` for the value koffi actually returns. Restoring any
 * of them turns this red. A case that only checked the new function would pass
 * just as happily with the old code beside it.
 *
 * The measured value is a literal here on purpose. It came from running
 * `CreateFileW` against a path that cannot exist, so `INVALID_HANDLE_VALUE` is
 * the only thing it can have returned — and pinning it means a koffi version that
 * changes the representation fails here rather than silently in a probe.
 */

import { INVALID_HANDLE_SOURCE, isInvalidHandle } from '../lib/win32Handle.mjs';

let failures = 0;

// COUNTED, not written down — the sibling guard's literal was already off by one
// when a case was added beside it, and a summary that cannot disagree with the
// run is the only kind worth printing.
let ran = 0;

/**
 * @param {string} name @param {boolean} condition @param {string} detail
 */
function check(name, condition, detail) {
  ran += 1;
  if (condition) {
    process.stdout.write(`  ok  ${name}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`  FAIL  ${name}\n      ${detail}\n`);
}

/**
 * What koffi.address returns for INVALID_HANDLE_VALUE on win32 x64, measured.
 *
 * WIDENED TO `bigint` DELIBERATELY, and the reason is the finding's own answer to
 * *why did nobody catch this*. Left as a literal type, the compiler folds
 * `MEASURED_INVALID !== -1n` and rejects it as a comparison with no overlap — so
 * the control would be decided at compile time rather than run. At the real call
 * sites `koffi.address` returns an untyped value, which is exactly why the
 * compiler could say nothing there. The control has to run under the same
 * ignorance the defect lived in.
 *
 * @type {bigint}
 */
const MEASURED_INVALID = 18446744073709551615n;

/** A stand-in for koffi, so this proof needs no native library to run. */
const koffi = { address: (/** @type {unknown} */ handle) => handle };

check(
  'CONTROL: `address === -1n` — the spelling lowboxSpike.mjs used — MISSES it',
  MEASURED_INVALID !== -1n,
  'if this passes, the measured value is signed and the finding does not exist',
);

check(
  'CONTROL: `address === -1` — the spelling the retired hostFixture.mjs used — MISSES it',
  // @ts-expect-error deliberately comparing a BigInt to a Number, which is the bug
  MEASURED_INVALID !== -1,
  'a BigInt is never === a Number, and that is why the branch never ran',
);

/**
 * The literal the old code wrote, built from its text rather than typed out.
 *
 * Written directly it is now a lint error — `no-loss-of-precision` — which is
 * itself part of the finding: the spelling was banned by a rule the research
 * files are outside the reach of, so nothing said so where it was used.
 */
const LOSSY = Number('0xffffffffffffffff');

check(
  'CONTROL: `address === 0xffffffffffffffff` MISSES it, twice over',
  // @ts-expect-error deliberately comparing a BigInt to a Number, which is the bug
  MEASURED_INVALID !== LOSSY && !Number.isSafeInteger(LOSSY),
  'a BigInt is never === a Number, and the literal cannot hold the value exactly either',
);

check(
  'CONTROL: `!handle` MISSES it, so the guard in front of the guard was inert too',
  !!MEASURED_INVALID,
  'the value is truthy, so a falsiness check passes an invalid handle through',
);

check(
  'and the check CATCHES the value all four missed',
  isInvalidHandle(koffi, MEASURED_INVALID),
  `isInvalidHandle said the measured INVALID_HANDLE_VALUE was usable`,
);

check(
  'a signed -1n is caught as well, since a future koffi may return it that way',
  isInvalidHandle(koffi, -1n),
  'BigInt.asIntN(64, -1n) is -1n, so this is the same handle in the other spelling',
);

check(
  'NULL is caught, because CreateJobObjectW and OpenProcess fail that way instead',
  isInvalidHandle(koffi, 0n) && isInvalidHandle(koffi, null) && isInvalidHandle(koffi, undefined),
  'the two Win32 failure spellings are not interchangeable and both must be covered',
);

// POSITIVE CONTROL. Without it, a function that returned `true` unconditionally
// would satisfy every case above — the reassuring answer for a check whose job is
// to say "this failed" is to say it about everything.
check(
  'POSITIVE CONTROL: a plausible REAL handle is reported usable',
  !isInvalidHandle(koffi, 0x1a4n) && !isInvalidHandle(koffi, 12345n),
  'a check that calls every handle invalid satisfies all the cases above and is useless',
);

check(
  'RESOLUTION: the two neighbouring values either side of NULL are told apart',
  isInvalidHandle(koffi, 0n) && !isInvalidHandle(koffi, 1n),
  'the smallest step that changes the answer must change the answer',
);

// The embedded copy is DERIVED, not duplicated. This asserts the derivation
// rather than the text, because asserting the text would be a second copy of it.
check(
  'the source emitted into spawned children IS the function, not a copy of it',
  INVALID_HANDLE_SOURCE === isInvalidHandle.toString(),
  'a hand-kept duplicate is the shape this module exists to remove',
);

check(
  'and it closes over nothing, so it still works where only its text arrives',
  !/\b(?:import|require)\b/u.test(INVALID_HANDLE_SOURCE),
  'the emitted copy names an import, which is undefined in a spawned child',
);

// SEPARATE FROM THE CASE ABOVE, because they were one case and its message was
// wrong. Mutating the resolver reddened it with "the emitted copy referenced
// something the child does not have" — a true-sounding diagnosis of a defect
// that was not there. A compound assertion can only carry one message, and the
// one it carries is whichever clause the author had in mind.
const emitted = new Function(`${INVALID_HANDLE_SOURCE}; return isInvalidHandle;`)();
check(
  'the emitted copy behaves identically to the imported one on every case above',
  [MEASURED_INVALID, -1n, 0n, null, undefined, 0x1a4n, 1n].every(
    (handle) => emitted(koffi, handle) === isInvalidHandle(koffi, handle),
  ),
  'the text and the function disagree, so children and parent are checking different rules',
);

// ---------------------------------------------------------------------------
// THE DESKTOP COPY, which exists because that package cannot import this one.
//
// `apps/desktop/src/win32HostSurface.ts` carries the same rule in TypeScript.
// It is a copy and not a second opinion, and the difference between those two
// words is entirely this case: MMM-1's rule is *make a copy only where the
// reader cannot reach the source, and prove every copy that exists*. The reader
// genuinely cannot — `scripts/` is plain Node outside every package tsconfig,
// and the module graph forbids the edge — so the copy is legitimate and this is
// the proof it owes.
//
// Compared BEHAVIOURALLY, not textually. One is TypeScript and one is JSDoc'd
// JavaScript, so their text will never match and a text comparison would have
// to be loosened until it stopped meaning anything. Driving the owner with an
// identity address reader makes it the same function as the copy's judgement
// half, over the same inputs.
// ---------------------------------------------------------------------------
const BUILT_SURFACE = new URL(
  '../../apps/desktop/dist/win32HostSurface.js',
  import.meta.url,
);

/** @type {{ isInvalidHandleAddress?: (address: unknown) => boolean } | null} */
let desktop;
try {
  desktop = await import(BUILT_SURFACE.href);
} catch {
  // The absence is reported as a FAILING case below, never as a skip: a copy
  // that could not be read and a copy that agrees must not share an output.
  desktop = null;
}

check(
  'the desktop copy is BUILT, so the comparison below is not skipped in silence',
  desktop !== null && typeof desktop.isInvalidHandleAddress === 'function',
  `${BUILT_SURFACE.pathname} did not import, or exports no isInvalidHandleAddress. ` +
    `This proof reads the BUILD — run \`npm run typecheck\`. A missing copy and an ` +
    `agreeing copy must not share an output, which is why this is a case and not a skip.`,
);

if (desktop !== null && typeof desktop.isInvalidHandleAddress === 'function') {
  const copy = desktop.isInvalidHandleAddress;
  const cases = [MEASURED_INVALID, -1n, 0n, null, undefined, 0x1a4n, 1n, 4096n];
  check(
    'the desktop copy answers exactly as the owner does, on every value above',
    cases.every((address) => copy(address) === isInvalidHandle(koffi, address)),
    `the copy in apps/desktop has drifted from scripts/lib/win32Handle.mjs. ` +
      `Disagreement at: ${JSON.stringify(
        cases.filter((address) => copy(address) !== isInvalidHandle(koffi, address)).map(String),
      )}`,
  );
  check(
    'CONTROL: and that comparison can SEE a disagreement when there is one',
    // Mutating the copy is not available here, so the control mutates the
    // question instead: a judgement that is wrong on exactly one value must be
    // reported as disagreeing. Without this, the case above is satisfied by two
    // functions that both throw, or by a comparison that never ran.
    !cases.every((address) => copy(address) === (address === 1n)),
    'the comparison agrees with a deliberately wrong rule, so it separates nothing',
  );
}

// Zero cases and every case passing are the same output otherwise.
if (ran === 0) {
  process.stdout.write('\nNo invalid-handle case ran. That is a broken proof, not a clean one.\n');
  process.exit(1);
}

process.stdout.write(
  failures === 0
    ? `\n${ran} invalid-handle cases passed.\n`
    : `\n${failures} of ${ran} invalid-handle case(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
