import type { ChannelResult, ContractHandlers } from '@monstera/contract';
import type { CapabilityRegistry, DocumentService } from '@monstera/kernel';
import { ok } from '@monstera/shared';

import { executeCommandHandler } from './commandHandlers.js';
import type { DocumentCommands } from './documentCommands.js';

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
  readonly pickDocument: PickDocument;
}): ContractHandlers {
  return {
    // `Promise.resolve`, not `async`: nothing here awaits, and the contract's
    // handler type is asynchronous because the real document channels are.
    'app.info': () => Promise.resolve(ok({ ...deps.appInfo })),
    'document.open': openDocumentHandler(deps),
    'document.execute': executeCommandHandler(deps.commands),
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
    return ok(outcome);
  };
}
