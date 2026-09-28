import { LOG_DETAIL_SETTING_ID } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { createRequestLog } from './requestLog.js';

/**
 * The detailed log's lines (ADR-0119): what is written, at which level, and what never is.
 *
 * The observer is driven directly with the arguments `registerContractHandlers` hands it — that file proves the
 * hand-over — and the stored settings are a value this file changes between calls, the way a settings save does.
 */

/** A store the case can change, and the lines written. */
function logOver(initial: Readonly<Record<string, unknown>>): {
  readonly observe: ReturnType<typeof createRequestLog>;
  readonly lines: string[];
  readonly store: (values: Readonly<Record<string, unknown>>) => void;
} {
  let stored = initial;
  const lines: string[] = [];
  const observe = createRequestLog({ read: () => stored }, (kind, detail) => lines.push(`${kind} ${detail}`));
  return {
    observe,
    lines,
    store: (values) => {
      stored = values;
    },
  };
}

const DETAILED = { [LOG_DETAIL_SETTING_ID]: 'detailed' };

/** A command the `document.execute` schema accepts, so its kind can be read. */
const ROTATE = { docId: '00000000-0000-4000-8000-000000000001', command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 } };

describe('the detailed log', () => {
  it('writes NOTHING at the default level, which is today’s log', () => {
    const { observe, lines } = logOver({});
    observe('app.info', {}, 'ok', 3);
    observe('document.execute', ROTATE, 'ok', 12);
    expect(lines).toStrictEqual([]);
  });

  it('writes one line per request when Detailed: the channel, the outcome and the rounded milliseconds', () => {
    const { observe, lines } = logOver(DETAILED);
    observe('app.info', {}, 'ok', 3.4);
    observe('document.save', { docId: 'x', breakSignatures: false }, 'document-busy', 41.6);
    expect(lines).toStrictEqual(['REQUEST app.info ok 3ms', 'REQUEST document.save document-busy 42ms']);
  });

  it('names a command’s KIND, read by the channel’s schema — and nothing for params the schema refuses', () => {
    const { observe, lines } = logOver(DETAILED);
    observe('document.execute', ROTATE, 'ok', 12);
    observe('document.execute', { docId: '', command: null }, 'internal', 1);
    expect(lines).toStrictEqual(['REQUEST document.execute rotatePages ok 12ms', 'REQUEST document.execute internal 1ms']);
  });

  it('never writes what a person typed', () => {
    // A SEARCH QUERY is the plainest case of a parameter that is content. The line must carry the channel and not
    // a character of the query.
    const { observe, lines } = logOver(DETAILED);
    observe('document.searchPage', { docId: 'x', page: 0, query: 'Confidential salary figures', limit: 10 }, 'ok', 5);
    expect(lines).toStrictEqual(['REQUEST document.searchPage ok 5ms']);
    expect(lines.join('\n')).not.toMatch(/salary/iu);
  });

  it('leaves out the byte ranges PDF.js reads, and CONTROL: not the request beside them', () => {
    const { observe, lines } = logOver(DETAILED);
    observe('document.readRange', { docId: 'x', begin: 0, end: 65536 }, 'ok', 1);
    observe('document.viewModel', { docId: 'x', pages: [0] }, 'ok', 2);
    expect(lines).toStrictEqual(['REQUEST document.viewModel ok 2ms']);
  });

  it('takes a change of level at the SAVE that made it, not at the next start', () => {
    const { observe, lines, store } = logOver({});
    observe('app.info', {}, 'ok', 1);
    store(DETAILED);
    observe('settings.save', { values: DETAILED }, 'ok', 4);
    observe('app.info', {}, 'ok', 1);
    // THE SAVE THAT TURNED IT ON is the first line, and the request before it is not written.
    expect(lines).toStrictEqual(['REQUEST settings.save ok 4ms', 'REQUEST app.info ok 1ms']);
  });

  it('CONTROL: a save that did not land changes nothing, since the store was not written', () => {
    const { observe, lines, store } = logOver({});
    store(DETAILED);
    observe('settings.save', { values: DETAILED }, 'internal', 4);
    observe('app.info', {}, 'ok', 1);
    expect(lines).toStrictEqual([]);
  });
});
