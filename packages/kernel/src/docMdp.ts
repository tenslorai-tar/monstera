import type { CertificationLevel } from '@monstera/contract';

import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * `/DocMDP`'s `/P`, by the word the payload carries, ONCE for the signer that writes it and the reader that obeys it
 * ([ADR-0291](../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)).
 *
 * ISO 32000-2 table 257. Keyed on the contract's own enum, so a level added there without a number here is a compile
 * error rather than a certification that silently permits everything.
 */
export const DOC_MDP_LEVELS: Readonly<Record<CertificationLevel, number>> = {
  'no-changes': 1,
  'form-fill': 2,
  'form-fill-and-annotate': 3,
};

/**
 * The level a `/P` value states. Absent is 2, the format's own default (ISO 32000-1 §12.8.2.2.2). Any other value is
 * read as `no-changes`, the strictest: a certifier's word that cannot be read is not a licence (ADR-0291 Decision 1).
 */
export function levelOfDocMdp(p: number | undefined): CertificationLevel {
  if (p === undefined) return 'form-fill';
  for (const [level, value] of Object.entries(DOC_MDP_LEVELS) as [CertificationLevel, number][]) {
    if (value === p) return level;
  }
  return 'no-changes';
}

/** Whether the catalogue carries `/Perms /DocMDP`, the one place a certification is declared. */
export function carriesCertification(document: PDFDocument): boolean {
  const perms = document.getTrailer().get('Root').get('Perms');
  return perms.isDictionary() && !perms.get('DocMDP').isNull();
}

/**
 * `save`'s answer for `document` with its certification taken out, and the document put back exactly as it was
 * afterwards, whatever `save` did (ADR-0291 Decision 5; `savedWithoutOutline`'s shape).
 *
 * Two places hold it: the catalogue's `/Perms /DocMDP`, and the certifying signature's `/Reference` entry whose
 * `/TransformMethod` is `/DocMDP`. Both go, so neither states what the other no longer does. The signature itself
 * stays (preserve, never drop), and reads as not covering the copy, which is true.
 */
export function savedUncertified<T>(document: PDFDocument, save: () => T): T {
  const perms = document.getTrailer().get('Root').get('Perms');
  if (!perms.isDictionary()) return save();
  const signature = perms.get('DocMDP');
  const references = signature.isDictionary() ? signature.get('Reference') : null;
  const restore: (() => void)[] = [];
  try {
    // `/DocMDP` ONLY, never the whole `/Perms`: it may hold `/UR3` (usage rights), which is not a certification, and an
    // empty `/Perms` certifies nothing.
    perms.delete('DocMDP');
    restore.push(() => {
      perms.put('DocMDP', signature);
    });
    if (references !== null && references.isArray() && signature.isDictionary()) {
      const kept = document.newArray();
      const listed: PDFObject[] = [];
      references.forEach((reference) => {
        listed.push(reference);
      });
      for (const reference of listed) if (String(reference.get('TransformMethod')) !== '/DocMDP') kept.push(reference);
      if (kept.length === 0) signature.delete('Reference');
      else signature.put('Reference', kept);
      restore.push(() => {
        signature.put('Reference', references);
      });
    }
    return save();
  } finally {
    for (const step of restore.reverse()) step();
  }
}
