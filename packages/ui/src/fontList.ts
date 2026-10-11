import type { ContractClient } from '@monstera/contract';
import { useEffect, useState } from 'react';

import type { FontList } from './FontPicker.js';

/**
 * The fonts this computer has, asked of main once a session (`app.fontFamilies`) and held: the list does not change while
 * the application runs, and every picker shows the same one (B3a). A refusal reads as `listed: false`, which the picker
 * says in words and still offers the fonts every PDF has.
 */
const asked = new WeakMap<ContractClient, Promise<NonNullable<FontList>>>();

function listOf(client: ContractClient): Promise<NonNullable<FontList>> {
  const held = asked.get(client);
  if (held !== undefined) return held;
  const reading = client['app.fontFamilies']({}).then(
    (answer) => (answer.ok ? answer.value : { listed: false, families: [] }),
    () => ({ listed: false, families: [] }),
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
    void listOf(client).then((read) => {
      if (current) setList(read);
    });
    return () => {
      current = false;
    };
  }, [client, wanted]);
  return list;
}
