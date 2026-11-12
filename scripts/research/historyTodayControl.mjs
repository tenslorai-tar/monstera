// @ts-check
/**
 * ADR-0279's CONTROL, which measured the single `chat-history.json` store 1.1.2610.0 shipped (`createChatHistory`), with
 * the cipher it was HANDED, inside the pinned Electron binary's main process (`historyPerPdf.mjs`).
 *
 * THAT STORE IS GONE: ADR-0279 replaced it with one file per PDF, and the commit that wired the new store deleted
 * `apps/desktop/src/chatHistory.ts`. Its figures are recorded in the ADR's *Measurements* table. To read them again, run
 * `historyPerPdf.mjs` from a checkout of 628b8eaa, the last `main` that held the old store; here the control REFUSES,
 * rather than measure something else under its name.
 */

/**
 * @typedef {{ available: () => boolean, encrypt: (value: string) => Buffer, decrypt: (blob: Buffer) => string }} Cipher
 * @typedef {{ role: 'user' | 'assistant', text: string }} Turn
 */

/**
 * A made-up conversation of `questions` questions and their answers; `long` puts every answer at `MAX_ANSWER_TEXT`
 * (65,536 characters). The one builder both processes use, so the control and the shape measure the same words.
 * @param {number} questions @param {boolean} long @returns {Turn[]}
 */
export function conversationOf(questions, long) {
  return Array.from({ length: questions * 2 }, (_, at) =>
    at % 2 === 0
      ? { role: /** @type {const} */ ('user'), text: `Question ${String(at / 2 + 1)} about this page?` }
      : { role: /** @type {const} */ ('assistant'), text: long ? 'a'.repeat(65_536) : 'A short answer of a sentence or two, as most are.' },
  );
}

/**
 * @param {{ work: string, cipher: Cipher, short: Turn[], long: Turn[], say: (line: string) => void }} _input
 * @returns {Promise<never>}
 */
export function measureToday(_input) {
  return Promise.reject(
    new Error(
      'The control measured the chat-history.json store ADR-0279 replaced, which is no longer in this tree. Run ' +
        'historyPerPdf.mjs from a checkout of 628b8eaa to measure it; its figures are in the ADR.',
    ),
  );
}
