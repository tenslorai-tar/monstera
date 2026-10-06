import {
  type Channels,
  type ContractClient,
  type DispatchableCommand,
  type FailureOf,
  MAX_TEXT_LAYER_LINES,
} from '@monstera/contract';
import {
  type DocId,
  type DocVersion,
  type Failure,
  type MessageKey,
  pairWordBoxes,
  toPdf,
  tokensOf,
  viewportPoint,
} from '@monstera/shared';

import { unscaledTransform } from '../annotations/annotationSpace.js';
import { wordsToEdit } from '../annotations/markWords.js';
import { type DocumentCommandDeps, applyDocumentCommand } from '../commands/documentCommands.js';
import { problemMessage } from '../dialogs/problemMessages.js';
import type { DocumentStore } from '../documentStores.js';
import {
  PROBLEM_COMMENT_TOO_LONG,
  SPELLING_CHANGED,
  SPELLING_NOT_SHOWN,
} from '../messages/en.js';
import { readWholeList } from '../readWholeList.js';
import {
  PERSONAL_DICTIONARY_SETTING,
  SPELLING_COMMENTS_SETTING,
  SPELLING_FIELDS_SETTING,
} from '../settings/editing.js';
import type { SettingsStore } from '../settingsStore.js';
import { type SpellChecker, buildChecker } from './checker.js';
import { activeLanguage } from './languages.js';
import { keepWord } from './personalWords.js';
import {
  type SpellingOccurrence,
  type SpellingPlace,
  type SpellingReviewing,
  nextOccurrence,
  occurrencesIn,
  pageOccurrences,
  pastOccurrence,
  skipKey,
  sortedOccurrences,
  splicedAll,
} from './review.js';

/**
 * A spelling review's reads and edits (ADR-0156), and the ONE writer of a document's `spelling` state.
 *
 * ## Every action belongs to a run
 *
 * A review is a run, numbered in the state. Every read and every edit is awaited, and a person may stop the review or
 * start another while one is in flight, so each write checks that the run it was started for is still the one held;
 * a late answer for a stopped review writes nothing.
 *
 * ## An edit re-reads what it changes, first and after
 *
 * The words were read when the review began, and the document may have moved since — by this review's own edits, or
 * by anything else. So an edit reads its target again before it writes, and goes ahead only when the text there is
 * still the text the review holds; otherwise the review reads that part again and says the text changed. After an edit
 * the changed page, and the comments and fields, are read again (Decision 5), so later offsets are read rather than
 * shifted by arithmetic.
 */

/** What a review needs from the application. */
export interface SpellingDeps {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  /** The bag every document command is sent with, for `applyDocumentCommand`. */
  readonly commands: DocumentCommandDeps;
  /**
   * The visible box PDF.js drew `docId`'s `page` with, PDF user space `[x0, y0, x1, y1]`, or `undefined` before it has
   * been drawn — what `PageList.onPageBox` reports. The word's point is converted with it, so the renderer adds no
   * geometry of its own (ADR-0156's 2026-10-04 correction). Named by document, so a box another document reported is
   * never the one a point is converted through.
   */
  readonly cropOf: (docId: DocId, page: number) => readonly [number, number, number, number] | undefined;
}

/**
 * Runs are numbered across every document and never reused: numbered from the state instead, a review stopped (no
 * state) and started again would be run 1 twice, and the first one's late answers would be taken as the second's.
 */
let runs = 0;

/** Where a review that has gone through stays: past every place a word can have. */
const PAST_THE_END: SpellingPlace = { kind: 'field', page: Number.MAX_SAFE_INTEGER, index: 0, offset: 0 };

/** The checker each run checks with, held beside the state because a checker is not data. */
const CHECKERS = new WeakMap<DocumentStore, { readonly run: number; readonly checker: SpellChecker }>();

/** The review the store holds, if it is the reviewing phase of `run`. */
function reviewing(store: DocumentStore, run: number): SpellingReviewing | undefined {
  const held = store.getState().spelling;
  return held?.phase === 'reviewing' && held.run === run ? held : undefined;
}

function checkerOf(store: DocumentStore, run: number): SpellChecker | undefined {
  const held = CHECKERS.get(store);
  return held?.run === run ? held.checker : undefined;
}

/** Writes the next reviewing state for `run`, unless the review was stopped or replaced meanwhile. */
function write(store: DocumentStore, run: number, change: (held: SpellingReviewing) => SpellingReviewing): void {
  const held = reviewing(store, run);
  if (held !== undefined) store.getState().reviewSpelling(change(held));
}

/** The state with `current` moved to the first occurrence at or after `from`, and its suggestions asked for. */
function movedTo(
  held: SpellingReviewing,
  checker: SpellChecker,
  from: SpellingPlace | undefined,
  occurrences: readonly SpellingOccurrence[] = held.occurrences,
  skipped: readonly string[] = held.skipped,
): SpellingReviewing {
  const current = nextOccurrence(occurrences, from, new Set(skipped));
  return {
    ...held,
    occurrences,
    skipped,
    current,
    // ASKED FOR THE ONE WORD SHOWN, never for the list: `suggest` is the library's expensive half, and a review of
    // four hundred misspellings would otherwise pay for four hundred lists nobody reads.
    suggestions: current === undefined ? [] : checker.suggest(current.word),
  };
}

/** Whether the review covers comments, and fields, as the settings say now. */
function covers(settings: SettingsStore): { readonly comments: boolean; readonly fields: boolean } {
  return {
    comments: SPELLING_COMMENTS_SETTING.schema.parse(settings.get(SPELLING_COMMENTS_SETTING.id)),
    fields: SPELLING_FIELDS_SETTING.schema.parse(settings.get(SPELLING_FIELDS_SETTING.id)),
  };
}

/** One page's text layer lines, or `undefined` where the read is refused. */
async function linesOf(
  client: ContractClient,
  docId: DocId,
  page: number,
): Promise<{ readonly version: DocVersion; readonly lines: readonly string[] } | undefined> {
  const answer = await client['document.pageTextLayer']({ docId, page, limit: MAX_TEXT_LAYER_LINES });
  if (!answer.ok) return undefined;
  return { version: answer.value.version, lines: answer.value.lines.map((line) => line.text) };
}

/**
 * The comments' and the text fields' misspelt words, at one version — or `undefined` where a list was refused.
 *
 * A comment is checked in its WHOLE words (`wordsToEdit`, the one place an editor takes them): the walk lists a long
 * comment cut, and a replacement spliced into the cut text would save it over the rest. One too long to edit is still
 * checked in what the walk shows and marked not writable. A field is checked once by name, the first widget the walk
 * meets, since every widget of a field shows its one value; a read-only field is skipped, as nothing can change it, and
 * a value the walk listed cut is marked not writable for the comment's reason.
 */
async function readLists(
  client: ContractClient,
  docId: DocId,
  checker: SpellChecker,
  cover: { readonly comments: boolean; readonly fields: boolean },
): Promise<{ readonly version: DocVersion | undefined; readonly occurrences: SpellingOccurrence[] } | undefined> {
  const occurrences: SpellingOccurrence[] = [];
  let version: DocVersion | undefined;

  if (cover.comments) {
    const read = await readWholeList(
      (from) => client['document.annotations']({ docId, from }),
      (part) => part.annotations,
    );
    if (!read.ok) return undefined;
    version = read.value.version;
    for (const mark of read.value.items) {
      if (mark.contents === '') continue;
      const words = await wordsToEdit(client, docId, { ...mark, version: read.value.version });
      if (words.kind === 'problem') continue;
      const text = words.kind === 'words' ? words.text : mark.contents;
      occurrences.push(
        ...occurrencesIn(
          checker,
          text,
          (offset) => ({ kind: 'comment', page: mark.page, index: mark.index, offset }),
          { writable: words.kind === 'words' },
        ),
      );
    }
  }

  if (cover.fields) {
    const read = await readWholeList(
      (from) => client['document.formFields']({ docId, from }),
      (part) => part.fields,
    );
    if (!read.ok) return undefined;
    // ONE VERSION FOR BOTH LISTS: a field list read after the document moved names handles the comments' do not.
    if (version !== undefined && read.value.version !== version) return readLists(client, docId, checker, cover);
    version = read.value.version;
    const seen = new Set<string>();
    for (const field of read.value.items) {
      if (field.kind !== 'text' || field.readOnly || seen.has(field.name)) continue;
      seen.add(field.name);
      const [value] = field.values;
      if (value === undefined || value === '') continue;
      occurrences.push(
        ...occurrencesIn(
          checker,
          value,
          (offset) => ({ kind: 'field', page: field.page, index: field.index, offset }),
          { writable: field.cut !== true, name: field.name },
        ),
      );
    }
  }
  return { version, occurrences };
}

/**
 * Starts a review of the document `store` holds: builds the checker, reads every page, then the comments and fields,
 * and shows the first word. Starting again replaces any review the document had.
 */
export async function startReview(deps: SpellingDeps, store: DocumentStore, pageCount: number): Promise<void> {
  const state = store.getState();
  runs += 1;
  const run = runs;
  const { docId } = state;
  const ours = (): boolean => store.getState().spelling?.run === run;
  state.reviewSpelling({ phase: 'reading', run, checked: 0, pageCount });

  // READ AT RUN TIME, so a word added in another review counts in this one without the registry being rebuilt.
  const personal = PERSONAL_DICTIONARY_SETTING.schema.parse(deps.settings.get(PERSONAL_DICTIONARY_SETTING.id));
  const checker = await buildChecker(deps.client, activeLanguage(), personal);
  if (!ours()) return;
  if (checker === null) {
    store.getState().reviewSpelling({ phase: 'unavailable', run });
    return;
  }
  CHECKERS.set(store, { run, checker });

  // EVERY PAGE AT ONE VERSION. A document that moves while this reads is read again from the first page — two halves
  // read either side of an edit describe two documents, and their offsets would point into neither.
  for (;;) {
    const found: SpellingOccurrence[] = [];
    let version: DocVersion | undefined;
    let moved = false;
    for (let page = 0; page < pageCount; page += 1) {
      const read = await linesOf(deps.client, docId, page);
      if (!ours()) return;
      if (read === undefined) {
        store.getState().reviewSpelling({ phase: 'refused', run });
        return;
      }
      version ??= read.version;
      if (read.version !== version) {
        moved = true;
        break;
      }
      found.push(...pageOccurrences(checker, page, read.lines));
      store.getState().reviewSpelling({ phase: 'reading', run, checked: page + 1, pageCount });
    }
    if (moved) continue;

    const lists = await readLists(deps.client, docId, checker, covers(deps.settings));
    if (!ours()) return;
    if (lists === undefined) {
      store.getState().reviewSpelling({ phase: 'refused', run });
      return;
    }
    const occurrences = sortedOccurrences([...found, ...lists.occurrences]);
    const first: SpellingReviewing = {
      phase: 'reviewing',
      run,
      occurrences,
      current: undefined,
      suggestions: [],
      skipped: [],
      listsVersion: lists.version,
      busy: false,
      notice: undefined,
      replaced: 0,
    };
    store.getState().reviewSpelling(movedTo(first, checker, undefined));
    return;
  }
}

/** Ends the review the document holds, and any read or edit still on its way writes nothing. */
export function stopReview(store: DocumentStore): void {
  store.getState().reviewSpelling(undefined);
}

/** Ignore: on to the next word. */
export function ignoreWord(store: DocumentStore): void {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing' || held.busy || held.current === undefined) return;
  const checker = checkerOf(store, held.run);
  if (checker === undefined) return;
  store.getState().reviewSpelling({ ...movedTo(held, checker, pastOccurrence(held.current)), notice: undefined });
}

/** Ignore all: on to the next word, and this word is not shown again in this review. */
export function ignoreAll(store: DocumentStore): void {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing' || held.busy || held.current === undefined) return;
  const checker = checkerOf(store, held.run);
  if (checker === undefined) return;
  const skipped = [...held.skipped, skipKey(held.current.word)];
  store
    .getState()
    .reviewSpelling({ ...movedTo(held, checker, pastOccurrence(held.current), held.occurrences, skipped), notice: undefined });
}

/** Add to dictionary: kept in the personal dictionary for every later check, and skipped for the rest of this one. */
export function addToDictionary(deps: SpellingDeps, store: DocumentStore): void {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing' || held.busy || held.current === undefined) return;
  const checker = checkerOf(store, held.run);
  if (checker === undefined) return;
  const word = held.current.word;
  // THE PERSONAL DICTIONARY'S ONE WRITER (`keepWord`), shared with the editor's right-click menu: said when it refuses.
  const refusal = keepWord(deps.settings, word);
  if (refusal !== undefined) {
    store.getState().reviewSpelling({ ...held, notice: refusal });
    return;
  }
  const skipped = [...held.skipped, skipKey(word)];
  store
    .getState()
    .reviewSpelling({ ...movedTo(held, checker, pastOccurrence(held.current), held.occurrences, skipped), notice: undefined });
}

/**
 * A refusal the panel says under the word, rather than a dialog over the work (Decision 5). `internal` is the one
 * left to the problem dialog, which shows its incident reference; the signed-document question's Cancel is a person's
 * answer and says nothing.
 */
function noticeFor(failure: Failure<FailureOf<Channels, 'document.execute'>>): MessageKey | undefined | false {
  if (failure.code === 'internal') return false;
  if (failure.code === 'breaks-signatures') return undefined;
  return problemMessage('detail' in failure ? failure : { code: failure.code });
}

/** Sends one command, saying a refusal in the panel. `true` when the document moved. */
async function send(
  deps: SpellingDeps,
  store: DocumentStore,
  run: number,
  command: DispatchableCommand,
): Promise<boolean> {
  let notice: MessageKey | undefined;
  const moved = await applyDocumentCommand(deps.commands, store.getState().docId, command, {
    keep: (failure) => {
      const said = noticeFor(failure);
      if (said === false) return false;
      notice = said;
      return true;
    },
  });
  if (notice !== undefined) {
    const said = notice;
    write(store, run, (held) => ({ ...held, notice: said }));
  }
  return moved;
}

/** Reads `pages` again and the comments and fields, and moves to the first word at or after `from`. */
async function readAgain(
  deps: SpellingDeps,
  store: DocumentStore,
  run: number,
  pages: ReadonlySet<number>,
  from: SpellingPlace,
): Promise<void> {
  const checker = checkerOf(store, run);
  if (checker === undefined) return;
  const { docId } = store.getState();
  const reread: SpellingOccurrence[] = [];
  for (const page of pages) {
    const read = await linesOf(deps.client, docId, page);
    if (read !== undefined) reread.push(...pageOccurrences(checker, page, read.lines));
  }
  const lists = await readLists(deps.client, docId, checker, covers(deps.settings));
  write(store, run, (held) => {
    // A PAGE THAT WOULD NOT READ keeps what the review held for it, rather than losing its words from the review.
    const kept = held.occurrences.filter(
      (each) =>
        (each.place.kind === 'text' && !pages.has(each.place.page)) ||
        (each.place.kind !== 'text' && lists === undefined),
    );
    const occurrences = sortedOccurrences([...kept, ...reread, ...(lists?.occurrences ?? [])]);
    return {
      ...movedTo(held, checker, from, occurrences),
      listsVersion: lists?.version ?? held.listsVersion,
      busy: false,
    };
  });
}

/** Marks the review busy for one edit, or answers `undefined` where there is nothing to edit. */
function begin(store: DocumentStore): { readonly held: SpellingReviewing; readonly current: SpellingOccurrence } | undefined {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing' || held.busy || held.current === undefined) return undefined;
  const current = held.current;
  store.getState().reviewSpelling({ ...held, busy: true, notice: undefined });
  return { held, current };
}

/** Ends an edit that changed nothing, with what the panel says. */
function settle(store: DocumentStore, run: number, notice?: MessageKey): void {
  write(store, run, (held) => ({ ...held, busy: false, ...(notice === undefined ? {} : { notice }) }));
}

/**
 * The point `replaceTextAt` names for the word on a page: the centre of its box in MuPDF's word boxes, paired to the
 * text layer line the review read, converted through the drawn page's transform at scale 1. `undefined` with the
 * reason when it cannot be named — the line is not the one the review holds, or the page has not been drawn.
 */
async function pointOf(
  deps: SpellingDeps,
  docId: DocId,
  occurrence: SpellingOccurrence & { readonly place: { readonly kind: 'text' } },
): Promise<{ readonly x: number; readonly y: number } | MessageKey> {
  const { page, line, offset } = occurrence.place;
  const layer = await deps.client['document.pageTextLayer']({ docId, page, limit: MAX_TEXT_LAYER_LINES });
  if (!layer.ok) return problemMessage(layer.error);
  const lines = layer.value.lines;
  if (lines[line]?.text !== occurrence.context) return SPELLING_CHANGED;
  const boxes = await deps.client['document.pageWordBoxes']({ docId, page });
  if (!boxes.ok) return problemMessage(boxes.error);
  if (boxes.value.version !== layer.value.version) return SPELLING_CHANGED;
  const paired = pairWordBoxes(lines, boxes.value.lines)[line];
  // THE TOKEN AT THE OFFSET, by the same segmenter the boxes were cut by: one box per token `tokensOf` cuts.
  const at = [...tokensOf(occurrence.context)].findIndex((token) => token.index === offset);
  const box = paired?.words?.[at];
  // NO BOX FOR THE WORD is a line the engine's read did not pair, and a point estimated from the line's width would
  // name a place the word may not be: refused as not in place, the edit's own answer for a point it cannot use.
  if (box === undefined) return problemMessage({ code: 'text-not-in-place' });
  const crop = deps.cropOf(docId, page);
  if (crop === undefined) return SPELLING_NOT_SHOWN;
  const model = await deps.client['document.viewModel']({ docId, pages: [page] });
  const rotation = model.ok && model.value.version === layer.value.version ? (model.value.rotations[0] ?? 0) : undefined;
  if (rotation === undefined) return SPELLING_CHANGED;
  const transform = unscaledTransform({ crop, rotation, zoom: 1 });
  const point = toPdf(viewportPoint((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2), transform);
  return { x: point.x, y: point.y };
}

function isText(
  occurrence: SpellingOccurrence,
): occurrence is SpellingOccurrence & { readonly place: Extract<SpellingPlace, { kind: 'text' }> } {
  return occurrence.place.kind === 'text';
}

/**
 * The command that writes `replacement` over the occurrences of a comment or a field that the review found, read again
 * first — or the reason it cannot be sent.
 */
async function listEdit(
  deps: SpellingDeps,
  store: DocumentStore,
  run: number,
  target: SpellingOccurrence,
  offsets: readonly number[],
  replacement: string,
): Promise<DispatchableCommand | MessageKey> {
  if (!target.writable) return PROBLEM_COMMENT_TOO_LONG;
  const checker = checkerOf(store, run);
  if (checker === undefined) return SPELLING_CHANGED;
  const { docId } = store.getState();
  const lists = await readLists(deps.client, docId, checker, {
    comments: target.place.kind === 'comment',
    fields: target.place.kind === 'field',
  });
  if (lists?.version === undefined) return SPELLING_CHANGED;
  // THE TEXT AS IT IS NOW must be the text the review spliced from, or the offsets point into something else.
  const now = lists.occurrences.find(
    (each) =>
      each.place.kind === target.place.kind &&
      each.place.page === target.place.page &&
      (each.place.kind === 'text' ? -1 : each.place.index) === (target.place.kind === 'text' ? -1 : target.place.index),
  );
  if (now?.context !== target.context) return SPELLING_CHANGED;
  const text = splicedAll(target.context, offsets, target.word, replacement);
  if (text === undefined) return SPELLING_CHANGED;
  if (target.place.kind === 'comment') {
    return { kind: 'editAnnotationText', page: target.place.page, index: target.place.index, text, version: lists.version };
  }
  if (target.place.kind === 'field') {
    return {
      kind: 'fillFormField',
      page: target.place.page,
      index: target.place.index,
      value: { set: 'text', text },
      version: lists.version,
    };
  }
  return SPELLING_CHANGED;
}

/** Replace: this occurrence becomes `replacement`, through the route its place's edits take (Decision 5). */
export async function replaceWord(deps: SpellingDeps, store: DocumentStore, replacement: string): Promise<void> {
  const started = begin(store);
  if (started === undefined) return;
  const { held, current } = started;
  const { run } = held;
  const { docId } = store.getState();

  let command: DispatchableCommand | MessageKey;
  if (isText(current)) {
    const point = await pointOf(deps, docId, current);
    command =
      typeof point === 'string'
        ? point
        : { kind: 'replaceTextAt', page: current.place.page, find: current.word, replace: replacement, at: point };
  } else {
    command = await listEdit(deps, store, run, current, [current.place.offset], replacement);
  }
  if (reviewing(store, run) === undefined) return;
  if (typeof command === 'string') {
    if (command === SPELLING_CHANGED) {
      // FROM THE START OF ITS LINE, comment or field: the offset was into the text as it was, and in the changed text it
      // can lie past the very word the review was on.
      await readAgain(deps, store, run, new Set([current.place.page]), { ...current.place, offset: 0 });
      settle(store, run, SPELLING_CHANGED);
    } else {
      settle(store, run, command);
    }
    return;
  }

  if (!(await send(deps, store, run, command))) {
    settle(store, run);
    return;
  }
  write(store, run, (now) => ({ ...now, replaced: now.replaced + 1 }));
  await readAgain(deps, store, run, new Set([current.place.page]), pastOccurrence(current, replacement.length));
}

/**
 * Replace all: every occurrence of the word, exactly as written, becomes `replacement` — the page text through
 * `replaceAllText` (whole word, case sensitive), then each comment and field that holds it, one edit each.
 */
export async function replaceAll(deps: SpellingDeps, store: DocumentStore, replacement: string): Promise<void> {
  const started = begin(store);
  if (started === undefined) return;
  const { held, current } = started;
  const { run } = held;
  const word = current.word;
  const same = held.occurrences.filter((each) => each.word === word);
  const pages = new Set(same.filter(isText).map((each) => each.place.page));
  let changed = 0;

  // THE PAGE TEXT FIRST, in one command and one undo, as the find bar's Replace all is.
  if (pages.size > 0) {
    await send(deps, store, run, {
      kind: 'replaceAllText',
      find: word,
      replace: replacement,
      caseSensitive: true,
      wholeWord: true,
    });
  }

  // THEN EACH COMMENT AND FIELD, one edit each: an edit names its handle at one version, and every edit moves it.
  const lists = new Map<string, { readonly target: SpellingOccurrence; readonly offsets: number[] }>();
  for (const each of same) {
    if (each.place.kind === 'text') continue;
    const key = `${each.place.kind}:${String(each.place.page)}:${String(each.place.index)}`;
    const entry = lists.get(key);
    if (entry === undefined) lists.set(key, { target: each, offsets: [each.place.offset] });
    else entry.offsets.push(each.place.offset);
  }
  let notice: MessageKey | undefined;
  for (const { target, offsets } of lists.values()) {
    if (reviewing(store, run) === undefined) return;
    const command = await listEdit(deps, store, run, target, offsets, replacement);
    if (typeof command === 'string') {
      notice = command;
      continue;
    }
    if (await send(deps, store, run, command)) changed += offsets.length;
  }

  if (reviewing(store, run) === undefined) return;
  await readAgain(deps, store, run, pages, pastOccurrence(current, replacement.length));
  // THE PAGE TEXT'S COUNT IS MEASURED, not assumed: `replaceAllText` answers no count, and an occurrence split across
  // two text objects is one it cannot reach. So what changed is what the review held on those pages less what the
  // pages still hold once read again.
  const before = same.filter(isText).length;
  const after =
    reviewing(store, run)?.occurrences.filter((each) => isText(each) && each.word === word && pages.has(each.place.page))
      .length ?? before;
  write(store, run, (now) => ({ ...now, replaced: now.replaced + changed + Math.max(0, before - after) }));
  if (notice !== undefined) settle(store, run, notice);
}

/**
 * The options changed: the comments and fields are read again as the settings now say, and the review goes on from
 * the word it was on.
 */
export async function coverChanged(deps: SpellingDeps, store: DocumentStore): Promise<void> {
  const held = store.getState().spelling;
  if (held?.phase !== 'reviewing' || held.busy) return;
  store.getState().reviewSpelling({ ...held, busy: true });
  await readAgain(deps, store, held.run, new Set(), held.current?.place ?? PAST_THE_END);
}
