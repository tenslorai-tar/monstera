import type { ContractClient } from '@monstera/contract';

import type { DocumentStore } from '../documentStores.js';
import { type AccessibilitySection, type AccessibilityView, EMPTY_ACCESSIBILITY, type Spot } from './view.js';

/**
 * The accessibility tools' reads, and the ONE writer of a document's `accessibility` state (ADR-0183, ADR-0189).
 *
 * ## Every read belongs to a run
 *
 * A check and a page's reading order are each awaited, and a person may ask again — or turn the page — while one is in
 * flight. So each is numbered from the view's own counter, and an answer writes only if the run it was started for is
 * still the one held: a late answer for a page the person has left, or for a check since started again, writes nothing
 * (`spelling/reviewRun.ts`' rule).
 *
 * ## A refusal is said, and is never a clean result
 *
 * A document that is busy or no longer open refuses the read; the state records that, so the panel can say the document
 * could not be read rather than show an empty list — which reads as *nothing is wrong*.
 */

/** What the tools' reads need from the application. */
export interface AccessibilityDeps {
  readonly client: ContractClient;
}

/** The document's view as its store holds it now. */
function current(store: DocumentStore): AccessibilityView {
  return store.getState().accessibility ?? EMPTY_ACCESSIBILITY;
}

function write(store: DocumentStore, view: AccessibilityView): void {
  store.getState().viewAccessibility(view);
}

/** Opens the tool at `section`: the one way it is shown. */
export function openTool(store: DocumentStore, section: AccessibilitySection): void {
  const view = current(store);
  if (!view.open || view.section !== section) write(store, { ...view, open: true, section });
}

/** Closes the tool and takes its mark off the page; what it read is kept, so opening it again shows it. */
export function closeTool(store: DocumentStore): void {
  const view = current(store);
  if (view.open || view.marked !== undefined) write(store, { ...view, open: false, marked: undefined });
}

/** Which section the tool shows. */
export function showSection(store: DocumentStore, section: AccessibilitySection): void {
  const view = current(store);
  if (view.section !== section) write(store, { ...view, section });
}

/** Checks the document: the PDF/UA rules its objects decide, with where each failure is. */
export async function runCheck(deps: AccessibilityDeps, store: DocumentStore): Promise<void> {
  const { docId } = store.getState();
  const run = current(store).sequence + 1;
  // THE OLD MARK GOES: it pointed at a finding of the check being replaced.
  write(store, { ...current(store), check: { phase: 'reading', run }, marked: undefined, sequence: run });
  const answer = await deps.client['document.accessibilityCheck']({ docId });
  const view = current(store);
  if (view.check?.run !== run) return;
  write(store, {
    ...view,
    check: answer.ok
      ? {
          phase: 'done',
          run,
          version: answer.value.version,
          rules: answer.value.rules,
          humanChecks: answer.value.humanChecks,
        }
      : { phase: 'refused', run },
  });
}

/** Reads the reading order of the page the person is on. */
export async function readOrder(deps: AccessibilityDeps, store: DocumentStore): Promise<void> {
  const { docId, page } = store.getState();
  const run = current(store).sequence + 1;
  write(store, { ...current(store), order: { phase: 'reading', run, page }, marked: undefined, sequence: run });
  const answer = await deps.client['document.pageStructure']({ docId, page });
  const view = current(store);
  if (view.order?.run !== run) return;
  write(store, {
    ...view,
    order: answer.ok
      ? {
          phase: 'done',
          run,
          page,
          version: answer.value.version,
          nodes: answer.value.nodes,
          truncated: answer.value.truncated,
          untaggedLines: answer.value.untaggedLines,
          images: answer.value.images,
        }
      : { phase: 'refused', run, page },
  });
}

/** Marks a place on the page, and takes the page to it. */
export function mark(store: DocumentStore, spot: Spot): void {
  const view = current(store);
  const arrival = view.sequence + 1;
  write(store, { ...view, marked: { spot, arrival }, sequence: arrival });
}

/** Clears the mark. */
export function clearMark(store: DocumentStore): void {
  const view = current(store);
  if (view.marked !== undefined) write(store, { ...view, marked: undefined });
}
