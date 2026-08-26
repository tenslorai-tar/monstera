// `import type`, THE STATEMENT FORM, and the difference is 38.1 MB.
//
// Under `verbatimModuleSyntax` — which this repository sets — `import { type X }
// from 'm'` elides the BINDING and keeps the STATEMENT, emitting `import {} from
// 'm'`. That is a side-effect import of the kernel barrel, which re-exports
// `mupdfWriter`, which loads the native MuPDF binding. Measured: written that
// way, this module put the parser into `main`'s process and `perf:gate` failed
// on the BASELINE — 97.6 MB against a 96 MB base limit, with the ratio still
// passing at 1.04x, so the number that moved was not the one anybody watches.
//
// `import type { … } from 'm'` is erased whole. The two spellings look
// interchangeable and are not, and invariant 20 is what sits behind the
// difference: no native engine code in main.
import type { DocumentService, EngineSupervisor, MupdfSession } from '@monstera/kernel';
import type { DocId } from '@monstera/shared';

/**
 * The engine session supervisor — the component that creates a document's
 * engine session and owns the directory pair its bytes travel through.
 *
 * ## Why this module exists before the rest of the supervisor does
 *
 * `documentCommands.ts` states the constraint in its own words: `SessionLookup`
 * is *"get-or-miss, never get-or-create"*, and *"widening it to create would be
 * bending this seam to fit a feature, which is B4."* So something other than
 * the lookup must create a session and put it where the lookup finds it. That
 * something is this.
 *
 * What is here is the **creation** step. The rest of ADR-0023 Decision 9 — the
 * rebuild bounded per document, poisoning at two consecutive failures with a
 * reset on success, entering other documents' lanes rather than draining them —
 * is the same component's and is not built yet.
 *
 * It is written now rather than with the rest because the capability it mints
 * has to be minted **somewhere**, and `documentService.ts` says what a token
 * with no minter is: *"a method nobody can call — a narrowing that reads as a
 * decision and behaves as a deletion."*
 *
 * ## The B3 split this module is one half of
 *
 * | concern | owner |
 * |---|---|
 * | the handed directory pair's lifetime — created, removed on close | **this module** |
 * | the canonical image, and copying it out | `DocumentService` |
 *
 * Neither writes the other's concern. That is what stops the pair acquiring two
 * owners and the image acquiring two writers — and it is why the image reaches
 * the snapshot directory through `writeCanonicalImage(destination)` rather than
 * through a getter that would hand this module the bytes.
 */

/**
 * THE MINT, and it is the only one.
 *
 * Module-private on purpose, exactly as `commandBus.ts` mints `CommandWriter`:
 * that one line is what makes this component the single holder of the
 * capability, and any other module producing one is a cast visible in a diff.
 */
const SUPERVISOR = {} as EngineSupervisor;

/**
 * The directories one session's bytes travel through, and their lifetime.
 *
 * Injected rather than imported because creating a directory with a DACL is
 * Win32 work — `createSessionDirectories` in `sessionDirectories.ts` — and this
 * module's cases must be decidable without a container, a grant or an
 * AppContainer SID.
 */
export interface SessionAreaOwner {
  /** Creates one session's granted pair and returns where the snapshot goes. */
  readonly create: () => Promise<{ readonly snapshotPath: string }>;
  /** Removes the pair. Called on every failure path out of {@link openEngineSession}. */
  readonly remove: () => Promise<void>;
}

/**
 * How the engine is asked to open what was written.
 *
 * A narrower shape than `EngineWriter` deliberately: this step opens, and
 * `serialise`/`close` belong to the parts of the supervisor that are not built.
 * A parameter typed to the whole writer would let this function grow into them
 * without anybody choosing to.
 */
export type EngineOpenFromPath = (snapshotPath: string) => Promise<MupdfSession>;

/**
 * Creates the engine session for one open document.
 *
 * ## The image never passes through this function
 *
 * `writeCanonicalImage` takes a **destination** and returns a count. That is
 * the whole point of the capability: this module is the one component permitted
 * to have the service copy an image out, and it still never holds one. A
 * version of this that read the bytes and wrote them itself would put a second
 * copy of the document in main for the duration — 1.00× becoming 2.00× against
 * a 1.5× ceiling, measured.
 *
 * ## Every failure removes the pair
 *
 * By the time the engine is asked to open, the user's document is on disk in a
 * directory the contained host may read. A caller that receives an error rather
 * than a session will never close a session, so nothing else would remove it.
 *
 * @param documents The service holding the canonical image.
 * @param docId The open document.
 * @param areas The granted directory pair, whose lifetime this owns.
 * @param open How the engine opens a path.
 * @returns The session, and the byte count the service reported writing.
 */
export async function openEngineSession(
  documents: DocumentService,
  docId: DocId,
  areas: SessionAreaOwner,
  open: EngineOpenFromPath,
): Promise<{ readonly session: MupdfSession; readonly snapshotBytes: number }> {
  const { snapshotPath } = await areas.create();
  try {
    const snapshotBytes = await documents.writeCanonicalImage(SUPERVISOR, docId, snapshotPath);
    const session = await open(snapshotPath);
    return { session, snapshotBytes };
  } catch (error) {
    await areas.remove();
    throw error;
  }
}

/**
 * The same capability, for an instrument that must drive the SHIPPED call site.
 *
 * ## Why this is exported and why it is not a widening
 *
 * `perf:gate`'s coverage row asks whether writing a snapshot from a main
 * process already holding the document adds a resident copy. Answering it needs
 * the real `writeCanonicalImage`, and the alternatives were both the defect
 * that gate's own role exists because of (LL-4/JJ-1): a harness that reads the
 * file a second time measures its own copy, and a harness that invents a call
 * site measures something nothing ships.
 *
 * So the instrument takes the capability rather than a copy of the mechanism.
 * What it does **not** get is the bytes — the method's whole shape is that
 * nothing receives them, and that is unchanged by who holds the token.
 *
 * Named so that a use of it in production code is a sentence a reviewer reads,
 * which is the same property `CommandWriter`'s module-private mint has: the
 * brand never made forgery impossible, it made it visible.
 */
export const SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS: EngineSupervisor = SUPERVISOR;
