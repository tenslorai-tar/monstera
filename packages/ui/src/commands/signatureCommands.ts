import type { AnnotationRect, RequestedSignatureMark } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { type HeldLooks, afterNextPaint, sendHeld } from '../heldLooks.js';
import { signatureLook } from '../markLook.js';
import { SIGNATURE_TOOL_ID } from '../annotations/signatureTool.js';
import { fileTooLargeProblem } from '../dialogs/fileTooLarge.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { type HeldSignaturePicture, SIGNATURE_ANSWERS, SIGNATURE_DIALOG_ID, type SignatureLook } from '../dialogs/signature.js';
import type { KeptSignature } from '../dialogs/signDocument.js';
import { SIGNATURE_PROBLEM_DIALOG_ID } from '../dialogs/signatureProblem.js';
import { chosenOfKept, requestedMarkOf } from './signatureMarks.js';
import { GROUP_QUICK_TOOLS, GROUP_STAMPS, SIGNATURE_TIP, SIGNATURE_TITLE, TOAST_SIGNATURE_LIBRARY_FULL, TOAST_SIGNATURE_NOT_KEEPABLE } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import { confirmDone } from './confirmWritten.js';
import { type DocumentCommandDeps, type WritesAFile, hasDocument, reportProblem } from './documentCommands.js';
import { BLOB_URLS, type LibraryPageDeps, keptEntries } from './stampLibrary.js';

/**
 * The plain Signature, the renderer's half ([ADR-0133](../../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)).
 *
 * The flow is the owner's: the Signature dialog chooses a look, then a click on the page places it, then the select
 * tool holds it so it can be moved and resized. This module is the dialog's loop, the placement and its outcomes, and
 * the command the ribbon draws; App holds the look between the dialog and the click.
 */

/** A picture's size in pixels. */
export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/**
 * What a chosen signature's held look is drawn from where the mark main is sent carries no ink the renderer holds
 * (ADR-0257): a kept drawing named by its id, or a picture — its `blob:` address, kept past the dialog, its size, and
 * `close` to let the address go. Whoever ends the chosen signature's life calls `close`: its placement when the held
 * look leaves the page, or the holder of an unplaced one when it is replaced.
 */
export type SignatureShown =
  | Extract<KeptSignature['look'], { readonly kind: 'drawn' }>
  | (PictureSize & { readonly kind: 'picture'; readonly src: string; readonly close: () => void });

/** A look the Signature dialog answered, with what its held look is drawn from. */
export type ChosenSignature = SignatureLook & { readonly shown: SignatureShown | undefined };

/** Lets go of whatever an unplaced chosen signature kept alive. */
export function letGoOfChosen(chosen: ChosenSignature): void {
  if (chosen.shown?.kind === 'picture') chosen.shown.close();
}

/**
 * A picture's size in pixels, from an address already decoded for the dialog's preview: `undefined` where the bytes do
 * not decode here, and the placement then holds no look — main decodes what it places, and its answer says whether
 * the picture was readable.
 */
async function pictureSize(src: string): Promise<PictureSize | undefined> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return undefined;
  }
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** A kept address handed on with its size, or let go here when it has none to draw with. */
async function pictureShown(
  src: string,
  urls: LibraryPageDeps['urls'],
  sizeOf: (src: string) => Promise<PictureSize | undefined>,
): Promise<SignatureShown | undefined> {
  const size = await sizeOf(src);
  if (size === undefined || size.width === 0 || size.height === 0) {
    urls.revoke(src);
    return undefined;
  }
  return {
    kind: 'picture',
    src,
    ...size,
    close: () => {
      urls.revoke(src);
    },
  };
}

/**
 * Asks the Signature dialog until it answers a look, or is dismissed.
 *
 * **The signature library is read each time the dialog opens**, through `keptEntries`, the one reader both libraries'
 * choosers take (B3a) — so it is the library *Sign with certificate* offers, shown the same way. Removing a kept one
 * is an answer: the opener removes it and asks again, because a dialog's props are fixed while it is open.
 */
/**
 * A look the dialog chose and whose picture is still being prepared: what the tool is armed with between the answer and
 * the look (N5), so a press in that time waits for this rather than reaching the tool before it.
 */
export interface PreparingSignature {
  readonly preparing: Promise<ChosenSignature | undefined>;
}

export async function chooseSignature(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client'>,
  urls: LibraryPageDeps['urls'] = BLOB_URLS,
  sizeOf: (src: string) => Promise<PictureSize | undefined> = pictureSize,
  /** Told the moment a mark is chosen, before its picture is prepared: what the caller arms its tool on. */
  onChosen?: () => void,
): Promise<ChosenSignature | undefined> {
  const library: LibraryPageDeps = { client: deps.client, ask: deps.ask, urls };
  // THE PICTURE MAIN HOLDS for this dialog, once Upload has picked one: carried across every asking, and its `blob:`
  // address let go when it is replaced or the dialog is done with (ADR-0133's second correction) — or handed on with the
  // answer, when it is the picture placed.
  let picked: HeldSignaturePicture | undefined;
  let keep: boolean | undefined;
  try {
    for (;;) {
      const { kept, release } = await keptEntries(library, 'signature');
      let answered: unknown;
      try {
        answered = await deps.ask(SIGNATURE_DIALOG_ID, { kept, ...(picked === undefined ? {} : { picked }), ...(keep === undefined ? {} : { keep }) });
      } catch (thrown) {
        release();
        throw thrown;
      }
      const parsed = SIGNATURE_ANSWERS.safeParse(answered);
      // THE ONE PICTURE PLACED keeps its address past the dialog (ADR-0257): already decoded for the dialog's preview,
      // so its held look is drawn in the click's own frame. Every other address is let go here.
      const mark = parsed.success && 'mark' in parsed.data ? parsed.data.mark : undefined;
      const savedLook = mark?.kind === 'saved' ? kept.find((entry) => entry.id === mark.id)?.look : undefined;
      const keeping = mark?.kind === 'image' ? picked?.src : savedLook?.kind === 'picture' ? savedLook.src : undefined;
      release(keeping);
      // DISMISSED, or an answer of another shape — a registration defect rather than a person's doing — places nothing.
      if (!parsed.success) return undefined;
      if ('mark' in parsed.data) {
        // TOLD AT ONCE, before the picture is prepared below: the caller arms its tool in the answer's own task, so a
        // press straight after "Use Signature" reaches the signature tool and waits for this look (N5, 2026-10-23).
        onChosen?.();
        // THE PICKED PICTURE IS HANDED ON, so the `finally` below no longer lets its address go.
        if (keeping !== undefined && keeping === picked?.src) picked = undefined;
        return {
          ...parsed.data,
          mark: chosenOfKept(parsed.data.mark, kept),
          // A KEPT DRAWING's strokes, which main is named by id and the renderer would otherwise not hold; a picture.
          shown: savedLook?.kind === 'drawn' ? savedLook : keeping === undefined ? undefined : await pictureShown(keeping, urls, sizeOf),
        };
      }
      if ('upload' in parsed.data) {
        keep = parsed.data.keep;
        const answer = await deps.client['signature.pickPicture']({});
        if (!answer.ok) continue;
        if (answer.value.kind === 'picked') {
          if (picked !== undefined) urls.revoke(picked.src);
          const { handle, name, mediaType, bytes } = answer.value;
          picked = { handle, name, src: urls.make(bytes, mediaType) };
        } else if (answer.value.kind !== 'cancelled') {
          // REFUSED BY ITS BYTES OR ITS SIZE, or a scanned PDF with no ink or a password, said where the person is
          // looking, before they are asked again.
          await deps.ask(
            SIGNATURE_PROBLEM_DIALOG_ID,
            answer.value.kind === 'too-large'
              ? fileTooLargeProblem(answer.value)
              : { reason: answer.value.kind },
          );
        }
        continue;
      }
      await deps.client['library.remove']({ id: parsed.data.id });
    }
  } finally {
    if (picked !== undefined) urls.revoke(picked.src);
  }
}

/**
 * Places a chosen look where the person clicked, and says what came of keeping it.
 *
 * @returns the version the placement produced, so the caller can select the new mark at it; `undefined` when nothing
 *   was placed
 */
export async function placePlainSignature(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client' | 'onApplied' | 'stamp'> &
    WritesAFile & {
      /** The document's holder (ADR-0257): the signature is held on its page in its final look while main writes it. */
      readonly held: Pick<HeldLooks, 'hold' | 'letGo'> | undefined;
    },
  docId: DocId,
  page: number,
  rect: AnnotationRect,
  /** The chosen look, and what it kept alive for its held look, which this placement now lets go of when it ends. */
  look: ChosenSignature,
): Promise<DocVersion | undefined> {
  const requested = await requestedMarkOf(look.mark);
  if (requested.kind === 'problem') {
    letGoOfChosen(look);
    void deps.ask(SIGNATURE_PROBLEM_DIALOG_ID, requested.problem);
    return undefined;
  }
  let placed: DocVersion | undefined;
  await sendHeld(
    deps.held,
    page,
    signatureLook(requested.mark, rect, look.shown),
    async () => {
      placed = await sendSignature(deps, docId, page, rect, requested.mark, look.keep);
      return placed !== undefined;
    },
    afterNextPaint,
    () => {
      letGoOfChosen(look);
    },
  );
  return placed;
}

/** Sends one placement and says what came of it: the version it produced, or `undefined` for none. */
async function sendSignature(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client' | 'onApplied' | 'stamp'> & WritesAFile,
  docId: DocId,
  page: number,
  rect: AnnotationRect,
  mark: RequestedSignatureMark,
  keep: boolean,
): Promise<DocVersion | undefined> {
  const answer = await deps.client['document.placeSignature']({
    docId,
    page,
    rect,
    mark,
    keep,
    stamp: deps.stamp(),
  });
  if (!answer.ok) {
    reportProblem(deps, answer.error);
    return undefined;
  }
  const outcome = answer.value;
  if (outcome.kind === 'cancelled') return undefined;
  if (outcome.kind !== 'placed') {
    // VOIDED for `reportProblem`'s reason: an informational dialog settles only on dismissal.
    void deps.ask(
      SIGNATURE_PROBLEM_DIALOG_ID,
      outcome.kind === 'too-large' ? fileTooLargeProblem(outcome) : { reason: outcome.kind },
    );
    return undefined;
  }
  deps.onApplied({ version: outcome.version, byteLength: outcome.byteLength });
  if (outcome.historyDropped > 0) void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: outcome.historyDropped });
  // THE PAGE SHOWS THE MARK, so a placement confirms through neither path — except what the page cannot show: a keep
  // the person asked for that did not happen.
  if (outcome.kept === 'library-full') confirmDone(deps, TOAST_SIGNATURE_LIBRARY_FULL);
  if (outcome.kept === 'not-keepable') confirmDone(deps, TOAST_SIGNATURE_NOT_KEEPABLE);
  return outcome.version;
}

/** What the Signature command needs: the tool's state, and where a chosen look goes. */
export interface SignatureCommandDeps {
  /** The tool active now, read through a function for `toolCommand`'s reason. */
  readonly activeTool: () => string | undefined;
  /** Runs the dialog and arms the click with the look it answers; App owns the look between the two. */
  readonly onStart: () => void;
  /** Leaves the tool, when the command is pressed while it is armed. */
  readonly onStop: () => void;
}

/**
 * The Signature command: Home › Quick tools and Comment › Stamps (the owner, 2 October).
 *
 * **Pressing it opens the dialog first**, then arms the click — the owner's order. It is the tool's command, so every
 * surface draws it pressed while the click is armed, and pressing it again then leaves the tool, as every tool's
 * command does. The id is the tool's, `toolCommand`'s rule: the two registries are joined by this value.
 */
export function signatureCommand(deps: SignatureCommandDeps): UiCommand {
  return {
    id: SIGNATURE_TOOL_ID,
    // THE MARK IS PLACED where the person clicks.
    feedback: VISIBLE,
    title: SIGNATURE_TITLE,
    tip: SIGNATURE_TIP,
    icon: 'Signature',
    placements: [
      // HOME'S QUICK TOOLS AT 108, the slot *Sign with certificate* held until this existed; it is under Protect only now.
      { surface: 'ribbon', section: 'home', group: GROUP_QUICK_TOOLS, order: 108 },
      // BESIDE THE STAMPS, between Stamp (50) and Image (52): a signature is placed as they are, and moved as they are.
      { surface: 'ribbon', section: 'comment', group: GROUP_STAMPS, order: 51, size: 'small' },
    ],
    when: hasDocument,
    checked: () => deps.activeTool() === SIGNATURE_TOOL_ID,
    run: (): void => {
      if (deps.activeTool() === SIGNATURE_TOOL_ID) deps.onStop();
      else deps.onStart();
    },
  };
}
