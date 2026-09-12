/**
 * The two ways signing refuses because of what a PERSON supplied.
 *
 * **Named where the knowledge is**, which is the kernel: main answers a signing
 * attempt with a sentence a person acts on, and before these existed it chose
 * that sentence by elimination — every failure that was not a document-state
 * class became *that password did not open the certificate*. That turned a
 * picture that would not decode into a wrong password, and would have turned a
 * failed flush into one too. Classification by elimination is a second opinion
 * about a question the component that failed already answered.
 *
 * **In a module that imports nothing**, so main's barrel can export both
 * classes without loading pdf-lib or the signer — ADR-0026's barrel discipline,
 * which `proof:kernelload` holds. The code that throws them lives in
 * `documentSign.ts`, behind the engine subpath.
 */

/**
 * Why a visible signature's appearance could not be drawn.
 *
 * - `unencodable-text` — the typed text holds a character the chosen standard
 *   font cannot encode. The font's own character set decides (B3a).
 * - `unreadable-image` — the picture's decoder refused its bytes.
 */
export type SignatureAppearanceRefusal = 'unencodable-text' | 'unreadable-image';

/** The appearance was refused before anything was signed. */
export class SignatureAppearanceRefusedError extends Error {
  readonly reason: SignatureAppearanceRefusal;

  constructor(reason: SignatureAppearanceRefusal, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SignatureAppearanceRefusedError';
    this.reason = reason;
  }
}

/**
 * The signer would not sign with the certificate it was given.
 *
 * **One class for two causes, and that is the format's limit rather than a
 * choice here**: a PKCS#12's MAC check fails the same way for a wrong
 * passphrase and for bytes that are not a PKCS#12 at all, so the signer cannot
 * tell them apart and neither can anything reading its error. Main's split
 * between `unreadable` and `wrong-passphrase` is made on which STAGE failed —
 * the read, or this — and not on this error's message.
 */
export class SignatureCredentialRefusedError extends Error {
  constructor(options?: ErrorOptions) {
    super('the signer refused the certificate: a wrong passphrase, or not a PKCS#12 it can open', options);
    this.name = 'SignatureCredentialRefusedError';
  }
}
