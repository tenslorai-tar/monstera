import forge from 'node-forge';

/**
 * A context-specific ASN.1 element, and the test for one, through forge: the `[0]`, `[1]` and `[2]` tags the signing
 * structures carry (RFC 5652's SignedData and SignerInfo, RFC 4055's RSASSA-PSS parameters).
 *
 * forge types an element's tag NUMBER as its universal `asn1.Type` enum, which names the UNIVERSAL class's tags only.
 * Under CONTEXT_SPECIFIC the same number is a context tag — `[0]` is `NONE`'s number, `[1]` `BOOLEAN`'s, `[2]`
 * `INTEGER`'s — and the class decides which it means. So the number is reached through the enum's own members here, once,
 * rather than asserted into the enum at every call, where nothing would check it.
 */
const CONTEXT_TAG = { 0: forge.asn1.Type.NONE, 1: forge.asn1.Type.BOOLEAN, 2: forge.asn1.Type.INTEGER } as const;

/** A context tag the signing structures use. */
export type ContextTag = keyof typeof CONTEXT_TAG;

/** `[tag]`, constructed, around `children`. */
export function contextTagged(tag: ContextTag, children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, CONTEXT_TAG[tag], true, children);
}

/** Whether `field` is `[tag]`. */
export function isContextTag(field: forge.asn1.Asn1, tag: ContextTag): boolean {
  return field.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && field.type === CONTEXT_TAG[tag];
}
