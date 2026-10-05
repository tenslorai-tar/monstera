import type { CommandOfKind } from '@monstera/contract';

/**
 * The engine calls {@link sealCopy} needs, over one copy of a document: injected, so this module binds no native
 * library and the host's composition and an in-process proof take the same rule.
 */
export interface SealEngine<S> {
  /** Opens the copy with no key: its session and the access the engine answered, or `locked` when it needs a password. */
  readonly open: () => Promise<{ readonly session: S; readonly access: number } | 'locked'>;
  /** Applies the protect to the session. */
  readonly protect: (session: S, command: CommandOfKind<'setDocumentProtection'>) => Promise<void>;
  /** Serialises the session over the copy, and answers its new length. */
  readonly writeOver: (session: S) => Promise<number>;
  readonly close: (session: S) => Promise<void>;
}

/**
 * Replaces a plaintext copy of a document with one encrypted under `command`
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8),
 * and answers its new length, or `undefined` for a copy left as it was.
 *
 * **Plaintext is a copy that opens with no key and carries no encryption at all**: the engine's access `1`. A copy
 * that needs a password, or opens with none and answers `2` (an owner-only password), is encrypted already, and is left:
 * rewriting it would replace an owner password main never saw. The one spelling of that rule, for every copy a protect
 * seals and for every proof of it.
 */
export async function sealCopy<S>(
  command: CommandOfKind<'setDocumentProtection'>,
  engine: SealEngine<S>,
): Promise<number | undefined> {
  const opened = await engine.open();
  if (opened === 'locked') return undefined;
  try {
    if (opened.access !== 1) return undefined;
    await engine.protect(opened.session, command);
    return await engine.writeOver(opened.session);
  } finally {
    await engine.close(opened.session);
  }
}
