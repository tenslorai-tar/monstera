// @ts-check
/**
 * Questions the threat model must raise, established before it existed.
 *
 * A requirement handed forward in prose is a requirement that gets dropped.
 * These apply to a document nobody has written yet, which is the worst possible
 * place to keep a note: by the time it is written, the reasoning is somewhere in
 * a journal entry nobody re-reads.
 *
 * Each entry names a `subject` the document must raise, and a second pattern
 * that distinguishes RAISING it from merely containing the word. The failure
 * mode here is a component list, not a silence — a document can name Leptonica
 * in a table of dependencies and say nothing about why it matters.
 *
 * A table rather than hand-written branches, because the list grows, and in a
 * separate module from the checker so a proof can exercise it without running
 * the whole document-consistency pass.
 *
 * `check:docs` applies these only when a threat model EXISTS. The document is
 * its own scheduled work, and a check that fails until then is one somebody
 * disables.
 *
 * @typedef {{
 *   name: string,
 *   subject: RegExp,
 *   engages: RegExp,
 *   missing: string,
 *   shallow: string,
 * }} Topic
 */

/** @type {Topic[]} */
export const THREAT_MODEL_TOPICS = [
  {
    // Leptonica is the security-relevant half of the OCR pair and does not read
    // like it. Tesseract has the CVEs with the recent dates and the
    // memory-safety language, so a threat model written from the advisory
    // register alone gives Tesseract a section and Leptonica a footnote —
    // exactly backwards. Tesseract's two live advisories are reached through a
    // crafted .traineddata MODEL, which this application ships and an attacker
    // does not supply. Leptonica parses IMAGE FORMATS, so the moment OCR becomes
    // reachable it processes attacker-controlled bytes lifted straight out of
    // the document.
    name: 'Leptonica on the untrusted-document path',
    subject: /leptonica/iu,
    engages: /leptonica[\s\S]{0,400}?(image format|image decod|untrusted)/iu,
    missing:
      'does not mention Leptonica. It is statically linked into the shim and it is the component ' +
      'that parses image formats, so when Stage 6 makes OCR reachable it handles ' +
      'attacker-controlled bytes from the document itself. Tesseract\'s live advisories are reached ' +
      'through a .traineddata model this application ships; Leptonica\'s exposure is the ' +
      'untrusted-document path.',
    shallow:
      'names Leptonica but not what makes it security-relevant. State that it parses image formats ' +
      'on the untrusted-document path — a name in a component list is not a threat model entry, ' +
      'and Leptonica\'s whole point is that it reads attacker bytes while Tesseract reads a model ' +
      'we ship.',
  },
  {
    // ADR-0015 scoped invariant 23 to the OUTPUT side, correctly, and in doing so
    // named a question it does not decide. `fz_open_document` scores handlers on
    // CONTENT as well as on the extension and takes the best, so a file the user
    // believed was a PDF can select the EPUB, XPS, CBZ, MOBI or Office handler —
    // a different parser, on the application's primary untrusted-input path.
    //
    // Measured 2026-08-18: `fz_register_document_handlers` registers fourteen
    // handlers, every `FZ_ENABLE_*` gate in config.h defaults to 1, our build
    // overrides none, and `gz_document_handler` carries no gate at all. So the
    // permitted set is INHERITED FROM THE BUILD, not chosen here — which is the
    // answer the threat model has to either accept deliberately or change.
    //
    // The exclusion in ADR-0015 must not be read as settling this. It is what
    // makes the question precise enough to act on.
    name: 'which document handlers are permitted',
    subject: /fz_open_document|document handler/iu,
    engages:
      /(fz_open_document|document handler)[\s\S]{0,600}?(epub|xps|cbz|mobi|sniff|magic byte|content)/iu,
    missing:
      'does not raise which DOCUMENT HANDLERS are permitted. fz_open_document scores handlers on ' +
      'content as well as on the filename and takes the best, so a file the user believed was a ' +
      'PDF can select the EPUB, XPS, CBZ, MOBI or Office parser — a different parser on the ' +
      'primary untrusted-input path. Fourteen are registered, every gate defaults to on, and this ' +
      'build overrides none, so the set is inherited rather than chosen. ADR-0015 excludes opening ' +
      'from invariant 23 deliberately; that exclusion is why this question is open, not evidence ' +
      'that it is settled.',
    shallow:
      'mentions document handlers without engaging with the mechanism. State which handlers are ' +
      'permitted and whether that set is named here or inherited from MuPDF\'s build defaults — ' +
      '"we only open PDFs" is a statement about intent, and handler selection is decided by ' +
      'content scoring, not by intent.',
  },
];

/**
 * @param {string} text The threat model's content.
 * @param {string} path Its repo-relative path, for the message.
 * @returns {string[]} One entry per topic the document fails to raise.
 */
export function unraisedTopics(text, path) {
  /** @type {string[]} */
  const problems = [];
  for (const topic of THREAT_MODEL_TOPICS) {
    if (!topic.subject.test(text)) problems.push(`${path} ${topic.missing}`);
    else if (!topic.engages.test(text)) problems.push(`${path} ${topic.shallow}`);
  }
  return problems;
}
