import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import type { DocumentFont, FontList } from './FontPicker.js';

/**
 * The fonts this computer has, asked of main once a session (`app.fontFamilies`) and held: the list does not change while
 * the application runs, and every picker shows the same one (B3a). A refusal reads as `listed: false`, which the picker
 * says in words and still offers the fonts every PDF has.
 */
const asked = new WeakMap<ContractClient, Promise<NonNullable<FontList>>>();

/**
 * The session's font list, asked of main once per client and held: the one way the renderer reads it (B3a), for a hook
 * ({@link useFontList}) and for a command that hands it to a dialog alike.
 */
export function fontListOf(client: ContractClient): Promise<NonNullable<FontList>> {
  const held = asked.get(client);
  if (held !== undefined) return held;
  const reading = client['app.fontFamilies']({}).then(
    (answer) => (answer.ok ? answer.value : { listed: false, families: [], more: 0 }),
    () => ({ listed: false, families: [], more: 0 }),
  );
  asked.set(client, reading);
  return reading;
}

/**
 * The font list, read the first time `wanted` is true and held after it; `undefined` until then and while it is read.
 * Not at start: a session that never formats words never asks main to read a computer's fonts.
 */
export function useFontList(client: ContractClient, wanted: boolean): FontList {
  const [list, setList] = useState<FontList>(undefined);
  useEffect(() => {
    if (!wanted) return undefined;
    let current = true;
    void fontListOf(client).then((read) => {
      if (current) setList(read);
    });
    return () => {
      current = false;
    };
  }, [client, wanted]);
  return list;
}

const NO_FONTS: readonly DocumentFont[] = [];

/**
 * Every font the document names (`document.fonts`, the owner's B2.8), for the picker's *In this document*; none while
 * `wanted` is false, while it is read, or where the read is refused, since the page's own fonts are still offered.
 * Read again at each `version`, because an edit can add a font.
 */
export function useDocumentFonts(
  client: ContractClient,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  wanted: boolean,
): readonly DocumentFont[] {
  // HELD WITH THE DOCUMENT IT IS OF, so a tab switched to never shows the last tab's fonts while its own are read.
  const [read, setRead] = useState<{ readonly docId: DocId; readonly fonts: readonly DocumentFont[] } | undefined>(undefined);
  useEffect(() => {
    if (!wanted || docId === undefined) return undefined;
    let current = true;
    void client['document.fonts']({ docId }).then(
      (answer) => {
        if (current) setRead({ docId, fonts: answer.ok ? answer.value.fonts : NO_FONTS });
      },
      () => {
        if (current) setRead({ docId, fonts: NO_FONTS });
      },
    );
    return () => {
      current = false;
    };
  }, [client, docId, version, wanted]);
  return wanted && read !== undefined && read.docId === docId ? read.fonts : NO_FONTS;
}
