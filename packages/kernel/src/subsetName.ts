/**
 * A font name without its subset tag: `ABCDEF+Arimo-Regular` is a subset of `Arimo-Regular` — the rule is
 * `@monstera/shared`'s (`fontNames.ts`), so the font picker strips a tag by the same one
 * ([ADR-0250](../../../docs/DECISIONS/0250-the-font-picker-draws-each-family-in-itself.md)). Re-exported here for the
 * kernel's callers, which import it from this module.
 */
export { withoutSubsetTag } from '@monstera/shared';
