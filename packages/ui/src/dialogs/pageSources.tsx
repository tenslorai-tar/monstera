import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { createContext, useContext } from 'react';

/** One open document as the pictures of its pages are drawn from it: the parser reads it by this id, at this version. */
export interface PageSource {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
}

/**
 * What a dialog body needs to show the PAGES of another open document: the client the parser reads through, and the
 * version of the document it is to read.
 *
 * ## The shell provides it, because only the shell holds the client and the tabs
 *
 * A dialog's props are plain values the registry validates (`declareDialog`), and a client is not one. A body that
 * reached for the bridge itself would be a second route to the engine and an untestable one. The context is the
 * shell's own `tabs` and `client` handed down, the way `SideBySide` is handed the same two.
 *
 * `find` takes the id a dialog holds as a string and answers the branded source, or nothing for a document that is no
 * longer open — so a body never casts a string into a `DocId`.
 *
 * ABSENT IS A VALID VALUE: a body mounted without a provider shows each page as its number alone, which is enough to
 * choose by. A picker that needs the engine is a control that fails whenever the engine is busy.
 */
export interface PageSources {
  readonly client: ContractClient;
  readonly find: (docId: string) => PageSource | undefined;
}

export const PageSourcesContext = createContext<PageSources | undefined>(undefined);

/** The shell's page sources, or `undefined` where none is mounted (a test, a gallery). */
export function usePageSources(): PageSources | undefined {
  return useContext(PageSourcesContext);
}
