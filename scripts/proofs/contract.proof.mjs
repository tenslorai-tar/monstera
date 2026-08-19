// @ts-check
/**
 * Proof that the IPC contract is exhaustive at compile time (rule B2, C5).
 *
 * C5's central claim is that "an unhandled contract entry is a compile error".
 * That claim is not testable at runtime — by the time a program runs, a missing
 * handler is just a channel that hangs. It has to be proven by compiling code
 * that should not compile and watching the compiler reject it.
 *
 * Every rejection case is paired with a control that must compile. Without the
 * controls, a broken import or a malformed probe tsconfig would fail every case
 * and read as complete success — the failure mode this whole file exists to
 * catch in the contract would then be present in its own proof.
 *
 * Usage: node scripts/proofs/contract.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSC_BIN = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// Inside the repository so `@monstera/*` resolves through the workspace links,
// and gitignored so a probe can never be committed.
const PROBE_DIR = join(REPO_ROOT, '.probe');

const PROBE_TSCONFIG = {
  extends: '../tsconfig.base.json',
  compilerOptions: {
    // The base config is composite with declaration output; a type-check-only
    // probe wants neither, and `noEmit` is incompatible with `composite`.
    composite: false,
    declaration: false,
    declarationMap: false,
    noEmit: true,
    types: [],
    lib: ['ES2023'],
  },
  include: ['probe.ts'],
};

/**
 * One probe.
 *
 * A `reject` case declares **why** it expects to be rejected, not merely that
 * it is. Without that, a case passes on any compiler error at all — a typo in
 * the probe, a renamed export, an unrelated second error — and six of the
 * command cases below differ from each other only in which property is wrong.
 * `code` anchors the diagnostic; `because` is matched against its reason line,
 * never its summary. See {@link diagnose}.
 *
 * @typedef {{
 *   name: string,
 *   expect: 'reject' | 'allow',
 *   source: string,
 *   code?: string,
 *   because?: RegExp,
 * }} Case
 * @type {readonly Case[]}
 */
const CASES = [
  {
    name: 'a complete handler map compiles',
    expect: 'allow',
    // The control. Every rejection below is only meaningful because this passes.
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve({ version: '1.0.0', installChannel: 'development' }),
};
`,
  },
  {
    name: 'a handler map missing a channel does not compile',
    expect: 'reject',
    code: 'TS2741',
    because: /Property ''app\.info'' is missing/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {};
`,
  },
  {
    name: 'a handler map with an undeclared channel does not compile',
    expect: 'reject',
    code: 'TS2353',
    because: /'app\.notDeclared'' does not exist/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve({ version: '1.0.0', installChannel: 'development' }),
  'app.notDeclared': () => Promise.resolve({}),
};
`,
  },
  {
    name: 'a handler returning the wrong result shape does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /Types of property 'version' are incompatible/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve({ version: 1, installChannel: 'development' }),
};
`,
  },
  {
    name: 'a handler returning an undeclared enum member does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /Types of property 'installChannel' are incompatible/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve({ version: '1.0.0', installChannel: 'beta' }),
};
`,
  },
  {
    name: 'a client stub missing a channel does not compile',
    expect: 'reject',
    code: 'TS2741',
    because: /Property ''app\.info'' is missing in type '\{\}' but required in type 'ClientApi/u,
    // This is what keeps the browser shim honest. A shim that has drifted from
    // the contract would otherwise pass its own tests while proving nothing
    // about the real application.
    source: `
import type { ContractClient } from '@monstera/contract';
export const shim: ContractClient = {};
`,
  },
  {
    name: 'a renderer type may not hold a filesystem path where a handle is required',
    expect: 'reject',
    code: 'TS2322',
    because: /not assignable to type '\{ readonly \[brand\]: "FileHandle"; \}'/u,
    // Invariant L2, made structural: FileHandle is branded, so a bare string
    // cannot stand in for one. This is the check that makes "the renderer never
    // holds a path" a compile error rather than a code-review habit.
    source: `
import type { FileHandle } from '@monstera/shared';
export const handle: FileHandle = 'C:/Users/someone/secret.pdf';
`,
  },
  {
    name: 'a minted FileHandle is accepted',
    expect: 'allow',
    // Control for the case above: the brand must admit properly constructed
    // values, or it would forbid the feature rather than the mistake.
    source: `
import { asFileHandle, type FileHandle } from '@monstera/shared';
export const handle: FileHandle = asFileHandle('opaque-token');
`,
  },

  // ---------------------------------------------------------------------------
  // ADR-0009 §6 and §3a. The command routing table cannot be partial, and
  // neither declaration axis can be omitted or declared without its
  // consequence. None of this is testable at runtime: a command kind with no
  // spec is, at run time, a dispatch that finds nothing.
  // ---------------------------------------------------------------------------
  {
    name: 'a complete command spec table compiles',
    expect: 'allow',
    // THE CONTROL for every command case below. Without it, a broken import or
    // a renamed type would reject all of them and read as total success —
    // which is this file's own stated failure mode.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
};
`,
  },
  {
    name: 'a spec table missing a command kind does not compile',
    expect: 'reject',
    code: 'TS2741',
    because: /Property 'rotatePages' is missing in type '\{\}'/u,
    // §6: omit a kind and it does not compile. This is the case that makes the
    // table exhaustive by construction rather than by review.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {};
`,
  },
  {
    name: 'a spec table with an unrouted command kind does not compile',
    expect: 'reject',
    code: 'TS2353',
    because: /'notDeclared' does not exist in type 'CommandSpecs'/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
  notDeclared: {
    kind: 'notDeclared',
    writer: 'mupdf',
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
};
`,
  },
  {
    name: 'a spec that omits the reproducibility axis does not compile',
    expect: 'reject',
    code: 'TS2322',
    // Both axis names appear in this diagnostic's SUMMARY, because the summary
    // quotes the whole offending type. Only the reason line says which is
    // actually missing.
    because: /is missing the following properties from type '\{ readonly reproducible: false; readonly replay: "stored-effect"; \}': reproducible, replay/u,
    // §3a exists BEFORE any command does, because retrofitting it rewrites the
    // log rather than extending it. A spec that forgets the axis is the
    // retrofit arriving one command at a time.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    invertible: true,
    undo: 'inverse',
  },
};
`,
  },
  {
    name: 'a spec that omits the invertibility axis does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /is missing the following properties from type '\{ readonly invertible: false; readonly undo: "checkpoint"; \}': invertible, undo/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    reproducible: true,
    replay: 'reapply-intent',
  },
};
`,
  },
  {
    name: 'a non-reproducible spec claiming intent replay does not compile',
    expect: 'reject',
    code: 'TS2322',
    // `replay`, NOT `reproducible`. Both names sit in the summary; only this
    // one is the reason. Swapping this regex with the invertibility case's must
    // turn both red — see the resolution test at the head of `main`.
    because: /Types of property 'replay' are incompatible/u,
    // §3a's sentence AS A TYPE: a command that cannot reproduce itself records
    // its EFFECT, and replay re-applies the stored effect rather than re-running
    // the operation. Declaring the axis without its consequence is what this
    // forbids — signing, OCR and AI all land here.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    invertible: true,
    undo: 'inverse',
    reproducible: false,
    replay: 'reapply-intent',
  },
};
`,
  },
  {
    name: 'a non-invertible spec claiming inverse undo does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /Types of property 'undo' are incompatible/u,
    // §4 spends this: a non-invertible command without a checkpoint is
    // unrepresentable. Letting `invertible: false` sit beside `undo: 'inverse'`
    // is how a checkpoint quietly becomes optional.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    invertible: false,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
};
`,
  },
  {
    name: 'a non-invertible, non-reproducible spec compiles when both consequences are named',
    expect: 'allow',
    // Control for the two rejections above. The axes must ADMIT the honest
    // combination — flatten, redact and OCR are exactly this shape — or the
    // type would forbid the feature rather than the mistake.
    source: `
import type { CommandSpec } from '@monstera/kernel';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'mupdf',
  invertible: false,
  undo: 'checkpoint',
  reproducible: false,
  replay: 'stored-effect',
};
`,
  },
  {
    name: 'a command carrying a non-quarter-turn rotation does not compile',
    expect: 'reject',
    code: 'TS2322',
    // Atomic: one line, no continuation, so the message IS the reason.
    because: /Type '45' is not assignable to type '1 \| 3 \| 2'/u,
    // MuPDF stores /Rotate 45 verbatim (ADR-0006), so a degrees-typed command
    // would let an arbitrary angle reach the page tree. Making the wire type
    // incapable of carrying 45 means nothing downstream has to reject one.
    source: `
import type { Command } from '@monstera/contract';
export const command: Command = { kind: 'rotatePages', pages: [0], quarterTurns: 45 };
`,
  },
];

/**
 * @param {string} source
 * @returns {{ ok: boolean, output: string }}
 */
function typecheck(source) {
  writeFileSync(join(PROBE_DIR, 'probe.ts'), source);
  const result = spawnSync(
    process.execPath,
    // `--pretty false` changes nothing today: piped output is byte-identical
    // with and without it, because tsc already turns pretty off when stdout is
    // not a TTY. Measured, not assumed. What the flag removes is an UNSTATED
    // DEPENDENCY ON BEING PIPED — an invocation attached to a TTY would turn
    // pretty on, insert colour codes and a source echo, and change the format
    // under the reason matcher below. A claim with an expiry, made explicit
    // rather than left to hold by accident.
    [TSC_BIN, '-p', join(PROBE_DIR, 'tsconfig.json'), '--pretty', 'false'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  if (result.error !== undefined) {
    throw new Error('Could not run tsc for the contract probe', { cause: result.error });
  }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Splits tsc output into the one diagnostic it should contain, and separates
 * that diagnostic's **summary** from its **reason**.
 *
 * ## Why the summary is not evidence
 *
 * A diagnostic's first line quotes the entire offending type, so it contains
 * **every property name in it**. Measured, for the spec whose `replay` is
 * wrong:
 *
 * ```
 * error TS2322: Type '{ … invertible: true; undo: "inverse"; reproducible: false; replay: "reapply-intent"; }' …
 *   Types of property 'replay' are incompatible.
 * ```
 *
 * A case expecting `reproducible` matches that first line on a naive substring
 * search even though the operative reason is `replay` — both names are present
 * and only one of them is the reason. That is the exact subtle failure this
 * matcher exists to close, reappearing one level up inside the fix. So the
 * reason is the **indented continuation**, never the summary.
 *
 * A diagnostic with no continuation is atomic: its message is its own reason,
 * there is no summary/reason split to get wrong, and it is matched directly.
 *
 * @param {string} output
 * @returns {{ heads: string[], reason: string }}
 */
function diagnose(output) {
  const lines = output.split('\n').filter((line) => line.trim() !== '');
  const heads = lines.filter((line) => /^\S.*error TS\d+/u.test(line));
  const continuations = lines.filter((line) => /^\s/u.test(line));

  const summary = heads[0] ?? '';
  const atomicMessage = summary.replace(/^.*?error TS\d+:\s*/u, '');

  return { heads, reason: continuations.length > 0 ? continuations.join('\n') : atomicMessage };
}

/**
 * Rebuilds the workspace before probing.
 *
 * The probes resolve `@monstera/*` through each package's exports map, which
 * points at `dist` — so they test the *last successful build*, not the working
 * tree. With `noEmitOnError` set, a source change that fails to compile leaves
 * the previous declarations in place, and the probes then quietly re-verify
 * code that is no longer there. This was found by mutation-testing the proof:
 * a mutation that removed exhaustiveness left it green, because the mutation
 * broke the build and the stale `dist` still had the correct types.
 *
 * Building here means the proof can only ever report on current code.
 */
function buildWorkspace() {
  const result = spawnSync(process.execPath, [TSC_BIN, '--build'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error('Could not run tsc to build the workspace', { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(
      `The workspace does not compile, so the probes would test stale declarations:\n` +
        `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

/**
 * The reason matcher's own resolution test (audit item 4a), run **before** any
 * case is believed.
 *
 * Two cases differ only in which property mismatches. Swap their expected
 * reasons: both must go red. If either stays green, the matcher cannot
 * distinguish the two values it exists to tell apart, and every verdict it
 * gives afterwards is decoration.
 *
 * This is not hypothetical caution. Whether a property-name anchor works at all
 * is **shape-dependent** — a mismatch reached through an argument position can
 * report `Type '"a"' is not assignable to type '"b"'` with no property name in
 * the message, the property identified only by line and column. A case in that
 * category needs a different anchor, and this test is what says which category
 * a case is in.
 *
 * @returns {string[]} one entry per pair that failed to discriminate
 */
function resolutionTest() {
  /** @type {string[]} */
  const problems = [];

  const pairs = [
    ['a non-reproducible spec claiming intent replay does not compile',
     'a non-invertible spec claiming inverse undo does not compile'],
    ['a spec that omits the reproducibility axis does not compile',
     'a spec that omits the invertibility axis does not compile'],
  ];

  // PART ONE — the summary must not be evidence.
  //
  // The regexes below are phrased specifically enough that they match only
  // continuation text, so swapping them (part two) stays red whether or not the
  // summary is included. That makes the swap a real discrimination test and a
  // WEAK test of summary exclusion — measured by mutation: folding the summary
  // back into the reason left part two entirely green.
  //
  // So summary exclusion gets its own control, phrased the NAIVE way a future
  // author would phrase it. `reproducible` appears only in the summary of the
  // case whose operative reason is `replay`; if a bare property name can match
  // there, the matcher is back to certifying the wrong reason.
  const naive = [
    { caseName: 'a non-reproducible spec claiming intent replay does not compile', absent: /reproducible/u },
    { caseName: 'a non-invertible spec claiming inverse undo does not compile', absent: /invertible/u },
  ];
  for (const { caseName, absent } of naive) {
    const subject = CASES.find((c) => c.name === caseName);
    if (subject === undefined) {
      problems.push(`resolution test names a case that does not exist: ${caseName}`);
      continue;
    }
    const { reason } = diagnose(typecheck(subject.source).output);
    if (absent.test(reason)) {
      problems.push(
        `"${caseName}": the reason text matches ${String(absent)}, which names the axis that ` +
          `is NOT the reason. That name is in the diagnostic's summary — the summary quotes ` +
          `the whole offending type, so it contains every property in it. Treating it as ` +
          `evidence is what makes this matcher unable to fail.\n      reason was:\n${reason}`,
      );
    }
  }

  // PART TWO — two cases differing only in which property is wrong must not
  // accept each other's reason.
  for (const [leftName, rightName] of pairs) {
    const left = CASES.find((c) => c.name === leftName);
    const right = CASES.find((c) => c.name === rightName);
    if (left === undefined || right === undefined || left.because === undefined || right.because === undefined) {
      problems.push(`resolution test names a case that does not exist: ${leftName} / ${rightName}`);
      continue;
    }

    for (const [subject, foreign] of [
      [left, right.because],
      [right, left.because],
    ]) {
      const { output } = typecheck(/** @type {Case} */ (subject).source);
      const { reason } = diagnose(output);
      if (/** @type {RegExp} */ (foreign).test(reason)) {
        problems.push(
          `"${/** @type {Case} */ (subject).name}" also matches the OTHER case's reason ` +
            `${String(foreign)}. The matcher cannot tell these two apart, so neither ` +
            `verdict means anything.\n      reason was:\n${reason}`,
        );
      }
    }
  }
  return problems;
}

function main() {
  buildWorkspace();

  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(join(PROBE_DIR, 'tsconfig.json'), `${JSON.stringify(PROBE_TSCONFIG, null, 2)}\n`);

  /** @type {string[]} */
  const failures = [];

  try {
    const unresolved = resolutionTest();
    if (unresolved.length > 0) {
      process.stderr.write(
        `\nThe reason matcher failed its own resolution test:\n\n` +
          unresolved.map((p) => `  - ${p}`).join('\n\n') +
          `\n\nNothing below is reported, because a matcher that cannot distinguish two ` +
          `known-different reasons cannot certify any of them.\n\n`,
      );
      return 1;
    }
    process.stdout.write(`  ok  4a     reason matcher distinguishes swapped property reasons\n`);
  } catch (error) {
    rmSync(PROBE_DIR, { recursive: true, force: true });
    throw error;
  }

  try {
    for (const testCase of CASES) {
      const { ok, output } = typecheck(testCase.source);

      if (testCase.expect === 'allow') {
        if (ok) process.stdout.write(`  ok  allow  ${testCase.name}\n`);
        else failures.push(`${testCase.name}: expected this to compile, tsc rejected it:\n${output}`);
        continue;
      }

      if (ok) {
        failures.push(
          `${testCase.name}: THE CONTRACT IS NOT EXHAUSTIVE — tsc accepted code that should not compile.`,
        );
        continue;
      }

      // Rejected — but a rejection is not evidence until it is the RIGHT
      // rejection. Every way of breaking a probe (a typo, a renamed export, a
      // second error masking an absent first one) also produces a rejection,
      // and until this check existed the case would have passed on any of them.
      const { heads, reason } = diagnose(output);

      if (heads.length !== 1) {
        // Counted as unindented lines carrying an error code, NOT as a line
        // count: a diagnostic spans two or three lines with indented
        // continuations. This is also what forecloses the combined-mismatch
        // weakness — where two axes are wrong at once tsc emits ONE diagnostic
        // naming only the first, so a case declaring the second fails here
        // without anyone having to remember the rule.
        failures.push(
          `${testCase.name}: expected exactly one diagnostic, got ${String(heads.length)}. ` +
            `A case that provokes several is not testing what it names.\n${output}`,
        );
        continue;
      }

      if (!heads[0]?.includes(`error ${testCase.code}:`)) {
        failures.push(
          `${testCase.name}: expected ${testCase.code ?? '(no code declared)'}, got:\n${output}`,
        );
        continue;
      }

      if (testCase.because !== undefined && !testCase.because.test(reason)) {
        failures.push(
          `${testCase.name}: rejected for the wrong reason.\n` +
            `      expected reason to match ${String(testCase.because)}\n` +
            `      actual reason:\n${reason}`,
        );
        continue;
      }

      process.stdout.write(`  ok  reject ${testCase.name}\n`);
    }
  } finally {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} contract proof failure(s):\n\n${failures.join('\n\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(`\n${CASES.length} contract cases passed.\n`);
  return 0;
}

process.exit(main());
