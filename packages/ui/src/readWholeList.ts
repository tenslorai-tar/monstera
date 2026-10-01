import type { DocVersion, Result } from '@monstera/shared';

/** What every part of a list that crosses in parts carries besides its items (`listPartNextSchema`). */
export interface ListPart {
  readonly version: DocVersion;
  readonly next: number | null;
}

/** A list read whole: its items in order, the version they were all read at, and the last part for its flags. */
export interface WholeList<Item, Part extends ListPart> {
  readonly version: DocVersion;
  readonly items: readonly Item[];
  readonly last: Part;
}

/**
 * Reads a list that crosses in parts, whole
 * ([ADR-0130](../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 2).
 *
 * The one loop over `next` in the renderer, for every list `main` answers in parts — the annotations, the form
 * fields, the outline. A reader that asked once would read the first part and take it for the list, which is the
 * 4,096-row cap this replaced arriving one layer up, so no caller asks a part channel for itself.
 *
 * ## THE VERSION IS COMPARED ACROSS PARTS
 *
 * Each part is cut from the list as it stood when that part was asked for. A command landing between two parts
 * moves the version, and the two halves then describe two documents — indices from one walk beside indices from
 * another, and every handle built from them points at the wrong mark. So a part at a different version from the
 * first starts the read again, from the top, and only a list read at ONE version is answered.
 *
 * A refusal of any part is the read's refusal: half a list is not an answer to *what does this document carry*.
 */
export async function readWholeList<Item, Part extends ListPart, Failure>(
  ask: (from: number) => Promise<Result<Part, Failure>>,
  itemsOf: (part: Part) => readonly Item[],
): Promise<Result<WholeList<Item, Part>, Failure>> {
  for (;;) {
    const read = await readOnce(ask, itemsOf);
    if (read !== 'moved') return read;
  }
}

async function readOnce<Item, Part extends ListPart, Failure>(
  ask: (from: number) => Promise<Result<Part, Failure>>,
  itemsOf: (part: Part) => readonly Item[],
): Promise<Result<WholeList<Item, Part>, Failure> | 'moved'> {
  const items: Item[] = [];
  let version: DocVersion | undefined;
  let from = 0;
  for (;;) {
    const answer = await ask(from);
    if (!answer.ok) return answer;
    const part = answer.value;
    if (version !== undefined && part.version !== version) return 'moved';
    version = part.version;
    items.push(...itemsOf(part));
    if (part.next === null) return { ok: true, value: { version, items, last: part } };
    // A NEXT THAT DOES NOT MOVE FORWARD would ask for the same part for ever. `main` cuts every part in one function,
    // so this is a defect there rather than a state a document can produce, and it throws.
    if (part.next <= from) throw new Error(`A list part from ${String(from)} named ${String(part.next)} as the next.`);
    from = part.next;
  }
}
