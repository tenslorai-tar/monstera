/**
 * What the save-problem dialog says of a copy that was not written: ONE mapping from a copy channel's refusal to the
 * dialog's outcome, so every tool that writes a copy says the same thing of the same choice (B3a).
 *
 * ## A switch with no default, and its return type forbids `undefined`
 *
 * So a copy channel that grows a refusal is a compile error here rather than a branch every call site reads as
 * *contested*. That is exactly the defect this replaces: a copy onto the document's own file was answered `refused`
 * and every site turned it into *Another open document is writing to this file*, naming a document the person could
 * not find.
 */
export type CopyRefusalKind = 'refused' | 'destination-contested' | 'onto-source' | 'write-failed';

/** The dialog outcome for a copy channel's refusal. */
export function copyProblemOf(kind: CopyRefusalKind): 'contested' | 'onto-source' | 'write-failed' {
  switch (kind) {
    case 'refused':
    case 'destination-contested':
      return 'contested';
    case 'onto-source':
      return 'onto-source';
    case 'write-failed':
      return 'write-failed';
  }
}
