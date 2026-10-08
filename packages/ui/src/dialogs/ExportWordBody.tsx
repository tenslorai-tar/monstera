import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_WORD_APPLY,
  EXPORT_WORD_LAYOUT,
  EXPORT_WORD_LAYOUT_NOTE,
  EXPORT_WORD_MODE,
  EXPORT_WORD_MODE_NOTE,
  EXPORT_WORD_PAGES_NOTE,
  EXPORT_WORD_RICH,
  EXPORT_WORD_RICH_NOTE,
  EXPORT_WORD_TEXT,
  EXPORT_WORD_TEXT_NOTE,
  PAGE_RANGE_EXPORT_EMPTY,
  SCAN_READER,
  SCAN_READERS_NONE,
  SCAN_READER_AZURE,
  SCAN_READER_AZURE_NOTE,
  SCAN_READER_BUILT_IN,
  SCAN_READER_BUILT_IN_NOTE,
  SCAN_READER_CLAUDE,
  SCAN_READER_CLAUDE_NOTE,
  SCAN_SENDS_AZURE,
  SCAN_SENDS_CLAUDE,
  SCAN_SOURCE,
  SCAN_SOURCE_NOTE,
  SCAN_SOURCE_SCANNED,
  SCAN_SOURCE_SCANNED_NOTE,
  SCAN_SOURCE_TYPED,
  SCAN_SOURCE_TYPED_NOTE,
  SCAN_WORD_OUTPUT_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { type DialogChoice, DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportWordAnswer } from './exportWord.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';
import { SCAN_READERS, type ScanReader } from './scanReader.js';

type WordMode = ExportWordAnswer['mode'];
type Source = 'typed' | 'scanned';

/**
 * Each mode, its short name and the sentence that says what a person gets — keyed by mode, so a fourth mode arrives
 * owing its words.
 */
const MODES: Readonly<Record<WordMode, Omit<DialogChoice<WordMode>, 'value'>>> = {
  rich: { label: EXPORT_WORD_RICH, note: EXPORT_WORD_RICH_NOTE },
  layout: { label: EXPORT_WORD_LAYOUT, note: EXPORT_WORD_LAYOUT_NOTE },
  text: { label: EXPORT_WORD_TEXT, note: EXPORT_WORD_TEXT_NOTE },
};

/** What is in the document, and the sentence for each — the first question of the dialog (ADR-0202). */
const SOURCES: readonly DialogChoice<Source>[] = [
  { value: 'typed', label: SCAN_SOURCE_TYPED, note: SCAN_SOURCE_TYPED_NOTE },
  { value: 'scanned', label: SCAN_SOURCE_SCANNED, note: SCAN_SOURCE_SCANNED_NOTE },
];

/** Each reader's name and what it does, keyed by reader so a fourth arrives owing its words. */
const READERS: Readonly<Record<ScanReader, Omit<DialogChoice<ScanReader>, 'value'>>> = {
  'built-in': { label: SCAN_READER_BUILT_IN, note: SCAN_READER_BUILT_IN_NOTE },
  claude: { label: SCAN_READER_CLAUDE, note: SCAN_READER_CLAUDE_NOTE },
  azure: { label: SCAN_READER_AZURE, note: SCAN_READER_AZURE_NOTE },
};

/** What a service reader sends, said before anything is sent. The built-in reader sends nothing and says nothing. */
const SENDS: Readonly<Record<Exclude<ScanReader, 'built-in'>, MessageKey>> = {
  claude: SCAN_SENDS_CLAUDE,
  azure: SCAN_SENDS_AZURE,
};

/**
 * The Word export dialog's body: what is in the document, which pages, and — for typed text — which of the three modes; for
 * a handwritten or scanned one, who reads the pages first.
 *
 * **Typed text is first, and rich is selected under it**: it is the mode that keeps the most of the document while still
 * reflowing, which is what most people exporting to Word want to do with the result — edit it. The file is main's to pick
 * after this, so the button names that next step, as the other exports' do.
 *
 * **A scanned document has one output, the words**, so the three modes are not offered for it: a layout of pictures the
 * words sit beside is not an editable file. The readers are the ones this machine has, and a service's page count is said
 * beside the choice, before anything is sent.
 *
 * **The pages are the exports' one row** (`PageRangeChoice`, ADR-0161), so *Select pages* means here what it means in
 * every other export, and a refusal is said once the button is pressed.
 */
export default function ExportWordBody({
  pageCount,
  readers,
  resolve,
}: {
  readonly pageCount: number;
  readonly readers: readonly ScanReader[];
} & DialogAnswering<ExportWordAnswer>): ReactElement {
  const { _ } = useLingui();
  const range = usePageRange(pageCount);
  const [source, setSource] = useState<Source>('typed');
  const [mode, setMode] = useState<WordMode>('rich');
  const [reader, setReader] = useState<ScanReader | undefined>(readers[0]);

  const scanned = source === 'scanned';
  // NO READER IS A STATE TO SAY, not a button that fails (§10.5): a scanned document on a machine with no models and no key.
  const stuck = scanned && reader === undefined;
  const sent = scanned && reader !== undefined && reader !== 'built-in' ? SENDS[reader] : undefined;

  return (
    <div className="m-export-word">
      <DialogChoices<Source>
        label={SCAN_SOURCE}
        note={SCAN_SOURCE_NOTE}
        options={SOURCES}
        value={source}
        onChange={setSource}
      />
      {scanned ? (
        readers.length === 0 ? (
          <p className="m-export-word__no-reader" data-export-word-no-reader="">
            {_(SCAN_READERS_NONE)}
          </p>
        ) : (
          <DialogChoices<ScanReader>
            label={SCAN_READER}
            options={SCAN_READERS.filter((each) => readers.includes(each)).map((value) => ({ value, ...READERS[value] }))}
            value={reader ?? readers[0] ?? 'built-in'}
            onChange={setReader}
          />
        )
      ) : null}
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_WORD_PAGES_NOTE} range={range} />
      {/* THE PAGES THAT WILL BE SENT, counted from the row, and said only while the row names some: a count of every page
          under *Select pages* would say more leaves this computer than does. */}
      {sent === undefined || range.chosen === undefined ? null : (
        <p>{_(sent, { count: range.chosen.length, every: range.chosen.length === pageCount ? 'yes' : 'no' })}</p>
      )}
      {scanned ? (
        <p>{_(SCAN_WORD_OUTPUT_NOTE)}</p>
      ) : (
        <DialogChoices<WordMode>
          label={EXPORT_WORD_MODE}
          note={EXPORT_WORD_MODE_NOTE}
          options={(Object.keys(MODES) as WordMode[]).map((value) => ({ value, ...MODES[value] }))}
          value={mode}
          onChange={setMode}
        />
      )}
      <DialogFooter>
        <Button
          label={EXPORT_WORD_APPLY}
          variant="primary"
          disabled={stuck}
          onClick={() => {
            const pages = range.proceed();
            if (pages === undefined) return;
            if (!scanned) {
              resolve({ mode, pages: [...pages], reading: 'typed' });
              return;
            }
            if (reader === undefined) return;
            resolve({ mode: 'text', pages: [...pages], reading: reader });
          }}
        />
      </DialogFooter>
    </div>
  );
}
