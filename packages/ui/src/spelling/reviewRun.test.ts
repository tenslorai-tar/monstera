import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok, tokensOf } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { type DocumentStore, createDocumentStore } from '../documentStores.js';
import {
  PROBLEM_COMMENT_TOO_LONG,
  SPELLING_CHANGED,
  SPELLING_DICTIONARY_FULL,
  SPELLING_NOT_SHOWN,
  TEXT_NOT_IN_PLACE,
} from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import {
  MAX_PERSONAL_WORDS,
  PERSONAL_DICTIONARY_SETTING,
  SPELLING_COMMENTS_SETTING,
  SPELLING_FIELDS_SETTING,
} from '../settings/editing.js';
import { SettingsStore } from '../settingsStore.js';
import type { SpellingReviewing } from './review.js';
import {
  type SpellingDeps,
  addToDictionary,
  coverChanged,
  ignoreAll,
  ignoreWord,
  replaceAll,
  replaceWord,
  startReview,
  stopReview,
} from './reviewRun.js';

/**
 * A spelling review's reads and edits (ADR-0156), against a scripted document whose edits change its text — so every
 * re-read after an edit sees the edit, and a case about what the review does next is about the document it changed.
 *
 * ## The geometry is stated so the point can be asserted
 *
 * Each page is drawn 600 x 800 at rotation 0, so `toPdf` maps a display point (x, y) to (x, 800 - y). Line `i`'s box
 * runs from y = 20i + 4 to 20i + 16, and each token is 6 points a character from x = 10, as `tokensOf` cuts it. The
 * document's `replaceTextAt` reads the point back through the same numbers, so a point the review got wrong lands on
 * another word or none, and is refused as the kernel would refuse it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000005e1');
const AFFIX = 'SET UTF-8\n';
const VOCABULARY = ['document', 'page', 'the', 'on', 'and', 'cat', 'dog', 'note', 'field', 'see', 'one', 'two', 'end', 'here'];
const WORDS = `${String(VOCABULARY.length)}\n${VOCABULARY.join('\n')}\n`;
const HEIGHT = 800;

interface Comment {
  page: number;
  index: number;
  /** Its whole words. The walk lists them cut at 512 characters and says so, as the kernel's does. */
  contents: string;
  /** Longer than an edit can write back, so its whole words are answered `whole: false`. */
  tooLong?: true;
}

interface Field {
  page: number;
  index: number;
  name: string;
  value: string;
  readOnly?: boolean;
  cut?: true;
}

interface Script {
  version: number;
  pages: string[][];
  comments: Comment[];
  fields: Field[];
  /** `page:line` keys whose text `replaceAllText` cannot reach — a word split across two text objects. */
  split: Set<string>;
  /** Refuse every `replaceTextAt` with this code. */
  refuseAt?: 'text-not-in-place' | 'internal';
  /** Called before each text-layer read of a page, so a case can move the document mid-walk. */
  beforeRead?: (page: number) => void;
  dictionary: boolean;
  /** Every page's rotation and shown box, where a case turns or offsets the page; upright at the origin otherwise. */
  shown?: { readonly rotation: number; readonly crop: readonly [number, number, number, number] };
}

function boxOf(line: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: 0, y0: line * 20 + 4, x1: 590, y1: line * 20 + 16 };
}

/** Every token's box in a line, flat, as `document.pageWordBoxes` answers. */
function tokenBoxes(text: string, line: number): number[] {
  const { y0, y1 } = boxOf(line);
  return [...tokensOf(text)].flatMap((token) => [10 + token.index * 6, y0, 10 + (token.index + token.text.length) * 6, y1]);
}

/** `text` with every whole-word occurrence of `find` replaced, as `replaceAllText` with both flags would. */
function replacedWords(text: string, find: string, replace: string): string {
  let result = '';
  let at = 0;
  for (const token of tokensOf(text)) {
    if (token.isWord && token.text === find) {
      result += text.slice(at, token.index) + replace;
      at = token.index + token.text.length;
    }
  }
  return result + text.slice(at);
}

function harness(script: Script): {
  readonly deps: SpellingDeps;
  readonly store: DocumentStore;
  readonly settings: SettingsStore;
  readonly sent: unknown[];
  readonly asked: { id: string; props: unknown }[];
  readonly read: number[];
} {
  const sent: unknown[] = [];
  const asked: { id: string; props: unknown }[] = [];
  const read: number[] = [];
  const version = (): ReturnType<typeof asDocVersion> => asDocVersion(script.version);
  const moved = (): unknown => {
    script.version += 1;
    return ok({ version: version(), byteLength: 1, historyDropped: 0 });
  };
  const client = createClient(channels, (id, raw) => {
    const params = raw as Record<string, unknown>;
    switch (id) {
      case 'spelling.dictionary':
        return Promise.resolve(
          script.dictionary
            ? ok({ kind: 'dictionary', language: 'en', affix: new TextEncoder().encode(AFFIX), words: new TextEncoder().encode(WORDS) })
            : ok({ kind: 'unknown-dictionary' }),
        );
      case 'document.pageTextLayer': {
        const page = params['page'] as number;
        script.beforeRead?.(page);
        read.push(page);
        const lines = script.pages[page] ?? [];
        return Promise.resolve(
          ok({
            version: version(),
            lines: lines.map((text, line) => ({ text, box: boxOf(line) })),
            truncated: false,
            kind: lines.length > 0 ? 'text' : 'empty',
          }),
        );
      }
      case 'document.pageWordBoxes': {
        const lines = script.pages[params['page'] as number] ?? [];
        return Promise.resolve(
          ok({
            version: version(),
            lines: lines.map((text, line) => ({ text, box: boxOf(line), boxes: tokenBoxes(text, line) })),
            truncated: false,
          }),
        );
      }
      case 'document.viewModel':
        return Promise.resolve(
          ok({
            version: version(),
            pageCount: script.pages.length,
            rotations: (params['pages'] as number[]).map(() => script.shown?.rotation ?? 0),
          }),
        );
      case 'document.annotations':
        return Promise.resolve(
          ok({
            version: version(),
            annotations: script.comments.map((comment) => ({
              page: comment.page,
              index: comment.index,
              rect: null,
              style: { colour: [1, 1, 0], opacity: 1, borderWidth: 1 },
              kind: 'sticky-note',
              contents: comment.contents.slice(0, 512),
              authored: true,
              inReplyTo: null,
              author: '',
              created: null,
              blend: 'normal',
              ...(comment.contents.length > 512 || comment.tooLong === true ? { cut: true } : {}),
            })),
            next: null,
            truncated: false,
          }),
        );
      case 'document.annotationWords': {
        const comment = script.comments.find((each) => each.page === params['page'] && each.index === params['index']);
        const text = comment?.contents ?? '';
        return Promise.resolve(ok({ kind: 'words', text, whole: comment?.tooLong !== true }));
      }
      case 'document.formFields':
        return Promise.resolve(
          ok({
            version: version(),
            fields: script.fields.map((field) => ({
              page: field.page,
              index: field.index,
              kind: 'text',
              name: field.name,
              values: field.value === '' ? [] : [field.value],
              on: null,
              options: [],
              readOnly: field.readOnly === true,
              multiline: false,
              rect: null,
              ...(field.cut === undefined ? {} : { cut: true }),
            })),
            next: null,
            truncated: false,
          }),
        );
      case 'document.execute': {
        const command = params['command'] as Record<string, unknown>;
        sent.push(command);
        if (command['kind'] === 'replaceTextAt') {
          if (script.refuseAt === 'internal') return Promise.resolve(err({ code: 'internal', incident: 'incident-7' }));
          if (script.refuseAt !== undefined) return Promise.resolve(err({ code: script.refuseAt }));
          const at = command['at'] as { x: number; y: number };
          const y = HEIGHT - at.y;
          const lines = script.pages[command['page'] as number] ?? [];
          const line = lines.findIndex((_, index) => y >= boxOf(index).y0 && y <= boxOf(index).y1);
          const text = lines[line];
          const token = text === undefined ? undefined : [...tokensOf(text)].find((each) => at.x >= 10 + each.index * 6 && at.x <= 10 + (each.index + each.text.length) * 6);
          if (text === undefined || token === undefined || token.text !== command['find']) {
            return Promise.resolve(err({ code: 'text-not-in-place' }));
          }
          lines[line] = text.slice(0, token.index) + String(command['replace']) + text.slice(token.index + token.text.length);
          return Promise.resolve(moved());
        }
        if (command['kind'] === 'replaceAllText') {
          for (const [page, lines] of script.pages.entries()) {
            for (const [line, text] of lines.entries()) {
              if (script.split.has(`${String(page)}:${String(line)}`)) continue;
              lines[line] = replacedWords(text, String(command['find']), String(command['replace']));
            }
          }
          return Promise.resolve(moved());
        }
        if (command['kind'] === 'editAnnotationText' || command['kind'] === 'fillFormField') {
          if (command['version'] !== version()) return Promise.resolve(err({ code: 'stale-target' }));
          if (command['kind'] === 'editAnnotationText') {
            const comment = script.comments.find((each) => each.page === command['page'] && each.index === command['index']);
            if (comment !== undefined) comment.contents = String(command['text']);
          } else {
            const field = script.fields.find((each) => each.page === command['page'] && each.index === command['index']);
            if (field !== undefined) field.value = (command['value'] as { text: string }).text;
          }
          return Promise.resolve(moved());
        }
        throw new Error(`unexpected command ${String(command['kind'])}`);
      }
      default:
        throw new Error(`unexpected channel ${id}`);
    }
  });
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const store = createDocumentStore(DOC, asDocVersion(script.version));
  const deps: SpellingDeps = {
    client,
    settings,
    commands: {
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve(undefined);
      },
      stamp: () => ({ author: 'A. Tester', created: '2026-10-04T12:00:00.000Z' }),
      signatures: {
        warn: () => true,
        onOpened: () => {
          throw new Error('the case opened a copy for an edit without asking for one');
        },
      },
    },
    cropOf: (docId, page) => (docId === DOC && page < script.pages.length ? (script.shown?.crop ?? [0, 0, 600, HEIGHT]) : undefined),
  };
  return { deps, store, settings, sent, asked, read };
}

function script(over: Partial<Script> = {}): Script {
  return { version: 1, pages: [], comments: [], fields: [], split: new Set(), dictionary: true, ...over };
}

function reviewOf(store: DocumentStore): SpellingReviewing {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing') throw new Error(`the review is ${held?.phase ?? 'not started'}`);
  return held;
}

const currentWord = (store: DocumentStore): string | undefined => reviewOf(store).current?.word;

describe('starting a review', () => {
  it('reads EVERY page and shows the first misspelt word, in reading order, with suggestions', async () => {
    const { deps, store, read } = harness(script({ pages: [['the documnet'], ['page teh']] }));
    await startReview(deps, store, 2);
    expect(read).toStrictEqual([0, 1]);
    const review = reviewOf(store);
    expect(review.occurrences.map((each) => each.word)).toStrictEqual(['documnet', 'teh']);
    expect(review.current?.place).toStrictEqual({ kind: 'text', page: 0, line: 0, offset: 4 });
    expect(review.suggestions).toContain('document');
  });

  it('PASSES a word in the personal dictionary, so a review shows the next one (the round trip the feature is for)', async () => {
    // THE SAME PAGES as the case above, where `documnet` is the first word shown — that case is the control. Held
    // here because only this case puts a personal word on the page (audit P-5): `buildChecker` honours the list, and
    // this is what says the review hands it in.
    const { deps, store, settings } = harness(script({ pages: [['the documnet'], ['page teh']] }));
    settings.set(PERSONAL_DICTIONARY_SETTING.id, ['documnet']);
    await startReview(deps, store, 2);
    expect(currentWord(store)).toBe('teh');
  });

  it('READS AGAIN FROM THE FIRST PAGE when the document moves under the walk, so its words describe one version', async () => {
    const doc = script({ pages: [['documnet'], ['page']] });
    let movedOnce = false;
    doc.beforeRead = (page) => {
      if (page === 1 && !movedOnce) {
        movedOnce = true;
        doc.version += 1;
      }
    };
    const { deps, store, read } = harness(doc);
    await startReview(deps, store, 2);
    // PAGE 1 ANSWERED AT ANOTHER VERSION, so the walk began again: 0, 1, then 0 and 1 at one version.
    expect(read).toStrictEqual([0, 1, 0, 1]);
    expect(reviewOf(store).occurrences).toHaveLength(1);
  });

  it('says the dictionary is missing, and reads NO page — never an empty review that reads as clean', async () => {
    const { deps, store, read } = harness(script({ pages: [['documnet']], dictionary: false }));
    await startReview(deps, store, 1);
    expect(store.getState().spelling?.phase).toBe('unavailable');
    expect(read).toStrictEqual([]);
  });

  it('covers comments and text fields, on their pages, and leaves a read-only field out', async () => {
    const { deps, store } = harness(
      script({
        pages: [['documnet'], ['page']],
        comments: [{ page: 0, index: 0, contents: 'see teh note' }],
        fields: [
          { page: 1, index: 0, name: 'notes', value: 'cat dgo' },
          { page: 1, index: 1, name: 'locked', value: 'dgo' , readOnly: true },
        ],
      }),
    );
    await startReview(deps, store, 2);
    expect(reviewOf(store).occurrences.map((each) => `${each.place.kind}:${each.word}`)).toStrictEqual([
      'text:documnet',
      'comment:teh',
      'field:dgo',
    ]);
  });

  it('CONTROL: with both options off, only the page text is reviewed', async () => {
    const { deps, store, settings } = harness(
      script({ pages: [['documnet']], comments: [{ page: 0, index: 0, contents: 'teh' }], fields: [{ page: 0, index: 0, name: 'f', value: 'dgo' }] }),
    );
    settings.set(SPELLING_COMMENTS_SETTING.id, false);
    settings.set(SPELLING_FIELDS_SETTING.id, false);
    await startReview(deps, store, 1);
    expect(reviewOf(store).occurrences.map((each) => each.word)).toStrictEqual(['documnet']);
  });

  it('a STOPPED review writes nothing when its reads come back', async () => {
    const doc = script({ pages: [['documnet']] });
    const { deps, store } = harness(doc);
    doc.beforeRead = () => {
      stopReview(store);
    };
    await startReview(deps, store, 1);
    expect(store.getState().spelling).toBeUndefined();
  });
});

describe('passing over a word', () => {
  it('Ignore moves to the next occurrence, and Ignore all passes every later one of the word, whatever its case', async () => {
    const { deps, store } = harness(script({ pages: [['teh documnet Teh teh dgo']] }));
    await startReview(deps, store, 1);
    expect(currentWord(store)).toBe('teh');
    ignoreWord(store);
    expect(currentWord(store)).toBe('documnet');
    ignoreWord(store);
    expect(currentWord(store)).toBe('Teh');
    ignoreAll(store);
    expect(currentWord(store)).toBe('dgo');
    ignoreWord(store);
    expect(reviewOf(store).current).toBeUndefined();
  });

  it('Add to dictionary keeps the word for later reviews, merged and once, and passes it now', async () => {
    const { deps, store, settings } = harness(script({ pages: [['Monstera documnet monstera']] }));
    settings.set(PERSONAL_DICTIONARY_SETTING.id, ['Already']);
    await startReview(deps, store, 1);
    addToDictionary(deps, store);
    expect(settings.get(PERSONAL_DICTIONARY_SETTING.id)).toStrictEqual(['Already', 'Monstera']);
    // THE LOWER-CASE ONE IS PASSED TOO, as the personal dictionary compares without case.
    expect(currentWord(store)).toBe('documnet');
    ignoreWord(store);
    expect(reviewOf(store).current).toBeUndefined();
  });

  it('says a FULL dictionary rather than dropping the word, and stays on it', async () => {
    const { deps, store, settings } = harness(script({ pages: [['documnet']] }));
    settings.set(
      PERSONAL_DICTIONARY_SETTING.id,
      Array.from({ length: MAX_PERSONAL_WORDS }, (_, at) => `word${String(at)}`),
    );
    await startReview(deps, store, 1);
    addToDictionary(deps, store);
    expect(reviewOf(store).notice).toBe(SPELLING_DICTIONARY_FULL);
    expect(currentWord(store)).toBe('documnet');
    expect((settings.get(PERSONAL_DICTIONARY_SETTING.id) as string[]).includes('documnet')).toBe(false);
  });
});

describe('replacing one occurrence on the page', () => {
  it('sends replaceTextAt with the word’s centre in PDF user space, and the review moves to the NEXT word', async () => {
    const { deps, store, sent } = harness(script({ pages: [['the documnet teh', 'teh']] }));
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'document');
    // `documnet` is token 1 of line 0, at offset 4: x from 10 + 4*6 = 34 to 10 + 12*6 = 82, so 58; y 4 to 16, so 10,
    // which is 800 - 10 = 790 in PDF space.
    expect(sent).toStrictEqual([{ kind: 'replaceTextAt', page: 0, find: 'documnet', replace: 'document', at: { x: 58, y: 790 } }]);
    const review = reviewOf(store);
    expect(review.current?.word).toBe('teh');
    expect(review.current?.place).toStrictEqual({ kind: 'text', page: 0, line: 0, offset: 13 });
    expect(review.replaced).toBe(1);
  });

  // THE HARD SHAPE: the word boxes are in the shown page's space, so a page whose box starts away from the origin, and
  // one turned as well, must each land the point where the word is in user space. Worked by hand rather than through
  // `toPdf`, so a wrong transform cannot agree with itself. The word's centre is (58, 10) as shown in every case.
  it('a page whose box starts at (50, 100) puts the point at the box’s origin plus the shown point, y up from the box top', async () => {
    const { deps, store, sent } = harness(
      script({ pages: [['the documnet']], shown: { rotation: 0, crop: [50, 100, 650, 900] } }),
    );
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'document');
    // x: 50 + 58. y: the box's top, 900, less 10 down from it.
    expect(sent).toStrictEqual([{ kind: 'replaceTextAt', page: 0, find: 'documnet', replace: 'document', at: { x: 108, y: 890 } }]);
  });

  it('the same page TURNED 90 degrees takes the shown x up the page and the shown y across it', async () => {
    const { deps, store, sent } = harness(
      script({ pages: [['the documnet']], shown: { rotation: 90, crop: [50, 100, 650, 900] } }),
    );
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'document');
    // Turned clockwise, the page's left edge is the top of what is shown and its bottom edge the left: so user x is the
    // box's left plus the shown y (50 + 10), and user y the box's bottom plus the shown x (100 + 58).
    expect(sent).toStrictEqual([{ kind: 'replaceTextAt', page: 0, find: 'documnet', replace: 'document', at: { x: 60, y: 158 } }]);
  });

  it('says a word that cannot be replaced in place, in the panel and not a dialog, and stays on it', async () => {
    const { deps, store, asked } = harness(script({ pages: [['documnet']], refuseAt: 'text-not-in-place' }));
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'document');
    expect(reviewOf(store).notice).toBe(TEXT_NOT_IN_PLACE);
    expect(currentWord(store)).toBe('documnet');
    expect(asked).toStrictEqual([]);
  });

  it('CONTROL: an internal refusal goes to the problem dialog, which shows its reference', async () => {
    const { deps, store, asked } = harness(script({ pages: [['documnet']], refuseAt: 'internal' }));
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'document');
    expect(asked).toStrictEqual([{ id: COMMAND_PROBLEM_DIALOG_ID, props: { code: 'internal', incident: 'incident-7' } }]);
  });

  it('sends NOTHING for a line that changed after it was read, reads it again, and says so', async () => {
    const doc = script({ pages: [['the documnet']] });
    const { deps, store, sent } = harness(doc);
    await startReview(deps, store, 1);
    doc.pages[0] = ['a documnet here'];
    await replaceWord(deps, store, 'document');
    expect(sent).toStrictEqual([]);
    const review = reviewOf(store);
    expect(review.notice).toBe(SPELLING_CHANGED);
    expect(review.current?.context).toBe('a documnet here');
  });

  it('sends nothing for a page that has not been drawn, and says to choose Replace again once it is', async () => {
    const { deps, store, sent } = harness(script({ pages: [['documnet']] }));
    await startReview(deps, store, 1);
    await replaceWord({ ...deps, cropOf: () => undefined }, store, 'document');
    expect(sent).toStrictEqual([]);
    expect(reviewOf(store).notice).toBe(SPELLING_NOT_SHOWN);
  });
});

describe('replacing in a comment and in a field', () => {
  it('edits the comment’s whole words at the version the lists were read at', async () => {
    const { deps, store, sent } = harness(script({ pages: [[]], comments: [{ page: 0, index: 2, contents: 'see teh note' }] }));
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'the');
    expect(sent).toStrictEqual([{ kind: 'editAnnotationText', page: 0, index: 2, text: 'see the note', version: asDocVersion(1) }]);
    expect(reviewOf(store).current).toBeUndefined();
  });

  it('edits a CUT comment from its whole words, never the listing’s slice', async () => {
    const whole = `teh ${'note '.repeat(120)}end`;
    const { deps, store, sent } = harness(script({ pages: [[]], comments: [{ page: 0, index: 0, contents: whole }] }));
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'the');
    expect(sent).toStrictEqual([{ kind: 'editAnnotationText', page: 0, index: 0, text: `the${whole.slice(3)}`, version: asDocVersion(1) }]);
  });

  it('SHOWS a word in a comment too long to edit, and refuses to write it, saying why', async () => {
    const { deps, store, sent } = harness(
      script({ pages: [[]], comments: [{ page: 0, index: 0, contents: 'teh note', tooLong: true }] }),
    );
    await startReview(deps, store, 1);
    expect(currentWord(store)).toBe('teh');
    await replaceWord(deps, store, 'the');
    expect(sent).toStrictEqual([]);
    expect(reviewOf(store).notice).toBe(PROBLEM_COMMENT_TOO_LONG);
  });

  it('fills a text field with its value spliced, and leaves a field listed cut unwritten', async () => {
    const { deps, store, sent } = harness(
      script({
        pages: [[]],
        fields: [
          { page: 0, index: 0, name: 'pet', value: 'cat dgo' },
          { page: 0, index: 1, name: 'long', value: 'dgo', cut: true },
        ],
      }),
    );
    await startReview(deps, store, 1);
    await replaceWord(deps, store, 'dog');
    expect(sent).toStrictEqual([
      { kind: 'fillFormField', page: 0, index: 0, value: { set: 'text', text: 'cat dog' }, version: asDocVersion(1) },
    ]);
    expect(reviewOf(store).current?.name).toBe('long');
    await replaceWord(deps, store, 'dog');
    expect(sent).toHaveLength(1);
    expect(reviewOf(store).notice).toBe(PROBLEM_COMMENT_TOO_LONG);
  });
});

describe('replacing every occurrence', () => {
  it('sends ONE replaceAllText for the page text, then one edit per comment and field that holds the word', async () => {
    const { deps, store, sent } = harness(
      script({
        pages: [['teh cat', 'teh'], ['dog teh']],
        comments: [{ page: 0, index: 0, contents: 'teh and teh' }],
        fields: [{ page: 1, index: 0, name: 'pet', value: 'teh dog' }],
      }),
    );
    await startReview(deps, store, 2);
    await replaceAll(deps, store, 'the');
    expect(sent).toStrictEqual([
      { kind: 'replaceAllText', find: 'teh', replace: 'the', caseSensitive: true, wholeWord: true },
      { kind: 'editAnnotationText', page: 0, index: 0, text: 'the and the', version: asDocVersion(2) },
      { kind: 'fillFormField', page: 1, index: 0, value: { set: 'text', text: 'the dog' }, version: asDocVersion(3) },
    ]);
    const review = reviewOf(store);
    expect(review.current).toBeUndefined();
    expect(review.replaced).toBe(6);
  });

  it('COUNTS WHAT CHANGED, measured by reading again: a word split across two objects is not counted, and is still shown', async () => {
    const { deps, store } = harness(script({ pages: [['teh one', 'teh two']], split: new Set(['0:1']) }));
    await startReview(deps, store, 1);
    await replaceAll(deps, store, 'the');
    const review = reviewOf(store);
    expect(review.replaced).toBe(1);
    expect(review.current?.place).toStrictEqual({ kind: 'text', page: 0, line: 1, offset: 0 });
  });
});

describe('changing what the review covers', () => {
  it('reads the comments again as the setting now says, and keeps its place', async () => {
    const { deps, store, settings } = harness(
      script({ pages: [['documnet']], comments: [{ page: 0, index: 0, contents: 'teh' }] }),
    );
    settings.set(SPELLING_COMMENTS_SETTING.id, false);
    await startReview(deps, store, 1);
    expect(reviewOf(store).occurrences).toHaveLength(1);
    settings.set(SPELLING_COMMENTS_SETTING.id, true);
    await coverChanged(deps, store);
    expect(reviewOf(store).occurrences.map((each) => each.word)).toStrictEqual(['documnet', 'teh']);
    expect(currentWord(store)).toBe('documnet');
  });
});
