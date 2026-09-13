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

/**
 * The signature — with its timestamp token, when one was asked for — does not fit
 * the space the placeholder reserved.
 *
 * **Named, because `@signpdf` would otherwise refuse it for us** with a
 * `SignPdfError` of `TYPE_INPUT`, the same type as its other input refusals, and
 * this apply used to report every signer failure as a wrong password. A certificate
 * with a long chain can produce it; the check is made where the length is known,
 * before the bytes reach `@signpdf`.
 */
export class SignatureTooLargeError extends Error {
  readonly byteLength: number;
  readonly reserved: number;

  constructor(byteLength: number, reserved: number) {
    super(
      `the signature is ${String(byteLength)} bytes and the placeholder reserves ${String(reserved)}`,
    );
    this.name = 'SignatureTooLargeError';
    this.byteLength = byteLength;
    this.reserved = reserved;
  }
}

/**
 * The timestamp authority could not be asked: the transport threw, or answered
 * an HTTP error.
 *
 * Distinct from {@link TimestampRefusedError}, which is an authority that answered.
 * *Try again or choose another* is the sentence for this one; *that service will
 * not do this* is the sentence for the other.
 */
export class TimestampUnreachableError extends Error {
  constructor(options?: ErrorOptions) {
    super('the timestamp authority could not be reached', options);
    this.name = 'TimestampUnreachableError';
  }
}

/** Why an authority's reply was not accepted as a token. */
export type TimestampRefusal =
  /** The authority answered with a status other than granted. */
  | 'refused'
  /** The authority answered, and what it sent failed a check (ADR-0058 Decision 3). */
  | 'unverifiable';

/**
 * A reply that did not become a token, carrying which kind of failure it was.
 *
 * Here rather than in `timestampToken.ts`, for this module's own reason: that
 * module loads node-forge, and main's barrel must be able to name the class a
 * handler matches on without loading it.
 */
export class TimestampRefusedError extends Error {
  readonly reason: TimestampRefusal;

  constructor(reason: TimestampRefusal, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TimestampRefusedError';
    this.reason = reason;
  }
}
