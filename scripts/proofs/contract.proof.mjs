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
 * The `setLayerVisibility` spec, complete, as every command-table fixture needs
 * it.
 *
 * Written once and interpolated because the table is EXHAUSTIVE by type: the
 * moment a second command kind existed, every fixture below that omits it
 * failed for that reason rather than for the reason it was written to test —
 * which is how `proof:contract` went red on the commit that added the second
 * kind. Six copies by hand would be six chances to make a fixture's error the
 * wrong one, and the six cases differ from each other only inside
 * `rotatePages`.
 */
const LAYER_SPEC = `  setLayerVisibility: {
    kind: 'setLayerVisibility',
    writer: 'mupdf',
    apply: applySetLayerVisibility,
    capture: captureSetLayerVisibility,
    invert: invertSetLayerVisibility,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/**
 * The move's entry, for the fixtures that need a table complete except one.
 *
 * Separate from {@link LAYER_SPEC} because the missing-a-kind case omits the
 * NEWEST kind and needs every other one present — so the two cannot be a single
 * blob, and adding a command means adding its constant here.
 */
const MOVE_SPEC = `  movePage: {
    kind: 'movePage',
    writer: 'mupdf',
    apply: applyMovePage,
    capture: captureMovePage,
    invert: invertMovePage,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/**
 * The first spec declaring `invertible: false`, kept separate for
 * {@link MOVE_SPEC}'s reason — the missing-a-kind case omits the newest kind,
 * which is now this one.
 *
 * It is also the only spec in these fixtures whose `invert` can never be
 * called: `CommandPrior['deletePages']` is `never`.
 */
const DELETE_SPEC = `  deletePages: {
    kind: 'deletePages',
    writer: 'mupdf',
    apply: applyDeletePages,
    capture: captureDeletePages,
    invert: invertDeletePages,
    invertible: false,
    undo: 'checkpoint',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/** Filler for the newest kind, kept separate for {@link MOVE_SPEC}'s reason. */
const CROP_SPEC = `  cropPages: {
    kind: 'cropPages',
    writer: 'mupdf',
    apply: applyCropPages,
    capture: captureCropPages,
    invert: invertCropPages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/** Filler, kept separate for {@link MOVE_SPEC}'s reason. */
const INSERT_SPEC = `  insertBlankPage: {
    kind: 'insertBlankPage',
    writer: 'mupdf',
    apply: applyInsertBlankPage,
    capture: captureInsertBlankPage,
    invert: invertInsertBlankPage,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/** Filler, kept separate for {@link MOVE_SPEC}'s reason. */
const SWAP_SPEC = `  swapPages: {
    kind: 'swapPages',
    writer: 'mupdf',
    apply: applySwapPages,
    capture: captureSwapPages,
    invert: invertSwapPages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/** Filler for the newest kind, kept separate for {@link MOVE_SPEC}'s reason. */
const DUPLICATE_SPEC = `  duplicatePage: {
    kind: 'duplicatePage',
    writer: 'mupdf',
    apply: applyDuplicatePage,
    capture: captureDuplicatePage,
    invert: invertDuplicatePage,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },`;

/** What a command-table fixture imports: three per command kind. */
const SPEC_IMPORTS = `import {
  applyRotatePages,
  captureRotatePages,
  invertRotatePages,
  applySetLayerVisibility,
  captureSetLayerVisibility,
  invertSetLayerVisibility,
  applyMovePage,
  captureMovePage,
  invertMovePage,
  applyDeletePages,
  captureDeletePages,
  invertDeletePages,
  applyDuplicatePage,
  captureDuplicatePage,
  invertDuplicatePage,
  applySwapPages,
  captureSwapPages,
  invertSwapPages,
  applyInsertBlankPage,
  captureInsertBlankPage,
  invertInsertBlankPage,
  applyCropPages,
  captureCropPages,
  invertCropPages,
} from '@monstera/kernel/engine';`;

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
 * `notBecause` is **required on every reject case**, and `null` is a decision
 * rather than an omission: it says *this diagnostic quotes no other property
 * name that could match spuriously*. Left optional, a case with nothing
 * excludable and a case whose author did not think about it look identical, and
 * only one of those is fine. The runtime check below refuses an undeclared one.
 *
 * @typedef {{
 *   name: string,
 *   expect: 'reject' | 'allow',
 *   source: string,
 *   code?: string,
 *   because?: RegExp,
 *   notBecause?: RegExp | null,
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
import { ok, asDocVersion } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '1.0.0', installChannel: 'development' })),
  'document.open': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.recent': () =>
    Promise.resolve(ok({ entries: [], lastExitClean: true, lastSession: [] })),
  'document.openRecent': () => Promise.resolve(ok({ kind: 'absent' as const })),
  'document.close': () => Promise.resolve(ok({ closed: true })),
  'document.execute': () =>
    Promise.resolve(ok({ version: asDocVersion(1), byteLength: 4096, historyDropped: 0 })),
  'document.undo': () => Promise.resolve(ok({ kind: 'nothing-to-undo' as const })),
  'document.save': () => Promise.resolve(ok({ kind: 'saved' as const, version: asDocVersion(1) })),
  'document.readRange': ({ begin, end }) =>
    Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(end - begin) })),
  'document.viewModel': () =>
    Promise.resolve(ok({ version: asDocVersion(1), pageCount: 1, rotations: [0] })),
  'document.searchPage': () =>
    Promise.resolve(ok({ version: asDocVersion(1), matches: [], truncated: false })),
  'document.pageLinks': () => Promise.resolve(ok({ version: asDocVersion(1), links: [] })),
  'document.destinations': () =>
    Promise.resolve(ok({ version: asDocVersion(1), destinations: [] })),
  'document.layers': () => Promise.resolve(ok({ version: asDocVersion(1), layers: [] })),
  'settings.load': () => Promise.resolve(ok({ stored: {} })),
  'settings.save': () => Promise.resolve(ok({ stored: true as const })),
  'log.reveal': () => Promise.resolve(ok({ revealed: true })),
};
`,
  },
  {
    name: 'a handler map missing a channel does not compile',
    expect: 'reject',
    code: 'TS2741',
    // Anchored on the type it is missing FROM. Without that tail this pattern
    // also matched the client-stub case's diagnostic, which begins with exactly
    // the same words before continuing `…but required in type 'ClientApi…`. The
    // cross-product check found it; the two were never a hand-written pair.
    because:
      /Property ''document\.execute'' is missing in type '\{…\}' but required in type 'Handlers</u,
    notBecause: null,
    // Exactly ONE channel omitted, deliberately. An empty map is missing every
    // channel, and TypeScript then reports TS2739 with a LIST — a diagnostic
    // that names no particular channel and whose code changes the day a second
    // one is declared. Omitting one keeps the failure singular, so the matcher
    // can anchor on the name of the thing that is missing.
    //
    // THAT DAY ARRIVED: `document.open` landed 2026-08-28 and this fixture went
    // from missing one to missing two, turning TS2741 into TS2739 — the exact
    // drift the paragraph above predicted. The repair is the one it prescribes,
    // not a looser code: every channel but one is present, so the failure stays
    // singular. **Every channel added from here owes this fixture a line**, and
    // that cost is what a compile-fail proof buys — `typecheck` cannot see
    // inside a string, which is the whole point and also the whole price.
    source: `
import type { ContractHandlers } from '@monstera/contract';
import { ok, asDocVersion } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '1.0.0', installChannel: 'development' })),
  'document.open': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.recent': () =>
    Promise.resolve(ok({ entries: [], lastExitClean: true, lastSession: [] })),
  'document.openRecent': () => Promise.resolve(ok({ kind: 'absent' as const })),
  'document.close': () => Promise.resolve(ok({ closed: true })),
  'document.undo': () => Promise.resolve(ok({ kind: 'nothing-to-undo' as const })),
  'document.save': () => Promise.resolve(ok({ kind: 'write-failed' as const })),
  'document.readRange': ({ begin, end }) =>
    Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(end - begin) })),
  'document.viewModel': () =>
    Promise.resolve(ok({ version: asDocVersion(1), pageCount: 1, rotations: [0] })),
  'document.searchPage': () =>
    Promise.resolve(ok({ version: asDocVersion(1), matches: [], truncated: false })),
  'document.pageLinks': () => Promise.resolve(ok({ version: asDocVersion(1), links: [] })),
  'document.destinations': () =>
    Promise.resolve(ok({ version: asDocVersion(1), destinations: [] })),
  'document.layers': () => Promise.resolve(ok({ version: asDocVersion(1), layers: [] })),
  'settings.load': () => Promise.resolve(ok({ stored: {} })),
  'settings.save': () => Promise.resolve(ok({ stored: true as const })),
  'log.reveal': () => Promise.resolve(ok({ revealed: true })),
};
`,
  },
  {
    name: 'a handler map with an undeclared channel does not compile',
    expect: 'reject',
    code: 'TS2353',
    // Same shape as its sibling above: anchored on the target type, so it
    // cannot drift into matching another case's diagnostic later.
    because: /''app\.notDeclared'' does not exist in type 'Handlers</u,
    notBecause: null,
    source: `
import type { ContractHandlers } from '@monstera/contract';
import { ok } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '1.0.0', installChannel: 'development' })),
  'app.notDeclared': () => Promise.resolve(ok({})),
};
`,
  },
  {
    name: 'a handler returning the wrong result shape does not compile',
    expect: 'reject',
    code: 'TS2322',
    // Anchored INSIDE the Result — `value.version`, not `version`. A handler
    // returns `Result<T, …>` rather than `T`, so the payload's own fields are
    // one level down and a matcher anchored at the top level would pass on the
    // outer "not assignable to Result" line, which every wrong shape produces.
    because: /The types of 'value\.version' are incompatible/u,
    // `installChannel` is quoted in the summary and is not the reason.
    notBecause: /installChannel/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
import { ok } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: 1, installChannel: 'development' })),
};
`,
  },
  {
    name: 'a handler returning an undeclared enum member does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /The types of 'value\.installChannel' are incompatible/u,
    notBecause: /'version'/u,
    source: `
import type { ContractHandlers } from '@monstera/contract';
import { ok } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '1.0.0', installChannel: 'beta' })),
};
`,
  },
  {
    name: 'a handler may not report a failure its channel did not declare',
    expect: 'reject',
    code: 'TS2322',
    // `app.info` declares no failure codes, so `DeclaredFailure<never>` is
    // uninhabited and its handler can only succeed. `internal` is the sharpest
    // thing to try here: it is the one code that exists on every channel, and a
    // handler still may not produce it — it means "a diagnostic was withheld",
    // and a handler has nowhere to withhold one to (ADR-0009, 2026-08-19).
    because: /Type 'string' is not assignable to type 'never'/u,
    notBecause: null,
    source: `
import type { ContractHandlers } from '@monstera/contract';
import { err } from '@monstera/shared';
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(err({ code: 'internal' })),
};
`,
  },
  {
    name: 'a client stub missing a channel does not compile',
    expect: 'reject',
    code: 'TS2741',
    // STOPS AT THE TYPE CONSTRUCTOR, as its handler sibling above already did.
    // It used to require `'ClientApi<{…}>'` with the closing bracket, and that
    // broke the day `document.undo` landed — not because the reason changed,
    // but because the dump grew past tsc's printer limit and was TRUNCATED, so
    // the elision pass that handles truncation consumed the `>` along with the
    // content it replaced.
    //
    // Matching the bracket was asserting a property of tsc's line-length
    // budget. What this case is about is which type demanded the member, and
    // `ClientApi<` pins that exactly. The depth control below is untouched and
    // is what still fires if elision stops handling nesting.
    because: /Property ''document\.execute'' is missing in type '\{…\}' but required in type 'ClientApi</u,
    // THE NESTED-DUMP CONTROL, and it needed no synthetic fixture — this
    // diagnostic already nests: `ClientApi<{ … Channel<ZodObject<{ … }>> }>`.
    // Collapsing only the innermost level leaves `installChannel` visible in
    // the reason text, so this fires the moment the elision stops handling
    // depth.
    notBecause: /installChannel/u,
    // This is what keeps the browser shim honest. A shim that has drifted from
    // the contract would otherwise pass its own tests while proving nothing
    // about the real application.
    // One channel short, for the same reason as its handler sibling: an empty
    // stub is missing every channel and TypeScript reports a LIST under a
    // different code, naming nothing in particular. `document.open` is present
    // here for that reason and not as decoration — see the handler fixture for
    // what happened the day it landed.
    source: `
import type { ContractClient } from '@monstera/contract';
import { ok, asDocVersion } from '@monstera/shared';
export const shim: ContractClient = {
  'app.info': () => Promise.resolve(ok({ version: '1.0.0', installChannel: 'development' })),
  'document.open': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.recent': () =>
    Promise.resolve(ok({ entries: [], lastExitClean: true, lastSession: [] })),
  'document.openRecent': () => Promise.resolve(ok({ kind: 'absent' as const })),
  'document.close': () => Promise.resolve(ok({ closed: true })),
  'document.undo': () => Promise.resolve(ok({ kind: 'nothing-to-undo' as const })),
  'document.save': () => Promise.resolve(ok({ kind: 'write-failed' as const })),
  'document.readRange': () =>
    Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(0) })),
  'document.viewModel': () =>
    Promise.resolve(ok({ version: asDocVersion(1), pageCount: 1, rotations: [0] })),
  'document.searchPage': () =>
    Promise.resolve(ok({ version: asDocVersion(1), matches: [], truncated: false })),
  'document.pageLinks': () => Promise.resolve(ok({ version: asDocVersion(1), links: [] })),
  'document.destinations': () =>
    Promise.resolve(ok({ version: asDocVersion(1), destinations: [] })),
  'document.layers': () => Promise.resolve(ok({ version: asDocVersion(1), layers: [] })),
  'settings.load': () => Promise.resolve(ok({ stored: {} })),
  'settings.save': () => Promise.resolve(ok({ stored: true as const })),
  'log.reveal': () => Promise.resolve(ok({ revealed: true })),
};
`,
  },
  {
    name: 'a renderer type may not hold a filesystem path where a handle is required',
    expect: 'reject',
    code: 'TS2322',
    // The brand's structure lives inside a type dump and is elided, so the
    // anchor is the summary's named type — which survives because a name is not
    // a dump. A case whose only evidence were inside the braces would need a
    // different case, not a relaxed matcher.
    because: /Type 'string' is not assignable to type 'FileHandle'/u,
    notBecause: null,
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
  // Finding IIII-1. `describeEngineHostGone` decides whether a host death reads
  // as a fault with ONE comparison against a string literal, so the parameter
  // being a declared union rather than `{ code: string }` is the whole of what
  // makes that comparison checkable. This is not testable at runtime: a
  // misspelt code produces a perfectly well-formed ShellFailure carrying the
  // wrong sentence, and no assertion about the returned object distinguishes a
  // typo from a genuine crash report.
  // ---------------------------------------------------------------------------
  {
    name: 'a termination code the runtime does not declare is refused',
    expect: 'reject',
    // TS2820 rather than TS2345, and the difference is the point: 2820 is the
    // SPELLING-SUGGESTION diagnostic. Against the union the compiler answers
    // `Did you mean '"shutdown"'?` — which is precisely the check a structural
    // `{ code: string }` deleted, and it is worth anchoring on the code that
    // says so rather than on a generic argument mismatch.
    code: 'TS2820',
    // Anchored on the literal that was misspelt AND on the member it failed to
    // match, so this cannot be satisfied by an unrelated argument error in the
    // same call — the failure has to be about the code's VALUE.
    because: /Type '"shutdow"' is not assignable to type/u,
    // The word `detail` appears in the same object literal and is correct here;
    // excluding it stops a diagnostic about the other property standing in.
    notBecause: /detail/u,
    source: `
import { describeEngineHostGone } from '@monstera/desktop';
export const failure = describeEngineHostGone({ code: 'shutdow', detail: 'we closed it' });
`,
  },
  {
    name: 'a declared termination code still compiles',
    expect: 'allow',
    // THE CONTROL, and it is the half that matters here. A parameter that
    // rejected everything would satisfy the case above while breaking the
    // caller — and the caller is `onEngineHostEnded`, which passes a real
    // `HostTermination` and is the only thing that ever calls this.
    source: `
import { describeEngineHostGone } from '@monstera/desktop';
export const failure = describeEngineHostGone({ code: 'shutdown', detail: 'we closed it' });
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
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
};
`,
  },
  {
    name: 'a spec table missing a command kind does not compile',
    expect: 'reject',
    code: 'TS2741',
    // THE NEWEST KIND IS THE ONE OMITTED, and that is a strengthening rather
    // than bookkeeping. This fixture was `{}` while one command existed, which
    // asks whether an EMPTY table compiles — a question no real commit poses.
    // Omitting the newest kind from an otherwise complete table is what
    // actually happens when a command is added, and it is what §6 exists to
    // catch.
    //
    // SO IT MOVES WITH EACH NEW COMMAND, deliberately: adding one makes this
    // case fail with the wrong property name until the table is filled in and
    // the regex advanced, which is the reminder that a kind was added and the
    // table has to grow. `cropPages`, `insertBlankPage`, `swapPages`,
    // `duplicatePage` and `deletePages` on 2026-09-04, `movePage` on
    // 2026-09-03, `setLayerVisibility` before.
    because:
      /Property 'cropPages' is missing in type '\{…\}' but required in type 'CommandSpecs'/u,
    notBecause: null,
    // §6: omit a kind and it does not compile. This is the case that makes the
    // table exhaustive by construction rather than by review.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
};
`,
  },
  {
    name: 'a spec table with an unrouted command kind does not compile',
    expect: 'reject',
    code: 'TS2353',
    because: /'notDeclared' does not exist in type 'CommandSpecs'/u,
    notBecause: /rotatePages|setLayerVisibility|movePage/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
  notDeclared: {
    kind: 'notDeclared',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
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
    because: /is missing the following properties from type '\{…\}': reproducible, replay/u,
    notBecause: /invertible/u,
    // §3a exists BEFORE any command does, because retrofitting it rewrites the
    // log rather than extending it. A spec that forgets the axis is the
    // retrofit arriving one command at a time.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: true,
    undo: 'inverse',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
};
`,
  },
  {
    name: 'a spec that omits the invertibility axis does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /is missing the following properties from type '\{…\}': invertible, undo/u,
    notBecause: /reproducible/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    reproducible: true,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
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
    notBecause: /reproducible/u,
    // §3a's sentence AS A TYPE: a command that cannot reproduce itself records
    // its EFFECT, and replay re-applies the stored effect rather than re-running
    // the operation. Declaring the axis without its consequence is what this
    // forbids — signing, OCR and AI all land here.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: true,
    undo: 'inverse',
    reproducible: false,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
};
`,
  },
  {
    name: 'a non-invertible spec claiming inverse undo does not compile',
    expect: 'reject',
    code: 'TS2322',
    because: /Types of property 'undo' are incompatible/u,
    notBecause: /invertible/u,
    // §4 spends this: a non-invertible command without a checkpoint is
    // unrepresentable. Letting `invertible: false` sit beside `undo: 'inverse'`
    // is how a checkpoint quietly becomes optional.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
${SPEC_IMPORTS}
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    capture: captureRotatePages,
    invert: invertRotatePages,
    invertible: false,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
${LAYER_SPEC}
${MOVE_SPEC}
${DELETE_SPEC}
${DUPLICATE_SPEC}
${SWAP_SPEC}
${INSERT_SPEC}
${CROP_SPEC}
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
import { applyRotatePages, captureRotatePages, invertRotatePages } from '@monstera/kernel/engine';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'mupdf',
  apply: applyRotatePages,
  capture: captureRotatePages,
  invert: invertRotatePages,
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
    //
    // The member ORDER in the printed union is the compiler's and not ours, and
    // it moves when the COMMAND UNION changes even though this command's own
    // type does not: `1 | 3 | 2` while `rotatePages` was the only kind, then
    // `2 | 3 | 1` with `setLayerVisibility`, now `3 | 1 | 2` with `movePage`
    // (all measured, TypeScript 6.0.3, the last on 2026-09-03).
    //
    // Anchoring on the printed order is deliberate — an order-insensitive
    // pattern would also match a union this command's type never had — and the
    // cost is stated rather than discovered: this line is edited by every
    // commit that adds a command kind, and the edit is loud.
    because: /Type '45' is not assignable to type '3 \| 1 \| 2'/u,
    // Atomic and scalar: the quoted types are `45` and the literal union, so
    // there is no second property name in reach.
    notBecause: null,
    // MuPDF stores /Rotate 45 verbatim (ADR-0006), so a degrees-typed command
    // would let an arbitrary angle reach the page tree. Making the wire type
    // incapable of carrying 45 means nothing downstream has to reject one.
    source: `
import type { Command } from '@monstera/contract';
export const command: Command = { kind: 'rotatePages', pages: [0], quarterTurns: 45 };
`,
  },
  {
    name: 'a spec may not declare one writer and supply the apply of ANOTHER',
    expect: 'reject',
    code: 'TS2322',
    // §6's binding, and the case that makes it real. `writer` and `apply` are
    // one indivisible choice (`WriterBinding`), not two independent fields —
    // otherwise a spec could declare `pdf-lib` and hand it MuPDF's handler, and
    // the B3 violation would be a review comment instead of a compile error.
    //
    // Anchored on the PROPERTY, not on the session mismatch beneath it. The
    // deeper line — `ByteImage is not assignable to MupdfSession` — is
    // identical for the capture case below, and the cross-product check caught
    // exactly that when both were first written: one matcher accepting the
    // other's diagnostic means neither verdict distinguishes them.
    because: /Types of property 'apply' are incompatible/u,
    // None, and the reason is worth stating rather than leaving as a bare null.
    // The name you would expect to be confusable is the DECLARED writer,
    // `pdf-lib` — and it does not appear at all, because it is a value whose
    // literal type never enters the assignability chain. `rotatePages` does
    // survive elision, via `CommandSpec<"rotatePages">`, but it is the command
    // this spec is for rather than a name in reach of the wrong matcher; the
    // cross-product check is what guards that, and it runs regardless.
    notBecause: null,
    // `capture` is CORRECT for pdf-lib here on purpose, so `apply` is the only
    // thing wrong and the diagnostic is about the binding rather than about a
    // missing field.
    source: `
import type { ByteImage, CommandSpec } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel/engine';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'pdf-lib',
  apply: applyRotatePages,
  capture: () => Promise.resolve({ captured: false, reason: 'stub' }),
  invert: (image: ByteImage) => Promise.resolve(image),
  invertible: true,
  undo: 'inverse',
  reproducible: true,
  replay: 'reapply-intent',
};
`,
  },
  {
    name: 'CONTROL: the same spec compiles when the apply matches the declared writer',
    expect: 'allow',
    // Without this, the case above is satisfied by a `CommandSpec` that rejects
    // every byte-image writer for some unrelated reason — "declaring pdf-lib is
    // impossible" and "declaring pdf-lib binds a byte-image apply" would look
    // identical, and only one of them is §6.
    source: `
import type { ByteImage, CommandSpec } from '@monstera/kernel';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'pdf-lib',
  apply: (image: ByteImage) => Promise.resolve(new Uint8Array(image)),
  capture: () => Promise.resolve({ captured: false, reason: 'stub' }),
  invert: (image: ByteImage) => Promise.resolve(image),
  invertible: true,
  undo: 'inverse',
  reproducible: true,
  replay: 'reapply-intent',
};
`,
  },
  {
    name: 'THE SEAM EXPRESSES A BYTE-IMAGE WRITER, with no type assertion',
    expect: 'allow',
    // S-2's control, and the entire evidence for "the seam expresses both
    // writer shapes". Exactly one adapter is implemented — the live-session
    // one, which is what the first command needs — so the byte-image side has
    // nothing behind it, and an unimplemented variant nobody constructs is a
    // vacuous check.
    //
    // NO `as`, NO `any`, NO `satisfies` escape. `any` is already banned by B7;
    // an assertion is not, and a fixture that compiles because of a cast proves
    // the cast works rather than that the type expresses the shape. If this
    // ever needs one, the type does not express it — and that is the finding.
    //
    // Three of the four writers of record consume and produce whole byte
    // images, so this failing is Stage 4 discovering a seam redesign.
    source: `
import type { ByteImage, Apply, EngineWriter } from '@monstera/kernel';

// Lifecycle: for a byte-image writer the session IS the image, so open and
// serialise are identity and nothing is retained by the engine.
export const writer: EngineWriter<ByteImage> = {
  open: (image: ByteImage) => Promise.resolve(image),
  serialise: (session: ByteImage) => Promise.resolve(session),
  close: () => Promise.resolve(),
};

// And the shape difference: consumes an image, PRODUCES a new one. A seam
// modelled only on live-session operations cannot type this — the signature
// would demand a void return and mutation in place.
export const rotate: Apply<'pdf-lib', 'rotatePages'> = (image, command) =>
  Promise.resolve(command.pages.length === 0 ? image : new Uint8Array(image));
`,
  },
  {
    name: 'a byte-image writer may not mutate in place and return void',
    expect: 'reject',
    code: 'TS2322',
    // The other half. Without this the case above passes for a seam whose
    // `Apply` ignores the writer entirely — both shapes would be assignable to
    // one signature, and "expresses both" would mean "distinguishes neither".
    //
    // Anchored on the PARAMETER NAME, because Decision 10's `CommandExecution`
    // produces a diagnostic whose second line is identical to this one. The
    // harness caught that itself on the day the second case was written: two
    // matchers that accept each other's reason certify neither.
    because: /\(image: ByteImage, command: [\s\S]*Type 'void' is not assignable to type 'Promise<ByteImage>'/u,
    notBecause: null,
    source: `
import type { Apply, ByteImage } from '@monstera/kernel';
export const rotate: Apply<'pdf-lib', 'rotatePages'> = (_image: ByteImage) => {};
`,
  },
  {
    name: 'AND EXECUTION EXPRESSES IT TOO, with no type assertion (Decision 10)',
    expect: 'allow',
    // The same argument as the case above, one layer on. ADR-0023 Decision 10
    // restates `Apply`'s shape asymmetry on `CommandExecution`, and a restated
    // conditional is a second place it can be got wrong — a `CommandExecution`
    // whose `apply` returned void for every writer would satisfy every use this
    // repository has today, because `mupdf` is the only writer with an adapter
    // and it is the live-session one.
    //
    // So the byte-image side needs its own fixture for the reason the seam's
    // does: an unimplemented variant nobody constructs is a vacuous check. NO
    // `as`, NO `any`, NO `satisfies` escape — if this needs one, the interface
    // does not express the shape and that is the finding.
    source: `
import type { ByteImage, CommandExecution } from '@monstera/kernel';

// A byte-image writer's execution: apply and invert CONSUME an image and
// PRODUCE a new one. Capture is the same shape for both kinds, because
// capture only ever reads.
export const execution: CommandExecution<'pdf-lib'> = {
  // The DISCRIMINANT, not a per-kind field. CommandOfKind<K> for an
  // uninstantiated K is the correlated-union limit: no member of the
  // distributed union carries every member's fields, so only the discriminant
  // is reachable here. This read the rotation's own pages while one command
  // kind existed, which compiled for the same reason it now does not.
  apply: (image, command) =>
    Promise.resolve(command.kind === 'rotatePages' ? new Uint8Array(image) : image),
  capture: (_image, _command) => Promise.resolve({ captured: false, reason: 'none' }),
  invert: (image, _kind, _inverse) => Promise.resolve(new Uint8Array(image)),
};
`,
  },
  {
    name: "a byte-image writer's EXECUTION may not return void either",
    expect: 'reject',
    code: 'TS2322',
    // The other half, and it is not covered by the `Apply` pair above: this is
    // a separate conditional in a separate file, so a version of it that
    // ignored the writer would leave the allow-case passing while
    // distinguishing nothing.
    //
    // Anchored on `session:` where the seam's pair anchors on `image:` — the
    // two diagnostics agree line for line otherwise, and the harness refuses to
    // certify either verdict while one matcher accepts the other's reason.
    because: /\(session: ByteImage, command: [\s\S]*Type 'void' is not assignable to type 'Promise<ByteImage>'/u,
    notBecause: null,
    source: `
import type { ByteImage, CommandExecution } from '@monstera/kernel';

export const execution: Pick<CommandExecution<'pdf-lib'>, 'apply'> = {
  apply: (_image: ByteImage) => {},
};
`,
  },
  {
    name: 'a live-session apply may not be handed another engine session',
    expect: 'reject',
    code: 'TS2345',
    // §6's B3 binding: a spec's apply is bound to the session type of its
    // DECLARED writer, so naming one engine and reaching for another's handle
    // is a type error at the point of authoring rather than a review comment.
    because: /'PdfiumSession' is not assignable to parameter of type 'MupdfSession'/u,
    notBecause: null,
    source: `
import type { Apply, MupdfSession, PdfiumSession } from '@monstera/kernel';
declare const apply: Apply<'mupdf', 'rotatePages'>;
declare const foreign: PdfiumSession;
declare const command: { kind: 'rotatePages'; pages: number[]; quarterTurns: 1 };
declare const own: MupdfSession;
export const ok = apply(own, command);
export const bad = apply(foreign, command);
`,
  },
  {
    name: 'AN INVERSE CANNOT SEE THE COMMAND, so it cannot be computed from intent',
    expect: 'reject',
    code: 'TS2554',
    // §3's finding as a signature. An inverse that could read the command could
    // reverse the intent — rotate back by the same quarter turns — and that is
    // the one implementation §3 forbids: it cannot delete a key to restore an
    // inheriting page, and it cannot restore a raw 45 unnormalised.
    //
    // The type does not merely omit the command; supplying one is an error, so
    // the wrong shape is unwritable rather than undocumented.
    because: /Expected 2 arguments, but got 3/u,
    notBecause: null,
    source: `
import type { Invert } from '@monstera/kernel';
declare const invert: Invert<'mupdf', 'rotatePages'>;
declare const session: Parameters<typeof invert>[0];
declare const prior: Parameters<typeof invert>[1];
export const undone = invert(session, prior, { kind: 'rotatePages', pages: [0], quarterTurns: 1 });
`,
  },
  {
    name: 'CONTROL: the inverse takes prior state, and that compiles',
    expect: 'allow',
    // Without it the case above is satisfied by an `Invert` that takes no
    // usable arguments at all — "cannot be called with a command" and "cannot
    // be called" are different claims and only one of them is §3.
    source: `
import type { Invert, MupdfSession, PriorPageRotation } from '@monstera/kernel';
export const invert: Invert<'mupdf', 'rotatePages'> = (
  _session: MupdfSession,
  _prior: readonly PriorPageRotation[],
) => Promise.resolve();
`,
  },
  {
    name: 'THE READABLE LOG IS NOT THE WRITABLE ONE',
    expect: 'reject',
    code: 'TS2739',
    // §4 gives the log one writer, and it is the same component that owns the
    // counter — so it is the same capability, not a second one. An entry
    // recorded without an applied command makes undo reverse a change the
    // document never received.
    //
    // Asserted on the VIEW rather than on the accessor's arity, and the
    // cross-product check is why: `context.commandLog()` and
    // `context.bumpVersion()` both produce *Expected 1 arguments, but got 0*,
    // so two cases would have had one indistinguishable reason between them.
    // This asks a stronger question anyway — whether `log` is genuinely
    // narrower than the guarded accessor, or merely a second name for it.
    // `trimTo` joins the mutating half here, and it belongs there: it discards
    // entries and moves the cursor, which is exactly what the readable view is
    // separated from.
    because:
      /missing the following properties from type 'CommandLog': #private, trimTo, record, undo, redo/u,
    notBecause: null,
    source: `
import type { CommandLog, DocumentContext } from '@monstera/kernel';
export const mutate = (context: DocumentContext): CommandLog => context.log;
`,
  },
  {
    name: 'CONTROL: but it may ASK the log, without any capability at all',
    expect: 'allow',
    // The half that must stay open. "Is there anything to undo" is a fair
    // question for any work running in the lane, and a narrowing that closed it
    // would push callers towards holding the mutable log for a query — which is
    // how a capability gets handed around until it means nothing.
    source: `
import type { DocumentContext } from '@monstera/kernel';
export const askable = (context: DocumentContext) =>
  context.log.canUndo && context.log.entries.length > 0 && context.log.redoDepth === 0;
`,
  },
  {
    name: 'A LANE ENTRY CANNOT BUMP THE VERSION, because it cannot obtain the capability',
    expect: 'reject',
    code: 'TS2554',
    // ADR-0009 §5's writer of record, as a capability rather than an intention.
    // `bumpVersion` sat on the context reachable by any lane entry, with the
    // narrowing recorded in the ADR as something that would happen when the bus
    // landed — and an intention is what a property has just before it acquires
    // a second writer (B3).
    //
    // This is the ordinary lane entry, calling it the way it used to.
    because: /Expected 1 arguments, but got 0/u,
    notBecause: null,
    source: `
import type { DocumentContext } from '@monstera/kernel';
export const work = (context: DocumentContext) => context.bumpVersion();
`,
  },
  {
    name: 'CONTROL: and it compiles for a holder of the capability',
    expect: 'allow',
    // Without this the case above is satisfied by a `bumpVersion` that cannot
    // be called at all — "narrowed to one writer" and "removed" are different
    // claims, and only the first is §5.
    source: `
import type { CommandWriter, DocumentContext } from '@monstera/kernel';
export const work = (context: DocumentContext, writer: CommandWriter) =>
  context.bumpVersion(writer);
`,
  },
  {
    name: 'NOTHING OUTSIDE THE BUS CAN MINT A CHECKPOINT',
    expect: 'reject',
    code: 'TS2322',
    // §4: the checkpoint is taken by the bus, in one code path, NEVER by a
    // handler. That has to be structural — a rule survives exactly as long as
    // everyone remembers it, and this one is remembered at the moment someone
    // is writing a handler that would find a checkpoint convenient.
    //
    // The brand is the mechanism, and the mint is module-private to
    // `commandBus.ts`. This is the door held shut, tested from outside.
    because: /Type 'Uint8Array<ArrayBuffer>' is not assignable to type 'Checkpoint'/u,
    notBecause: null,
    source: `
import type { Checkpoint } from '@monstera/kernel';
export const forged: Checkpoint = new Uint8Array([1, 2, 3]);
`,
  },
  {
    name: 'a log entry may not be invertible AND carry a checkpoint',
    expect: 'reject',
    code: 'TS2353',
    // §4's two shapes as a type: an entry is one or the other, never both. An
    // invertible entry carrying a checkpoint is the memory behaviour §4
    // rejected — a byte snapshot per command — arriving as an accident.
    because: /'checkpoint' does not exist in type/u,
    notBecause: null,
    source: `
import type { Checkpoint, LogEntry } from '@monstera/kernel';
declare const checkpoint: Checkpoint;
export const entry: LogEntry = {
  kind: 'invertible',
  command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
  inverse: [{ page: 0, prior: { present: false } }],
  checkpoint,
};
`,
  },
  {
    name: 'AN INVERTIBLE DELETE IS UNREPRESENTABLE, because its prior state is never',
    expect: 'reject',
    code: 'TS2322',
    // B5 rather than a runtime check, and there is no runtime check anywhere
    // for it. `CommandPrior['deletePages']` is `never` — a deleted page's prior
    // state is its object graph, which is document-scaled and has no
    // serialisable form — so `LogEntryFor<'deletePages'>`'s invertible member
    // cannot be constructed and `CaptureResult<never>` can only report refusal.
    //
    // WITHOUT THIS CASE the property rests on a comment. A later hand widening
    // `never` to something serialisable would put unbudgeted document-scaled
    // bytes in the log, where `retainedBytes` counts checkpoints only and would
    // under-report by exactly that amount — in the direction nobody notices.
    because: /Type '\{…\}' is not assignable to type 'never'/u,
    notBecause: null,
    // `LogEntryFor<'deletePages'>` and NOT the collapsed `LogEntry`. Against
    // the union TypeScript reports an excess-property mismatch on `inverse`
    // measured against every kind's prior state at once, which is a true
    // diagnostic about the wrong thing — it would still fire if this kind's
    // prior state were an ordinary object. Naming the kind is what puts `never`
    // in the message.
    source: `
import type { LogEntryFor } from '@monstera/kernel';
export const entry: LogEntryFor<'deletePages'> = {
  kind: 'invertible',
  command: { kind: 'deletePages', pages: [1] },
  inverse: { pages: [1] },
};
`,
  },
  {
    name: 'a TERMINAL entry may not be built without a checkpoint',
    expect: 'reject',
    code: 'TS2322',
    // The other half, and the one §4 names: "a non-invertible command without a
    // checkpoint is unrepresentable". Without this case the type above would be
    // satisfied by an entry union that simply made every field optional.
    because: /Property 'checkpoint' is missing in type '\{…\}' but required in type '\{…\}'/u,
    notBecause: null,
    source: `
import type { LogEntry } from '@monstera/kernel';
export const entry: LogEntry = {
  kind: 'terminal',
  command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
  reason: 'no prior state',
};
`,
  },
  {
    name: 'a spec may not declare one writer and CAPTURE through another',
    expect: 'reject',
    code: 'TS2322',
    // The capture half of §6's binding. `apply` already had this case; without
    // its twin, a spec could declare `pdf-lib` and read prior state through a
    // MuPDF session — the same B3 violation through the read path. Anchored on
    // the property for the reason recorded on the `apply` case above.
    because: /Types of property 'capture' are incompatible/u,
    notBecause: null,
    source: `
import type { ByteImage, CommandSpec } from '@monstera/kernel';
import { captureRotatePages } from '@monstera/kernel/engine';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'pdf-lib',
  apply: (image: ByteImage) => Promise.resolve(new Uint8Array(image)),
  // Bound to MuPDF, declared pdf-lib. The read path's B3 violation.
  capture: captureRotatePages,
  invertible: true,
  undo: 'inverse',
  reproducible: true,
  replay: 'reapply-intent',
};
`,
  },
  {
    name: 'a command missing a required parameter does not compile',
    expect: 'reject',
    code: 'TS2741',
    because: /^Property 'quarterTurns' is missing/u,
    // THE CONTROL FOR `diagnose`'s ATOMIC BRANCH, which is the half that had
    // none. An atomic diagnostic has no continuation, so its reason IS the
    // summary with the location prefix stripped — the summary folded back in by
    // construction. Every atomic case that existed anchored on `{}` or on a
    // scalar, so no second property name was ever in reach to match
    // spuriously, and the exclusion mechanism was proven for half the code.
    //
    // This one quotes `{ kind: "rotatePages"; pages: number[]; }`, so `pages`
    // is present in the line and is NOT the reason.
    notBecause: /pages/u,
    // ONE MEMBER, not the union, and the reason is the property this case
    // exists for. Written `Command`, the assignment was atomic while
    // `rotatePages` was the only kind; against a two-member union the compiler
    // answers TS2322 with a continuation, and the atomic branch would have
    // lost its only control silently. Naming the member keeps the diagnostic
    // atomic by construction rather than by how many commands exist today.
    source: `
import type { CommandOfKind } from '@monstera/contract';
export const partial: CommandOfKind<'rotatePages'> = { kind: 'rotatePages', pages: [0] };
`,
  },
  {
    name: 'and against the UNION it is refused too, with the continuation the union produces',
    expect: 'reject',
    code: 'TS2322',
    // The shape a caller actually writes, and it is a different diagnostic from
    // the case above rather than the same one: assigning to a union reports the
    // assignment and names the missing property in its continuation. Both
    // matter — the atomic one proves `diagnose` folds a summary back in, this
    // one proves the union still refuses an incomplete member.
    // ANCHORED ON THE ASSIGNMENT LINE, which is the whole difference between
    // this case and the one above: both reasons name `quarterTurns`, and the
    // union's does so in a CONTINUATION under a summary the atomic one has no
    // equivalent of. Matching the missing property alone accepts both, which
    // the harness's own resolution test refuses.
    // ONE ELIDED MEMBER PER COMMAND KIND, so this pattern widens with the union
    // — two while `rotatePages` and `setLayerVisibility` were the whole of it,
    // three since `movePage` (2026-09-03), eight since `deletePages`,
    // `duplicatePage`, `swapPages`, `insertBlankPage` and `cropPages`
    // (2026-09-04).
    //
    // A COUNTED REPETITION, `{7}`, and it is not the repetition-insensitive
    // spelling this comment used to warn against. `(\{…\} \| )+` matches a
    // union of ANY size, including one this type never had; `{7}` matches
    // exactly eight members and nothing else, so the case still fails the day a
    // command is added and still has to be edited. What it drops is eight
    // hand-written copies of the same four characters, which had started to be
    // the thing a reader checked instead of the count.
    because:
      /^Type '\{…\}' is not assignable to type '\{…\}(?: \| \{…\}){7}'/u,
    // Nothing to exclude: the harness elides every quoted type, so no second
    // property name is in reach of this reason.
    notBecause: null,
    source: `
import type { Command } from '@monstera/contract';
export const partial: Command = { kind: 'rotatePages', pages: [0] };
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
 * ## Skipping the first line is NOT the rule, and that was the sharper finding
 *
 * The obvious fix — treat the indented continuation as the reason and drop the
 * summary — is wrong twice over. **Continuations quote types too**, and an
 * atomic diagnostic has no continuation at all, so its reason would be the
 * summary with only a prefix removed: the summary folded straight back in, by
 * construction, on the path that has no other guard. Measured, both on the
 * reason path:
 *
 * ```
 * Property 'quarterTurns' is missing in type '{ kind: "rotatePages"; pages: number[]; }' …
 * Type '{ … invertible: true; undo: "inverse"; }' is missing the following properties … : reproducible, replay
 * ```
 *
 * So the rule is not about *which line*. It is that **a type dump is never
 * evidence, wherever it appears**. Brace contents are elided from the whole
 * diagnostic, leaving its prose: names quoted in prose survive because they are
 * the reason, names visible only because a type was printed do not. With dumps
 * gone the summary is safe to keep, which is why there is no line-based branch
 * here to get wrong.
 *
 * One consequence worth knowing: a case whose only evidence lives *inside* a
 * dump has nothing to anchor on and needs a different case, not a relaxed
 * matcher. `FileHandle`'s brand is the near miss — the summary names the type
 * directly, so it survives elision.
 *
 * @param {string} output
 * @returns {{ heads: string[], reason: string }}
 */
function diagnose(output) {
  const lines = output.split('\n').filter((line) => line.trim() !== '');
  const heads = lines.filter((line) => /^\S.*error TS\d+/u.test(line));
  const message = lines.join('\n').replace(/^.*?error TS\d+:\s*/u, '');

  return { heads, reason: elideTypeDumps(message) };
}

/**
 * A brace-free stand-in used while collapsing dumps. See {@link elideTypeDumps}.
 *
 * NUL, because no compiler diagnostic can contain one.
 *
 * **Constructed numerically, never written as a literal.** A raw NUL in this
 * file makes it binary to git and to grep: diffs stop rendering and searches
 * skip it. That is not hypothetical — this constant was a literal NUL for one
 * commit, and it is what surfaced the guard gap that let it through
 * (`findControlCharacter` had delegated NUL to a check that reads only the
 * first 8000 bytes).
 *
 * `String.fromCharCode(0)` also sidesteps a second trap, met while fixing the
 * first: a backslash-u-0000 escape is one backslash away from the SIX-CHARACTER
 * text of the same name, and the two are indistinguishable at a glance in a
 * diff. Writing the intent as arithmetic removes the question — and no escape
 * for a control character appears anywhere in this file, deliberately.
 */
const DUMP_SENTINEL = String.fromCharCode(0);

/**
 * Collapses every `{ … }` — **at every level** — to a single `{…}`.
 *
 * ## Why this is not a one-line replace to a fixed point
 *
 * Substituting `{…}` directly reintroduces braces, so `[^{}]*` can never span
 * the placeholder and the enclosing level never matches. The loop then reaches
 * a fixed point that looks like completion while having collapsed only the
 * innermost level. Measured:
 *
 * ```
 * in        Type '{ outer: { inner: 1 }; sibling: 2 }' …
 * naive     Type '{ outer: {…}; sibling: 2 }' …        <- outer, sibling survive
 * this      Type '{…}' …
 * ```
 *
 * `outer` and `sibling` surviving is precisely what "a type dump is never
 * evidence" forbids, and **this is live rather than hypothetical**: the client
 * stub's diagnostic nests `ClientApi<{ … Channel<ZodObject<{ … }>> }>`, so
 * `version` and `installChannel` reach the reason text under the naive form.
 * A terminating fixed-point loop is a convincing shape for a job half done.
 *
 * So the collapse targets a **brace-free sentinel**, iterates to the fixed
 * point, and restores once at the end. Flat inputs produce byte-identical
 * output either way, which is why existing patterns keep matching.
 *
 * @param {string} text
 * @returns {string}
 */
function elideTypeDumps(text) {
  if (text.includes(DUMP_SENTINEL)) {
    // A sentinel already present would be restored as a dump that was never
    // there, corrupting the very evidence this function exists to clean.
    throw new Error(
      'Diagnostic text already contains the elision sentinel, so restoring it would ' +
        'invent a type dump. Choose a different sentinel rather than trusting the input.',
    );
  }

  let previous = text;
  for (;;) {
    const next = previous.replace(/\{[^{}]*\}/gu, DUMP_SENTINEL);
    if (next === previous) break;
    previous = next;
  }

  // A dump tsc TRUNCATED has no closing brace, so the balanced pass above
  // cannot see it and leaves the whole thing standing as ordinary text. Found
  // the day a spec type grew past the printer's limit: the diagnostic read
  // `Type '{ kind: "rotatePages"; ... re...' is not assignable` and every
  // property name in it became matchable evidence again — the exact defect the
  // depth fix closed, in a shape it did not cover.
  //
  // The truncation always ends in `...` immediately before the closing quote,
  // which is what makes this matchable without guessing at the content.
  previous = previous.replace(/\{[^{}]*\.\.\.(?=')/gu, DUMP_SENTINEL);

  // A THIRD SHAPE, found 2026-09-04 when the spec table reached six commands:
  // tsc dropped the closing brace with NO trailing `...` at all, leaving
  // `Type '{ rotatePages: ␀; … duplicatePage: ␀' is not assignable`. The
  // balanced pass cannot see it — there is no closing brace — and the pass
  // above requires the ellipsis, so every property name in it was matchable
  // again.
  //
  // The anchor is the same one that made the previous pass safe: an unclosed
  // brace run ending at the closing quote of a quoted type. `[^{}]*` cannot
  // cross into a neighbouring dump, and prose in a tsc diagnostic does not open
  // a brace it never closes.
  //
  // Two truncation shapes in one file is the tell that this list grows with the
  // COMPILER rather than with the code, which is why the refusal below stays a
  // refusal: an eliser that degraded quietly on the fourth shape would hand
  // every matcher printed type text and read exactly like this one working.
  //
  // LAZY, and the greedy spelling was written first and measured wrong: with
  // `*` the run swallowed the closing quote and continued to the LAST quote in
  // the message, eating `but required in type 'CommandSpecs'` — the anchor the
  // case under it depends on. A pass that removes too much reads exactly like
  // one that removes the right amount, because both leave no braces behind.
  //
  // Looped for the balanced pass's reason: an outer unclosed run only becomes
  // brace-free once the inner one has gone.
  for (;;) {
    const next = previous.replace(/\{[^{}]*?(?=')/gu, DUMP_SENTINEL);
    if (next === previous) break;
    previous = next;
  }

  // Anything still carrying a brace is a dump form neither pass understands,
  // and treating it as evidence is the whole defect. REFUSE rather than
  // degrade: an instrument that silently half-works is what S-1 was.
  if (/[{}]/u.test(previous)) {
    throw new Error(
      'A type dump survived elision, so the diagnostic still carries printed type text that ' +
        'a reason matcher could match on. This is a dump shape neither the balanced pass nor ' +
        `the truncation pass recognises — widen them rather than trusting this text:\n${previous}`,
    );
  }

  return previous.replaceAll(DUMP_SENTINEL, '{…}');
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
 * @param {{ testCase: Case, reason: string }[]} rejected every reject case with
 *   its diagnostic's reason, computed once and shared with the verdict loop —
 *   so this validates the same strings the verdicts are read from, and costs no
 *   extra compiler runs.
 * @returns {string[]} one entry per collision
 */
function resolutionTest(rejected) {
  /** @type {string[]} */
  const problems = [];

  // PART ONE — a type dump must not be evidence.
  //
  // DERIVED from the case list, not listed here. A hardcoded pair covers the
  // cases somebody remembered; every reject case declaring a `notBecause`
  // contributes automatically, so adding one extends this test instead of
  // slipping past it.
  //
  // This part exists because part two alone did not prove what it looked like
  // it proved. The `because` regexes are phrased specifically enough to match
  // only reason prose, so swapping them stays red whether or not type dumps are
  // elided — measured by mutation: folding the dumps back in left part two
  // entirely green. So exclusion is tested the NAIVE way a future author would
  // phrase it, with a bare property name. Removing the elision now turns SIX
  // cases red here, one of them on the atomic path that previously had no
  // control at all.
  for (const { testCase: subject, reason } of rejected) {
    if (subject.notBecause === undefined || subject.notBecause === null) continue;
    if (subject.notBecause.test(reason)) {
      problems.push(
        `"${subject.name}": the reason text matches ${String(subject.notBecause)}, which names ` +
          `something that is NOT the reason. That name is visible only because a TYPE WAS ` +
          `PRINTED — diagnostics quote the whole offending type, in the summary and in the ` +
          `continuations alike, so every property in it appears. Treating a type dump as ` +
          `evidence is what makes this matcher unable to fail.` +
          `\n      reason was:\n${reason}`,
      );
    }
  }

  // PART TWO — no case's expected reason may match ANY OTHER case's reason.
  //
  // The full cross-product, not a hand-written list of confusable pairs. Pairs
  // cover the collisions somebody noticed, and the one that mattered was
  // outside them: `a handler map missing a channel` anchors on
  // `Property ''app.info'' is missing` with no anchor on the type it is missing
  // FROM, and the client-stub diagnostic begins with exactly that text before
  // continuing `…but required in type 'ClientApi…`. One case's matcher accepted
  // another's reason, and being unpaired is why nothing looked.
  //
  // Every reason is already computed, so this costs n² regex tests over strings
  // in hand. A legitimate collision is a finding — two cases not distinguishable
  // by reason need a stronger anchor — not noise to be exempted.
  for (const { testCase: subject, reason } of rejected) {
    for (const other of rejected) {
      if (other.testCase === subject) continue;
      if (other.testCase.because === undefined) continue;
      if (!other.testCase.because.test(reason)) continue;
      problems.push(
        `"${subject.name}" is also matched by the expected reason of ` +
          `"${other.testCase.name}" (${String(other.testCase.because)}). One case's matcher ` +
          `accepts another case's diagnostic, so neither verdict distinguishes them. ` +
          `Usually the weaker pattern is missing the type it names — anchor it on ` +
          `"…but required in type 'X'" or equivalent.\n      reason was:\n${reason}`,
      );
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

  /**
   * Every case compiled once. The resolution test and the verdicts read the
   * same strings, so the matcher is validated against exactly what it will
   * certify — and the whole file costs one compiler run per case rather than
   * one per case plus one per resolution check.
   *
   * @type {{ testCase: Case, ok: boolean, output: string, heads: string[], reason: string }[]}
   */
  const results = [];

  try {
    for (const testCase of CASES) {
      const { ok, output } = typecheck(testCase.source);
      const { heads, reason } = diagnose(output);
      results.push({ testCase, ok, output, heads, reason });
    }

    // Reject cases that actually rejected: the only ones with a reason to
    // validate. A case that wrongly compiled is reported below on its own.
    const rejected = results
      .filter((r) => r.testCase.expect === 'reject' && !r.ok)
      .map((r) => ({ testCase: r.testCase, reason: r.reason }));

    const unresolved = resolutionTest(rejected);
    if (unresolved.length > 0) {
      process.stderr.write(
        `\nThe reason matcher failed its own resolution test:\n\n` +
          unresolved.map((p) => `  - ${p}`).join('\n\n') +
          `\n\nNothing below is reported, because a matcher that cannot tell two ` +
          `known-different reasons apart cannot certify any of them.\n\n`,
      );
      return 1;
    }
    process.stdout.write(
      `  ok  4a     ${String(rejected.length)} reasons are mutually exclusive, and none rests on a type dump\n`,
    );

    for (const { testCase, ok, output, heads, reason } of results) {
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

      if (testCase.notBecause === undefined) {
        // `null` is a decision — "nothing else quoted here could match" — and
        // an omission is not. Without this they are indistinguishable, and the
        // silent category is the one where the control was never considered.
        failures.push(
          `${testCase.name}: declares no \`notBecause\`. Every reject case must name a ` +
            `property that appears in the diagnostic but is NOT the reason, or declare ` +
            `\`notBecause: null\` to say there is none.`,
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
