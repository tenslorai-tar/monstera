import type { ChannelResult, ContractClient, DroppedOpenOutcome } from '@monstera/contract';
import { type DocId, type DocVersion, type Failure, type FileHandle, type Result, ok } from '@monstera/shared';

import type { DropOpener } from '../bridge.js';
import type { OpenProblem, OpenProblemReport } from '../dialogs/openProblemReasons.js';
import { GROUP_FILE, OPEN_DOCUMENT_TITLE, RIBBON_OPEN } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';

/**
 * The first registered command with a working `run`.
 *
 * ## Why it is a factory and not a constant
 *
 * `run` takes a `CommandContext`, and a context carries what the *focused
 * document* is — not how to reach main. The client is composition, so the
 * command is built where the client exists and captures it. A module-level
 * constant would need a client from a global, which is the second wiring place
 * the registry exists to forbid.
 *
 * ## What crosses is nothing
 *
 * `document.open` takes no parameters. Main owns the picker, mints the
 * `FileHandle` and answers with a `DocId` — the renderer cannot express which
 * file it wants, which is why it cannot express the wrong one (§2, invariant
 * L5). This command is that sentence with a button on it.
 */
/**
 * An open that ended with no document and something to say about it.
 *
 * The channel's own variant names rather than a message: what to show is the
 * surface's decision and the strings are i18n keys, so a command producing a
 * sentence here would put user-facing text in the layer that dispatches.
 */
export type { OpenProblem, OpenProblemReport };

/** What opening needs from the shell: the client, and where each outcome goes. */
export interface OpenDocumentDeps {
  readonly client: ContractClient;
  /**
   * Called with the document that was opened, and with nothing for every other
   * outcome.
   *
   * `cancelled`, `absent` and `at-capacity` are outcomes rather than failures —
   * a user dismissing a picker is not an error — and none is a case this
   * callback can act on.
   *
   * **`already-open` moved to {@link onAlreadyOpen} when tabs landed.** This
   * paragraph used to end *"there is nothing to hand over and the right
   * response is to focus what is already there"*, which was true and had
   * nowhere to send anybody: with one document on screen there was no *there*.
   * The sentence describing the right response outlived the reason it could
   * not be taken.
   */
  readonly onOpened: (opened: {
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
    readonly name: string;
  }) => void;
  /**
   * Called when the open did not produce a document and the user should be
   * told.
   *
   * **Every {@link OpenProblem}, and never `cancelled` or `already-open`.**
   * `cancelled` is a person changing their mind and needs no message;
   * `already-open` is the document they asked for, on screen. Reporting those
   * two would put an error in front of somebody who got what they wanted.
   *
   * This existed as nothing at all until 2026-09-03: every non-`opened` outcome
   * returned silently, so picking a file that had been moved produced **no
   * feedback of any kind** — a control that appears to do nothing, which is the
   * defect the wired-tools rule is about wearing a successful dispatch.
   */
  readonly onProblem: (problems: readonly OpenProblemReport[]) => void;
  /**
   * Called when the picked file is a document this build already holds.
   *
   * A `DocId` and nothing else, because that is all the outcome carries — and
   * all that is needed: the renderer has a tab for that document with its own
   * version, page and zoom, and bringing it forward is the whole response.
   */
  readonly onAlreadyOpen: (docId: DocId) => void;
}

export function openDocumentCommand(deps: OpenDocumentDeps): UiCommand {
  return {
    id: 'document.open',
    feedback: VISIBLE,
    icon: 'FolderOpen',
    title: OPEN_DOCUMENT_TITLE,
    // v5-02's Home › File caption. The start screen's button keeps the full *Open PDF…*.
    ribbonTitle: RIBBON_OPEN,
    // The chord is a property of the command, not an entry in a keymap — the
    // shortcut map is a projection of this registry, so declaring it here is the
    // whole of registering it. `Ctrl+O` because that is what every application
    // this one replaces uses for the same thing.
    shortcut: 'Ctrl+O',
    // ONE PLACEMENT, and the second reader of this command is the TAB STRIP.
    //
    // `quick-toolbar` was tried and reverted in the same session: this command
    // declares no `when` — it is how a reader finds *Open* and must never be
    // absent — so placing it there put it on screen with no document open,
    // which is the one state `QuickToolbar`'s own header says it renders
    // nothing in. The start screen would then have carried two Open buttons.
    //
    // So the strip takes this command's `run` rather than a placement: one
    // implementation with two triggers, which is not a second wiring place —
    // there is still exactly one thing that opens a document.
    placements: [
      // THE PRIMARY SLOT (ADR-0068): §10.3's one green button under the hero.
      { surface: 'start-screen', slot: 'primary', order: 0 },
      // AND HOME › FILE. §7's own example is a command living on several
      // surfaces at once; opening a document is reachable before there is one
      // (the start screen) and after there is one (the ribbon), and those are
      // two moments rather than two features.
      { surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 10 },
      { surface: 'menu-bar', menu: 'file', group: 0, order: 10 },
    ],
    // SEVERAL FILES AT ONCE: the dialog takes a multiple selection and each file is its own tab.
    run: async (): Promise<void> => {
      await openSeveralDocuments(deps);
    },
  };
}

/** What an open left on screen: a document — opened, or one already open brought forward — or nothing. */
export type OpenOutcome = 'shown' | 'none';

/**
 * Opens a document, and says whether one is now showing.
 *
 * THE ONE IMPLEMENTATION `document.open`'s command and the start screen's feature shortcuts share (B3a). A shortcut takes
 * the reader to its feature only when this answers `shown`, so a dismissed picker, a moved file or a full shell changes
 * nothing about where they will land next time.
 */
export async function openDocument(deps: OpenDocumentDeps): Promise<OpenOutcome> {
  return settleOpen(deps, await deps.client['document.open']({}));
}

/**
 * Opens the files a person chose in the Open dialog with a multiple selection, each as its own tab, in the order the
 * dialog listed them — and says which ones did not open, BY NAME, without that stopping the rest.
 *
 * What the Open command runs. {@link openDocument} stays for the callers that need exactly one file. Both reach the
 * document through main's one `openPath`, and what crosses is nothing: main picks, mints a `FileHandle` per file and
 * answers a name and an outcome each (L2).
 */
export async function openSeveralDocuments(deps: OpenDocumentDeps): Promise<OpenOutcome> {
  const answer = await deps.client['document.openSeveral']({});
  // THE CHANNEL FAILING is one problem with no file to name: no file was opened, and none can be said to have failed.
  if (!answer.ok) return settleBatch(deps, [{ answer }]);
  return settleBatch(
    deps,
    answer.value.opened.map(({ name, outcome }) => ({ answer: ok(outcome), name })),
  );
}

/**
 * Opens the files a person dropped, in the order the drop listed them, each as its own tab
 * ([ADR-0099](../../../../docs/DECISIONS/0099-a-dropped-file-is-opened-by-the-preload-and-its-path-never-reaches-the-page.md)).
 *
 * **One at a time, not in parallel**: each open is main's one route with its byte ceiling, so the second
 * file's answer depends on what the first one took, and the tabs arrive in the order the files were listed.
 */
export async function openDroppedFiles(
  deps: OpenDocumentDeps,
  files: readonly File[],
  open: DropOpener,
): Promise<void> {
  // EACH TAB APPEARS AS ITS FILE OPENS, and the failures are said together at the end (`settleBatch`'s reason).
  const problems: OpenProblemReport[] = [];
  for (const file of files) {
    const settled = settleQuietly(deps, await open(file), file.name);
    if (settled.problem !== undefined) problems.push(settled.problem);
  }
  if (problems.length > 0) deps.onProblem(problems);
}

/**
 * Opens the documents a launch named on its command line — a file association, *Open with* — which main has held
 * since that launch. Main opens them through the same `openPath` a drop takes and answers one outcome each, in the
 * order given; each is settled here exactly as a drop's is, so a moved file says so and one already open is shown.
 */
export async function openWaitingDocuments(deps: OpenDocumentDeps): Promise<void> {
  const answer = await deps.client['document.openWaiting']({});
  if (!answer.ok) return;
  settleBatch(
    deps,
    answer.value.opened.map(({ name, outcome }) => ({ answer: ok(outcome), name })),
  );
}

/**
 * Reopens what was open when the previous run ENDED CLEANLY — Part F's *"restore last session"*
 * (`BUILD-PROMPT.md`:611), asked once at start while `viewing.restore-session` is on.
 *
 * **A clean end only.** After a run that died, the start screen OFFERS the same documents one by one
 * (`RecentFiles`), and reopening them unasked would reopen whatever the crash was about. Each goes through
 * `document.openRecent`, the offer's own route, in the order they were open, and is settled as any open is — so a
 * file moved since says so and does not stop the rest.
 */
export async function restoreLastSession(deps: OpenDocumentDeps): Promise<void> {
  const recent = await deps.client['document.recent']({});
  if (!recent.ok || !recent.value.lastExitClean) return;
  for (const entry of recent.value.lastSession) await openRecentDocument(deps, entry.handle);
}

/**
 * What opening a recent entry left: what any open leaves, or `refused` — main did not know the handle, because the list
 * it came from is older than this run, which a surface answers by asking for the list again.
 */
export type RecentOpenOutcome = OpenOutcome | 'refused';

/**
 * Opens a file the recent list named, by the handle main minted for it — THE ONE ROUTE over `document.openRecent`
 * ([ADR-0143](../../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)):
 * File › Recent, the start screen's cards and its crash offer, and the restore at start all take it, so each settles an
 * open as a pick does — a document already open is brought forward, a moved file or a full shell says so.
 */
export async function openRecentDocument(deps: OpenDocumentDeps, handle: FileHandle): Promise<RecentOpenOutcome> {
  const answer = await deps.client['document.openRecent']({ handle });
  if (!answer.ok && answer.error.code === 'unknown-handle') return 'refused';
  return settleOpen(deps, answer);
}

/**
 * What an open's answer does on screen — the ONE place, for a pick and a drop alike, because main opens
 * both through the same `openPath` and the page must not hold two opinions about the same outcomes.
 */
function settleOpen(
  deps: OpenDocumentDeps,
  answer: Result<ChannelResult<'document.open'> | DroppedOpenOutcome, Failure>,
  name?: string,
): OpenOutcome {
  const settled = settleQuietly(deps, answer, name);
  if (settled.problem !== undefined) deps.onProblem([settled.problem]);
  return settled.shown;
}

/** One file of several, as the page names it: its answer, and the name it is reported by (when one is known). */
interface NamedAnswer {
  readonly answer: Result<ChannelResult<'document.open'> | DroppedOpenOutcome, Failure>;
  readonly name?: string;
}

/**
 * Settles every file of a batch, then reports the ones that did not open — TOGETHER, in the order given, by name.
 *
 * ## Why the problems wait until the end
 *
 * Each file settles as a single open does, so a document that opened is shown and an already-open one is brought
 * forward. A problem raised as it happened would be answered by the next file's `onOpened` (which clears the last
 * problem so a later screen never says something about an open the person has since made), and a person who chose
 * five files would be told only about whichever failed last. So the failures are collected and said once, after the
 * last file — and a failed file never stops the ones after it.
 */
function settleBatch(deps: OpenDocumentDeps, answers: readonly NamedAnswer[]): OpenOutcome {
  const problems: OpenProblemReport[] = [];
  let shown: OpenOutcome = 'none';
  for (const { answer, name } of answers) {
    const settled = settleQuietly(deps, answer, name);
    if (settled.shown === 'shown') shown = 'shown';
    if (settled.problem !== undefined) problems.push(settled.problem);
  }
  if (problems.length > 0) deps.onProblem(problems);
  return shown;
}

/** What one open's answer left on screen, and the problem it has to say — which the caller says, alone or in a batch. */
function settleQuietly(
  deps: OpenDocumentDeps,
  answer: Result<ChannelResult<'document.open'> | DroppedOpenOutcome, Failure>,
  name: string | undefined,
): { readonly shown: OpenOutcome; readonly problem: OpenProblemReport | undefined } {
  const none = (reason: OpenProblem): { shown: OpenOutcome; problem: OpenProblemReport } => ({
    shown: 'none',
    problem: name === undefined ? { reason } : { reason, name },
  });
  // A failure here is `internal` — the channel declares no codes, because
  // every way this ends that a user can cause is a variant of the result. It is
  // still said: the person asked for a document and none came.
  if (!answer.ok) return none('failed');
  const outcome = answer.value;
  // EVERY KIND NAMED, so a kind the channel gains is a compile error here
  // rather than an open that ends in silence — which is how `busy` and
  // `denied` would have arrived if this were still an if-chain.
  switch (outcome.kind) {
    case 'absent':
    case 'at-capacity':
    case 'no-path':
    case 'busy':
    case 'denied':
      return none(outcome.kind);
    // A person changing their mind needs no message.
    case 'cancelled':
      return { shown: 'none', problem: undefined };
    // THE READER PICKED A FILE THEY ALREADY HAVE OPEN, and with tabs there
    // is now somewhere to send them. `already-open` carries only a `docId`
    // by design (ADR-0009 §2) — no version, no byte length, nothing to
    // render from — and that is exactly enough to activate the tab whose
    // state the renderer is already holding.
    //
    // It is not a problem and must not be reported as one: the reader asked
    // for a document and the document is on screen.
    case 'already-open':
      deps.onAlreadyOpen(outcome.docId);
      return { shown: 'shown', problem: undefined };
    case 'opened':
      deps.onOpened({
        docId: outcome.docId,
        version: outcome.version,
        byteLength: outcome.byteLength,
        // CARRIED, not derived. There is no path here to derive it from, which
        // is invariant L2 doing its job rather than a gap: main states the name
        // because main is the only side that can.
        name: outcome.name,
      });
      return { shown: 'shown', problem: undefined };
  }
}
