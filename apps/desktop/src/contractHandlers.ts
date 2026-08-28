import type { ChannelResult, ContractHandlers } from '@monstera/contract';
import {
  type CapabilityRegistry,
  CheckpointRestoreNotBuiltError,
  DocumentBusyError,
  DocumentNotOpenError,
  type DocumentService,
  type WriteTargetVerdict,
} from '@monstera/kernel';
import { type DocId, err, ok } from '@monstera/shared';

import { executeCommandHandler } from './commandHandlers.js';
import { type DocumentCommands, DocumentPoisonedError } from './documentCommands.js';

/**
 * Where a document comes from, as a value this module can be handed.
 *
 * **Injected rather than imported**, for the reason the whole file is: nothing
 * here may import Electron, and `dialog.showOpenDialog` is Electron's. The real
 * one lives in the composition root; a test hands a function that returns a
 * path, and every case about *what happens with what was picked* becomes
 * decidable in milliseconds with no window.
 *
 * `null` is the user dismissing the picker — an outcome, not a failure.
 *
 * **It returns a PATH and this is the only place in the renderer's reach where
 * one appears.** That is invariant 1 working rather than being bypassed: the
 * path exists on main's side of the boundary, is turned into a `FileHandle`
 * three lines later, and the renderer's request that started all this carried
 * no parameters at all.
 */
export type PickDocument = () => Promise<string | null>;

/**
 * What happens the moment a document becomes open, before anything else can.
 *
 * ## Why the handler calls this rather than the service raising it
 *
 * `DocumentService` already has a teardown seam for the other end of a
 * document's life, and the symmetry is tempting. It is wrong here: giving a
 * session to a document needs a **contained host**, which is Win32 work in
 * `apps/desktop`, and `packages/kernel` may not reach it. A seam on the service
 * would either import that or take it as a second injected surface, and the
 * service would then own a lifetime it cannot fulfil.
 *
 * ## It returns nothing, and that is the ordering
 *
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9c queues the session's creation in the document's own lane before
 * it yields, so a command issued next sits behind it. A handler that awaited
 * the session would make every open as slow as a host build and would buy
 * nothing the lane does not already guarantee.
 */
export type OpenedDocument = (docId: DocId) => void;

/**
 * What the application reports about itself.
 *
 * Both fields are **baked at build time** (E4) rather than detected at runtime.
 * `installChannel` decides which update provider is active and the Store build
 * must never self-update, so it is a property of the artifact: a value read at
 * runtime could differ between two launches of the same package, which is
 * exactly what an update decision must not do.
 */
export interface AppInfo {
  readonly version: string;
  readonly installChannel: 'store' | 'web' | 'development';
}

/**
 * The main-process side of the contract, assembled once and completely.
 *
 * ## Why this file exists, and the finding it closes
 *
 * `channels.ts` states the rule this discharges: *"A channel is added here only
 * when a real handler for it exists… a declared channel with nothing behind it
 * is a call that hangs, which is worse than a call that is absent."* That was
 * **false for `app.info` from the day it was declared** — its only
 * implementations were test fixtures and `contract.proof.mjs`, and no assembled
 * `ContractHandlers` existed anywhere. Recorded as audit finding CC-2; this is
 * the half of the fix that supplies the handler, and `registerHandlers.ts` is
 * the half that makes it reachable.
 *
 * ## Annotated, not inferred
 *
 * The return type is `ContractHandlers`, so **adding a channel to the registry
 * breaks this file until it is answered here.** That is the same mechanism the
 * browser shim relies on, on the other side of the boundary, and it is the whole
 * reason the four surfaces are derived rather than written: an unimplemented
 * channel is a compile error rather than a call that hangs at runtime.
 *
 * ## Dependencies are injected, so this is testable without Electron
 *
 * Nothing here imports Electron. `AppInfo` arrives as a value rather than being
 * read from `app.getVersion()`, which keeps the assembly unit-testable in
 * milliseconds and keeps the Electron import confined to the entry point that
 * genuinely needs it. The kernel boundary makes the same trade for the same
 * reason (§1).
 *
 * @param deps the document command bus, and what the app reports about itself
 */
export function createContractHandlers(deps: {
  readonly commands: DocumentCommands;
  readonly appInfo: AppInfo;
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly pickDocument: PickDocument;
}): ContractHandlers {
  return {
    // `Promise.resolve`, not `async`: nothing here awaits, and the contract's
    // handler type is asynchronous because the real document channels are.
    'app.info': () => Promise.resolve(ok({ ...deps.appInfo })),
    'document.open': openDocumentHandler(deps),
    'document.execute': executeCommandHandler(deps.commands),
    'document.undo': undoHandler(deps.commands),
    'document.save': saveHandler(deps.commands),
  };
}

/**
 * Save, and the whole of it is keeping three outcomes out of the failure
 * channel.
 *
 * `refused` and `write-failed` are things that happened to a document that is
 * still intact, still dirty, and whose command log is untouched. Invariant 18's
 * sentence — *"never by a dialog whose only option discards their edits"* — is a
 * statement about what the renderer must be able to say, and it can only say it
 * if the two arrive as outcomes rather than as error codes beside
 * `document-not-open`.
 *
 * ## The verdict is narrowed EXHAUSTIVELY, on purpose
 *
 * `sole-writer` cannot appear: the pipeline returns `refused` only for verdicts
 * that are not it. That is unrepresentable on the wire — the enum has four
 * members — so the impossible case is handled by the compiler refusing a switch
 * that does not cover the four, rather than by a default branch that would
 * silently absorb a fifth verdict the kernel grows later.
 */
function saveHandler(commands: DocumentCommands): ContractHandlers['document.save'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.save']>>> => {
    try {
      const outcome = await commands.save(docId);
      if (outcome.kind === 'saved') return ok({ kind: 'saved', version: outcome.version } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', reason: refusalReason(outcome.verdict) } as const);
    } catch (thrown) {
      // MATCHED ON THE CLASS, exactly as undo and execute do. Everything else
      // is rethrown and becomes `internal` with the diagnostic recorded
      // main-side — including `MissingSessionError`, which is a supervisor
      // inconsistency rather than something a user can act on.
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The verdict's kind, and nothing else it carries.
 *
 * Written as an exhaustive narrowing rather than `verdict.kind`, because the
 * two types are not the same set: the kernel's has five members and the wire's
 * has four. Passing the field through would compile today and would silently
 * put a fifth kernel verdict on a wire that does not declare it — a schema
 * failure at the boundary, in production, for a case nobody wrote.
 */
function refusalReason(
  verdict: Exclude<WriteTargetVerdict, { kind: 'sole-writer' }>,
): 'contested' | 'replaced' | 'target-absent' | 'unverifiable' {
  switch (verdict.kind) {
    case 'contested':
      return 'contested';
    case 'replaced':
      return 'replaced';
    case 'target-absent':
      return 'target-absent';
    case 'unverifiable':
      return 'unverifiable';
  }
}

/**
 * Undo, and the whole of it is turning `undefined` into an outcome.
 *
 * `DocumentCommands.undo` answers `undefined` for a log with nothing left,
 * which is a state every document starts in and every document reaches by
 * undoing to the beginning. The channel says `nothing-to-undo` rather than
 * failing, because the renderer's response to it — leave the control alone —
 * is not the response to a defect, and a failure code would make the ordinary
 * end of undoing indistinguishable from one.
 *
 * Everything that IS a failure travels the way `document.execute`'s does:
 * thrown by class, matched by `wrapHandler`, and a terminal entry becomes
 * `checkpoint-restore-not-built` rather than an `internal` naming a gap the
 * user cannot act on.
 */
function undoHandler(commands: DocumentCommands): ContractHandlers['document.undo'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.undo']>>> => {
    try {
      const version = await commands.undo(docId);
      return ok(
        version === undefined
          ? ({ kind: 'nothing-to-undo' } as const)
          : ({ kind: 'undone', version } as const),
      );
    } catch (thrown) {
      // MATCHED ON THE CLASS, never on the message — the reason
      // `DocumentNotOpenError` exists as a class at all. Each of these is an
      // outcome the renderer can act on; everything else is rethrown and
      // becomes `internal` with the diagnostic recorded main-side.
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      // NAMED RATHER THAN INTERNAL, because the user's next move differs: this
      // says *this particular step cannot be reversed yet*, which is a fact
      // about the build rather than an inconsistency they triggered. §4's
      // answer is a checkpoint restore, which needs the save pipeline.
      if (thrown instanceof CheckpointRestoreNotBuiltError) {
        return err({ code: 'checkpoint-restore-not-built' });
      }
      throw thrown;
    }
  };
}

/**
 * Picker → mint → open, and the handle's lifetime around the outcomes.
 *
 * ## The order is the invariant
 *
 * Main picks, main mints, the kernel opens. Nothing in this sequence is
 * reachable from the renderer's request, which carried no parameters, so
 * "opened the wrong file" is not a state a renderer can steer into.
 *
 * ## THE HANDLE IS REVOKED ON EXACTLY TWO OUTCOMES, AND NOT ON THE THIRD
 *
 * `absent` and `at-capacity` leave nothing holding the handle: the service did
 * not take it, so without a revoke a user repeatedly picking missing files
 * would grow the registry once per distinct path, forever.
 *
 * `already-open` is the one that must **not** be revoked, and the reason is a
 * property of `mint` rather than of this function. Minting is *idempotent per
 * path* — deliberately, so that opening the same file twice does not mint twice
 * — which means the handle returned here for an already-open document **is the
 * live document's handle**. Revoking it would strip the capability out from
 * under a document that is open and working, and the failure would surface
 * later, somewhere else, as a resolve that throws.
 *
 * That is the whole finding: the tidy-up that looks symmetric across four
 * outcomes is correct on two, harmless on the one that took the handle, and
 * destructive on the one where two callers share it.
 */
function openDocumentHandler(deps: {
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly pickDocument: PickDocument;
}): ContractHandlers['document.open'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.open']>>> => {
    const picked = await deps.pickDocument();
    if (picked === null) return ok({ kind: 'cancelled' } as const);

    const handle = deps.capabilities.mint(picked);
    const outcome: ChannelResult<'document.open'> = await deps.documents.open(handle);

    if (outcome.kind === 'absent' || outcome.kind === 'at-capacity') {
      deps.capabilities.revoke(handle);
    }

    // ONLY FOR A DOCUMENT THIS CALL OPENED, and `already-open` is the outcome
    // that makes the distinction load-bearing rather than pedantic: that
    // document has a session or is poisoned already, and a second entry for it
    // would spend Decision 9a's failure bound a second time on a document that
    // never failed.
    if (outcome.kind === 'opened') deps.openedDocument(outcome.docId);

    return ok(outcome);
  };
}
