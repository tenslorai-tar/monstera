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
export const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve({ version: '1.0.0', installChannel: 'development' }),
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
    because: /Property ''app\.info'' is missing in type '\{…\}' but required in type 'Handlers</u,
    notBecause: null,
    source: `
import type { ContractHandlers } from '@monstera/contract';
export const handlers: ContractHandlers = {};
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
    // `installChannel` is quoted in the summary and is not the reason.
    notBecause: /installChannel/u,
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
    notBecause: /'version'/u,
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
    because: /Property ''app\.info'' is missing in type '\{…\}' but required in type 'ClientApi<\{…\}>'/u,
    // THE NESTED-DUMP CONTROL, and it needed no synthetic fixture — this
    // diagnostic already nests: `ClientApi<{ … Channel<ZodObject<{ … }>> }>`.
    // Collapsing only the innermost level leaves `installChannel` visible in
    // the reason text, so this fires the moment the elision stops handling
    // depth.
    notBecause: /installChannel/u,
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
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
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
    because: /Property 'rotatePages' is missing in type '\{…\}' but required in type 'CommandSpecs'/u,
    notBecause: null,
    // §6: omit a kind and it does not compile. This is the case that makes the
    // table exhaustive by construction rather than by review.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {};
`,
  },
  {
    name: 'a spec table with an unrouted command kind does not compile',
    expect: 'reject',
    code: 'TS2353',
    because: /'notDeclared' does not exist in type 'CommandSpecs'/u,
    notBecause: /rotatePages/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
  notDeclared: {
    kind: 'notDeclared',
    writer: 'mupdf',
    apply: applyRotatePages,
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
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
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
    because: /is missing the following properties from type '\{…\}': invertible, undo/u,
    notBecause: /reproducible/u,
    source: `
import type { CommandSpecs } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
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
    notBecause: /reproducible/u,
    // §3a's sentence AS A TYPE: a command that cannot reproduce itself records
    // its EFFECT, and replay re-applies the stored effect rather than re-running
    // the operation. Declaring the axis without its consequence is what this
    // forbids — signing, OCR and AI all land here.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
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
    notBecause: /invertible/u,
    // §4 spends this: a non-invertible command without a checkpoint is
    // unrepresentable. Letting `invertible: false` sit beside `undo: 'inverse'`
    // is how a checkpoint quietly becomes optional.
    source: `
import type { CommandSpecs } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const specs: CommandSpecs = {
  rotatePages: {
    kind: 'rotatePages',
    writer: 'mupdf',
    apply: applyRotatePages,
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
import { applyRotatePages } from '@monstera/kernel';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'mupdf',
  apply: applyRotatePages,
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
    // The compiler bottoms out on the SESSION rather than the return type: a
    // byte-image writer is handed bytes, MuPDF's handler demands a session, and
    // that mismatch is reached first. Matching the deepest line rather than the
    // summary is what makes this case name the binding it is about.
    because: /Type 'ByteImage' is not assignable to type 'MupdfSession'/u,
    // None, and the reason is worth stating rather than leaving as a bare null.
    // The name you would expect to be confusable is the DECLARED writer,
    // `pdf-lib` — and it does not appear at all, because it is a value whose
    // literal type never enters the assignability chain. `rotatePages` does
    // survive elision, via `CommandSpec<"rotatePages">`, but it is the command
    // this spec is for rather than a name in reach of the wrong matcher; the
    // cross-product check is what guards that, and it runs regardless.
    notBecause: null,
    source: `
import type { CommandSpec } from '@monstera/kernel';
import { applyRotatePages } from '@monstera/kernel';
export const spec: CommandSpec<'rotatePages'> = {
  kind: 'rotatePages',
  writer: 'pdf-lib',
  apply: applyRotatePages,
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
    because: /Type 'void' is not assignable to type 'Promise<ByteImage>'/u,
    notBecause: null,
    source: `
import type { Apply, ByteImage } from '@monstera/kernel';
export const rotate: Apply<'pdf-lib', 'rotatePages'> = (_image: ByteImage) => {};
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
    name: 'a command missing a required parameter does not compile',
    expect: 'reject',
    code: 'TS2741',
    because: /Property 'quarterTurns' is missing/u,
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
