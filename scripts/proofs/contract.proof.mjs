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
 * @typedef {{ name: string, expect: 'reject' | 'allow', source: string }} Case
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
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {};
`,
  },
  {
    name: 'a handler map with an undeclared channel does not compile',
    expect: 'reject',
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
  const result = spawnSync(process.execPath, [TSC_BIN, '-p', join(PROBE_DIR, 'tsconfig.json')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    throw new Error('Could not run tsc for the contract probe', { cause: result.error });
  }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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

function main() {
  buildWorkspace();

  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(join(PROBE_DIR, 'tsconfig.json'), `${JSON.stringify(PROBE_TSCONFIG, null, 2)}\n`);

  /** @type {string[]} */
  const failures = [];

  try {
    for (const testCase of CASES) {
      const { ok, output } = typecheck(testCase.source);

      if (testCase.expect === 'allow' && !ok) {
        failures.push(`${testCase.name}: expected this to compile, tsc rejected it:\n${output}`);
      } else if (testCase.expect === 'reject' && ok) {
        failures.push(
          `${testCase.name}: THE CONTRACT IS NOT EXHAUSTIVE — tsc accepted code that should not compile.`,
        );
      } else {
        process.stdout.write(`  ok  ${testCase.expect.padEnd(6)} ${testCase.name}\n`);
      }
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
