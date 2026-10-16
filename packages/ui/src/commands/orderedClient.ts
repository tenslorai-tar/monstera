import type { ChannelParams, ContractClient } from '@monstera/contract';

import { afterSentCommands } from './documentCommands.js';

/**
 * The channels that read a document as main holds it in order to write it out — to a file, a printer, an email, an
 * export, or a second document — and so must see every command this window already sent for that document.
 *
 * ## Why the order is the client's and not each caller's
 *
 * Commands go through one lane per document (`applyDocumentCommand`), which orders them, and these did not: a save
 * pressed while a command was still in the lane was sent first and read the document without it. Measured 2026-10-16,
 * the marks walk's C4.1: Bates numbering pressed, its dialog closed, then Save a copy, and the copy held the watermark
 * and the footer and no Bates number, while the page on screen showed EX-0001 once the command landed. A person doing
 * the same in the same order gets the same copy. Fifteen call sites each awaiting the lane would be a rule a sixteenth
 * forgets, so the client the window uses waits for them.
 */
export const READS_THE_DOCUMENT_OUT = [
  'document.save',
  'document.saveCopy',
  // NOT `document.editCopy`: it is sent from INSIDE the lane, by the command it carries (a signed document's *Work on a
  // copy*, `sendInLane`), so it follows that command by construction, and waiting for the lane would wait for itself.
  'document.workOnCopy',
  'document.extract',
  'document.split',
  'document.editPageExternally',
  'document.snapshotRegion',
  'document.print',
  'document.email',
  'document.optimize',
  'document.optimizeMeasure',
  'document.exportPageImages',
  'document.exportFormData',
  'document.exportText',
  'document.exportWord',
  'document.exportPowerPoint',
  'document.exportExcel',
  'document.exportPdfa',
  'document.exportAnnotations',
] as const satisfies readonly { [K in keyof ContractClient]: ChannelParams<K> extends { readonly docId: unknown } ? K : never }[keyof ContractClient][];

/**
 * `client`, with each of {@link READS_THE_DOCUMENT_OUT} sent only once the commands already in that document's lane
 * have been answered. The lane is keyed by the client the commands are sent through, so the window sends its commands
 * through the client this answers, never the one it was given.
 */
export function inWriteOrder(client: ContractClient): ContractClient {
  const ordered: ContractClient = { ...client };
  const record = ordered as unknown as Record<string, (params: { readonly docId: Parameters<typeof afterSentCommands>[1] }) => unknown>;
  const given = client as unknown as Record<string, (params: unknown) => unknown>;
  for (const id of READS_THE_DOCUMENT_OUT) {
    const send = given[id];
    if (send === undefined) throw new Error(`the contract client has no ${id}`);
    record[id] = async (params) => {
      await afterSentCommands(ordered, params.docId);
      return send(params);
    };
  }
  return ordered;
}
