import type { CertificationLevel } from '@monstera/contract';

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
