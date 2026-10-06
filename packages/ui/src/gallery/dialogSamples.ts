import {
  ACCESSIBILITY_HUMAN_CHECKS,
  MAX_SIGNATURE_FIELD,
  OCR_LANGUAGES,
} from '@monstera/contract';
import { asFileHandle } from '@monstera/shared';

import {
  CLOSE_TAB_TITLE,
  EDITING_AZURE_KEY_TITLE,
  FIND_TITLE,
  GRID_TITLE,
  KEYBOARD_SHORTCUTS_COMMAND_TITLE,
  NEXT_PAGE_TITLE,
  OPEN_DOCUMENT_TITLE,
  PREVIOUS_PAGE_TITLE,
  PRINT_COMMAND_TITLE,
  REDO_TITLE,
  ROTATE_PAGE_180_TITLE,
  ROTATE_PAGE_TITLE,
  SAVE_TITLE,
  SHOW_SEARCH_TITLE,
  THEME_TITLE,
  UNDO_TITLE,
  ZOOM_IN_TITLE,
  ZOOM_OUT_TITLE,
} from '../messages/en.js';

/**
 * The states the dialog gallery opens each registered dialog in, for review by eye (`dialogGallery.tsx`).
 *
 * One entry per dialog id the application registers (`APPLICATION_DIALOGS`), and the gallery refuses to run while
 * any id has none, or while an entry names an id nothing registers. A state is the dialog's props, which its own
 * schema validates at the open call exactly as the application's do, plus the steps that bring the body to that
 * state: typing into a field, pressing a tab or a control. The steps are run by the capture
 * (`packages/testing/src/dialogGallery.capture.ts`), never by the gallery.
 *
 * WHICH STATES: every state that changes the layout. The first is how a person meets the dialog. Then, where they
 * exist, filled, refused, long text, and each tab.
 */

/** A field, a tab or a control, found by its accessible name inside the open dialog. */
export type GalleryStep =
  | { readonly kind: 'type'; readonly field: string; readonly text: string }
  | {
      readonly kind: 'click';
      readonly name: string;
      readonly role: 'button' | 'tab' | 'radio' | 'checkbox' | 'option' | 'menuitem' | 'link';
    };

export interface DialogSample {
  /** A short name for the state, shown on the contact sheet: `opened`, `filled`, `refused`, `long`, a tab's name. */
  readonly state: string;
  readonly props: unknown;
  readonly steps?: readonly GalleryStep[];
}

const NAME = 'Quarterly report.pdf';
const LONG_NAME =
  'Regional operations review for the third quarter, with the appendices, the supporting schedules, the ' +
  'reconciliations and the commentary prepared for the annual planning meeting, final version.pdf';
const LONG_SENTENCE =
  'The figures on this page were compared with the ledger for the same period, and the totals in the second ' +
  'table do not agree with the summary on the first page, so they need checking before the report is sent. ';

/** At least `length` characters of ordinary prose, for a field whose limit is the point of the state. */
function prose(length: number): string {
  return LONG_SENTENCE.repeat(Math.ceil(length / LONG_SENTENCE.length) + 1).trim();
}

const type = (field: string, text: string): GalleryStep => ({ kind: 'type', field, text });
const press = (name: string): GalleryStep => ({ kind: 'click', name, role: 'button' });
const tick = (name: string): GalleryStep => ({ kind: 'click', name, role: 'checkbox' });
const choose = (name: string): GalleryStep => ({ kind: 'click', name, role: 'radio' });

/** A real picture behind a `blob:` address, as main hands the renderer one, so the gallery shows an image. */
function picture(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

const STAMP_PICTURE = picture(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96" viewBox="0 0 240 96">' +
    '<rect x="6" y="6" width="228" height="84" rx="10" fill="none" stroke="#b42318" stroke-width="6"/>' +
    '<text x="120" y="62" font-family="sans-serif" font-size="40" font-weight="700" fill="#b42318" ' +
    'text-anchor="middle">RECEIVED</text></svg>',
);
const SEAL_PICTURE = picture(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    '<circle cx="60" cy="60" r="54" fill="none" stroke="#1849a9" stroke-width="6"/>' +
    '<circle cx="60" cy="60" r="40" fill="none" stroke="#1849a9" stroke-width="2"/>' +
    '<text x="60" y="67" font-family="serif" font-size="22" font-weight="700" fill="#1849a9" ' +
    'text-anchor="middle">SEAL</text></svg>',
);
const SIGNATURE_PICTURE = picture(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">' +
    '<path d="M20 90 C60 10 80 110 120 60 S180 20 200 70 S260 100 300 40" fill="none" stroke="#1d2939" ' +
    'stroke-width="5" stroke-linecap="round"/></svg>',
);

const KEPT_TYPED = {
  id: '00000000-0000-4000-8000-0000000000a1',
  look: { kind: 'typed', text: 'Alex Example', font: 'great-vibes' },
} as const;
const KEPT_DRAWN = {
  id: '00000000-0000-4000-8000-0000000000a2',
  look: {
    kind: 'drawn',
    strokes: [
      [
        [0.08, 0.32],
        [0.2, 0.1],
        [0.3, 0.36],
        [0.42, 0.14],
        [0.55, 0.3],
      ],
      [
        [0.6, 0.28],
        [0.75, 0.12],
        [0.92, 0.22],
      ],
    ],
  },
} as const;

const DOCUMENTS = [
  { docId: '00000000-0000-4000-8000-0000000000b1', name: 'Annual accounts 2025.pdf' },
  { docId: '00000000-0000-4000-8000-0000000000b2', name: 'Board minutes, September.pdf' },
  { docId: '00000000-0000-4000-8000-0000000000b3', name: 'Supplier contract.pdf' },
];
/** The same documents as a second-document dialog is offered them (`sourceDocuments.ts`), each with its page count. */
const SOURCES = DOCUMENTS.map((document, index) => ({ ...document, pageCount: [12, 1, 4][index] ?? 1 }));
const LONG_SOURCES = [{ docId: '00000000-0000-4000-8000-0000000000b4', name: LONG_NAME, pageCount: 230 }, ...SOURCES];

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1, 9, 30);
const CLOUD_FILES = [
  { id: 'file-1', name: NAME, size: 1_284_000, modified: NOW - 2 * DAY },
  { id: 'file-2', name: 'Annual accounts 2025.pdf', size: 3_912_500, modified: NOW - 9 * DAY },
  { id: 'file-3', name: 'Supplier contract.pdf', size: 418_200, modified: NOW - 30 * DAY },
  { id: 'file-4', name: 'Board minutes, September.pdf', size: 256_000, modified: NOW - 41 * DAY },
];

const COMPONENTS = [
  { id: 'pdfium', name: 'PDFium', version: '7350', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'poppler', name: 'Poppler', version: '25.09.0', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'ghostscript', name: 'Ghostscript', version: '10.06.0', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'onlyoffice', name: 'ONLYOFFICE', version: '9.0.4', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'mupdf-shim', name: 'MuPDF', version: '1.26.10', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'ocr-models', name: 'OCR models', version: '4.1.0', state: 'present', missing: 0, altered: 0, extra: 0 },
  { id: 'fonts', name: 'Bundled open fonts', version: 'google/fonts 7085eb89a950', state: 'present', missing: 0, altered: 0, extra: 0 },
] as const;

const SHORTCUTS = [
  { id: 'document.open', title: OPEN_DOCUMENT_TITLE, chord: 'Ctrl+O', fallback: 'Ctrl+O', also: [] },
  { id: 'document.save', title: SAVE_TITLE, chord: 'Ctrl+S', fallback: 'Ctrl+S', also: [] },
  { id: 'document.print', title: PRINT_COMMAND_TITLE, chord: 'Ctrl+P', fallback: 'Ctrl+P', also: [] },
  { id: 'app.close-tab', title: CLOSE_TAB_TITLE, chord: 'Ctrl+W', fallback: 'Ctrl+W', also: ['Ctrl+F4'] },
  { id: 'edit.undo', title: UNDO_TITLE, chord: 'Ctrl+Z', fallback: 'Ctrl+Z', also: [] },
  { id: 'edit.redo', title: REDO_TITLE, chord: 'Ctrl+Y', fallback: 'Ctrl+Y', also: ['Ctrl+Shift+Z'] },
  { id: 'view.find', title: FIND_TITLE, chord: 'Ctrl+F', fallback: 'Ctrl+F', also: [] },
  { id: 'view.zoom-in', title: ZOOM_IN_TITLE, chord: 'Ctrl+=', fallback: 'Ctrl+=', also: [] },
  { id: 'view.zoom-out', title: ZOOM_OUT_TITLE, chord: 'Ctrl+-', fallback: 'Ctrl+-', also: [] },
  { id: 'view.next-page', title: NEXT_PAGE_TITLE, chord: 'PageDown', fallback: 'PageDown', also: [] },
  { id: 'view.previous-page', title: PREVIOUS_PAGE_TITLE, chord: 'PageUp', fallback: 'PageUp', also: [] },
  { id: 'document.rotate-page', title: ROTATE_PAGE_TITLE, chord: 'Ctrl+Shift+R', fallback: null, also: [] },
  { id: 'view.toggle-grid', title: GRID_TITLE, chord: null, fallback: 'Ctrl+G', also: [] },
  { id: 'view.search-panel', title: SHOW_SEARCH_TITLE, chord: null, fallback: null, also: [] },
  { id: 'app.keyboard-shortcuts', title: KEYBOARD_SHORTCUTS_COMMAND_TITLE, chord: 'Ctrl+/', fallback: 'Ctrl+/', also: [] },
];


const STRUCTURE = [
  { role: 'Document', raw: 'Document', depth: 0, lines: 0 },
  { role: 'H1', raw: 'H1', depth: 1, lines: 1 },
  { role: 'P', raw: 'P', depth: 1, lines: 6 },
  { role: 'H2', raw: 'Heading2', depth: 1, lines: 1 },
  { role: 'P', raw: 'P', depth: 1, lines: 4 },
  { role: 'Table', raw: 'Table', depth: 1, lines: 0 },
  { role: 'TR', raw: 'TR', depth: 2, lines: 0 },
  { role: 'TD', raw: 'TD', depth: 3, lines: 1 },
  { role: 'Figure', raw: 'Figure', depth: 1, lines: 0 },
];

const SIGNATURES = [
  {
    signer: 'Example Signer',
    organisation: 'Example Ltd',
    reason: 'I approve this report',
    location: 'Head office',
    notBefore: '2026-01-15T00:00:00Z',
    notAfter: '2027-01-15T00:00:00Z',
    coversDocument: true,
    coversWholeFile: true,
  },
  {
    signer: 'Finance Office',
    organisation: '',
    reason: '',
    location: '',
    notBefore: '2025-06-01T00:00:00Z',
    notAfter: '2026-12-31T00:00:00Z',
    coversDocument: true,
    coversWholeFile: false,
  },
];

const TABLE = {
  rows: [
    [
      { text: 'Region', clipped: false },
      { text: 'Quarter 2', clipped: false },
      { text: 'Quarter 3', clipped: false },
    ],
    [
      { text: 'North', clipped: false },
      { text: '1,240', clipped: false },
      { text: '1,310', clipped: false },
    ],
    [
      { text: 'South', clipped: false },
      { text: '980', clipped: false },
      { text: '1,045', clipped: false },
    ],
    [
      { text: 'Total', clipped: false },
      { text: '2,220', clipped: false },
      { text: '2,355', clipped: false },
    ],
  ],
};
const EXCEL = {
  index: 0,
  page: 1,
  pageCount: 4,
  tables: [TABLE],
  truncated: false,
  layout: 'sheet-per-page',
  engines: ['automatic'],
  engine: 'automatic',
  edits: [],
  range: { every: true, text: '' },
};

const RULES = [
  { clause: '7.1', test: 4, verdict: 'passed', count: 0, pages: [] },
  { clause: '7.1', test: 8, verdict: 'passed', count: 0, pages: [] },
  { clause: '7.3', test: 1, verdict: 'failed', count: 2, pages: [1, 5] },
  { clause: '7.18.1', test: 2, verdict: 'not-determined', count: 0, pages: [] },
  { clause: '7.21.4.1', test: 1, verdict: 'not-applicable', count: 0, pages: [] },
];
const EVERY_RULE = [
  '5-1', '6.2-1', '7.1-4', '7.1-5', '7.1-8', '7.1-9', '7.1-10', '7.1-11', '7.3-1', '7.16-1', '7.18.1-2', '7.18.1-3',
  '7.18.3-1', '7.18.5-2', '7.21.4.1-1',
].map((rule) => {
  const [clause = '', test = '1'] = rule.split('-');
  return { clause, test: Number(test), verdict: 'failed', count: 14, pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
});

const SETTINGS = {
  values: {},
  storedSecrets: [],
  secretsAvailable: true,
  models: {
    anthropic: {
      source: 'fetched',
      models: [
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', capabilities: { vision: true, streaming: true } },
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', capabilities: { vision: true, streaming: true } },
      ],
    },
  },
};

/** A dialog that asks for one piece of text: opened, then with an ordinary answer typed. */
function textForm(field: string, text: string): readonly DialogSample[] {
  return [
    { state: 'opened', props: {} },
    { state: 'filled', props: {}, steps: [type(field, text)] },
  ];
}

/** A form-field dialog that lists choices: opened, filled, and with several choice rows. */
function choiceField(name: string): readonly DialogSample[] {
  return [
    { state: 'opened', props: {} },
    { state: 'filled', props: {}, steps: [type('Field name', name), type('Choice', 'Standard delivery')] },
    { state: 'choices', props: {}, steps: [press('Add a choice'), press('Add a choice'), press('Add a choice')] },
  ];
}

export const DIALOG_SAMPLES: Readonly<Record<string, readonly DialogSample[]>> = {
  'dialog.about': [{ state: 'opened', props: { version: '0.1.1', installChannel: 'store', checksForUpdates: false } }],
  'dialog.components': [
    { state: 'opened', props: { components: COMPONENTS, verified: false } },
    {
      state: 'verified',
      props: { components: COMPONENTS.map((component) => ({ ...component, state: 'verified' })), verified: true },
    },
    {
      state: 'changed',
      props: {
        components: COMPONENTS.map((component) =>
          component.id === 'ghostscript' ? { ...component, state: 'changed', missing: 1, altered: 2, extra: 0 } : component,
        ),
        verified: true,
      },
    },
  ],
  'dialog.ai-setup': [
    { state: 'opened', props: { secretsAvailable: true } },
    { state: 'filled', props: { secretsAvailable: true }, steps: [type('API key', 'sk-example-0000000000000000')] },
    // Azure OpenAI is the one provider that also asks for its endpoint.
    { state: 'azure', props: { secretsAvailable: true, provider: 'azure-openai' } },
    { state: 'problem', props: { secretsAvailable: true, problem: 'unauthorised', provider: 'openai' } },
    { state: 'no-storage', props: { secretsAvailable: false } },
  ],
  'dialog.donate': [{ state: 'opened', props: {} }],
  'dialog.security-update': [{ state: 'opened', props: { version: '0.2.0' } }],
  'dialog.cloud-storage': [
    {
      state: 'opened',
      props: {
        providers: [
          { provider: 'onedrive', state: 'signed-out' },
          { provider: 'google-drive', state: 'signed-out' },
        ],
        documentOpen: true,
      },
    },
    {
      state: 'listed',
      props: {
        providers: [
          { provider: 'onedrive', state: 'signed-in' },
          { provider: 'google-drive', state: 'signed-out' },
        ],
        listing: { provider: 'onedrive', files: CLOUD_FILES },
        documentOpen: true,
        note: 'signed-in',
      },
    },
    {
      state: 'empty',
      props: {
        providers: [
          { provider: 'onedrive', state: 'signed-in' },
          { provider: 'google-drive', state: 'signed-in' },
        ],
        listing: { provider: 'onedrive', files: [] },
        documentOpen: false,
      },
    },
    {
      state: 'long',
      props: {
        providers: [
          { provider: 'onedrive', state: 'signed-in' },
          { provider: 'google-drive', state: 'signed-out' },
        ],
        listing: {
          provider: 'onedrive',
          files: [
            { id: 'file-long', name: LONG_NAME, size: 12_480_000, modified: NOW - DAY },
            ...Array.from({ length: 30 }, (_unused, at) => ({
              id: `file-${String(at + 10)}`,
              name: `Monthly statement ${String(at + 1)}.pdf`,
              size: 180_000 + at * 1_000,
              modified: NOW - (at + 3) * DAY,
            })),
          ],
        },
        documentOpen: true,
      },
    },
    {
      state: 'problem',
      props: {
        providers: [
          { provider: 'onedrive', state: 'signed-out' },
          { provider: 'google-drive', state: 'signed-out' },
        ],
        documentOpen: true,
        problem: 'sign-in-cancelled',
      },
    },
    {
      state: 'not-configured',
      props: {
        providers: [
          { provider: 'onedrive', state: 'not-configured' },
          { provider: 'google-drive', state: 'not-configured' },
        ],
        documentOpen: true,
      },
    },
  ],
  'dialog.cloud-outcome': [
    { state: 'opened', props: { outcome: 'save-failed' } },
    // A refusal adds the sentence saying the changes are kept here.
    { state: 'refused', props: { outcome: 'unreachable' } },
  ],
  'dialog.cloud-view-only': [{ state: 'opened', props: { provider: 'onedrive', moment: 'opened' } }],
  'dialog.keyboard-shortcuts': [
    { state: 'opened', props: { rows: SHORTCUTS, dropped: [] } },
    // Change on the first row waits for a key in place of the row's keys.
    { state: 'waiting', props: { rows: SHORTCUTS, dropped: [] }, steps: [press('Change')] },
    { state: 'dropped', props: { rows: SHORTCUTS, dropped: ['view.toggle-grid', 'document.rotate-page'] } },
  ],
  'dialog.help': [
    { state: 'opened', props: { article: null, context: 'organize', showable: [] } },
    { state: 'search', props: { article: null, context: null, showable: [] }, steps: [type('Search help', 'rotate')] },
    { state: 'no-results', props: { article: null, context: null, showable: [] }, steps: [type('Search help', 'xylophone')] },
    {
      state: 'article',
      props: {
        article: 'rotate-pages',
        context: null,
        showable: [
          { id: 'document.rotate-page', title: ROTATE_PAGE_TITLE },
          { id: 'document.rotate-page-180', title: ROTATE_PAGE_180_TITLE },
        ],
      },
    },
  ],
  'dialog.wordCount': [
    {
      state: 'opened',
      props: {
        words: 3_482,
        characters: 21_906,
        charactersNoSpaces: 18_377,
        lines: 611,
        cjkCharacters: 0,
        pagesCounted: 12,
        pageCount: 12,
      },
    },
    {
      state: 'partial',
      props: {
        words: 2_015,
        characters: 12_640,
        charactersNoSpaces: 10_598,
        lines: 352,
        cjkCharacters: 148,
        pagesCounted: 7,
        pageCount: 12,
      },
    },
  ],
  'dialog.pageStructure': [
    { state: 'opened', props: { kind: 'read', page: 2, nodes: STRUCTURE, truncated: false, untaggedLines: 0, images: 1 } },
    { state: 'untagged', props: { kind: 'read', page: 2, nodes: [], truncated: false, untaggedLines: 38, images: 2 } },
    {
      state: 'long',
      props: {
        kind: 'read',
        page: 4,
        nodes: Array.from({ length: 60 }, (_unused, at) => ({
          role: at % 3 === 0 ? 'H2' : 'P',
          raw: at % 3 === 0 ? 'SectionHeadingWithAVeryLongCustomTagNameFromTheAuthoringTool' : 'P',
          depth: (at % 4) + 1,
          lines: at % 3 === 0 ? 1 : 5,
        })),
        truncated: true,
        untaggedLines: 3,
        images: 4,
      },
    },
    { state: 'refused', props: { kind: 'refused', page: 2 } },
  ],
  'dialog.ocr': [
    { state: 'opened', props: { pages: [0], languages: ['eng', 'fra', 'deu', 'spa'], chosen: ['eng'], servicesReady: false } },
    { state: 'ready', props: { pages: [0, 1, 2], languages: ['eng', 'fra', 'deu', 'spa'], chosen: ['eng'], servicesReady: true } },
    { state: 'every-language', props: { pages: [0], languages: [...OCR_LANGUAGES], chosen: ['eng'], servicesReady: false } },
    // No language model is provisioned on this machine.
    { state: 'unavailable', props: { pages: [0], languages: [], chosen: ['eng'], servicesReady: false } },
  ],
  'dialog.translate-page': [
    { state: 'opened', props: { providers: ['anthropic', 'openai'] } },
    { state: 'no-provider', props: { providers: [] } },
  ],
  'dialog.ocr-outcome': [
    { state: 'opened', props: { recognised: 4, skipped: 0, stopped: false } },
    { state: 'stopped', props: { recognised: 3, skipped: 2, stopped: true } },
  ],
  'dialog.enhance-outcome': [{ state: 'opened', props: { pages: 5 } }],
  'dialog.scan-outcome': [{ state: 'opened', props: { pages: 5 } }],
  'dialog.save-problem': [
    { state: 'opened', props: { outcome: 'write-failed' } },
    // THE LONGEST of the causes a save to the document's own file can be told (cloud-4 7b).
    { state: 'write-held', props: { outcome: 'write-held' } },
  ],
  'dialog.close-unsaved': [
    { state: 'opened', props: { name: NAME } },
    { state: 'long', props: { name: LONG_NAME } },
  ],
  'dialog.command-problem': [
    { state: 'opened', props: { code: 'document-busy' } },
    // An internal failure adds the reference a person quotes when reporting it.
    { state: 'internal', props: { code: 'internal', incident: 'inc-20261001-0930-4f2a9c' } },
    // A COPY MADE FOR AN EDIT OF A SIGNED DOCUMENT and not opened: the longest sentence this dialog carries.
    { state: 'copy-at-capacity', props: { code: 'copy-at-capacity' } },
  ],
  'dialog.history-trimmed': [{ state: 'opened', props: { dropped: 25 } }],
  'dialog.delete-pages': [
    { state: 'opened', props: { pageCount: 12, pages: [2] } },
    { state: 'refused', props: { pageCount: 12, pages: [2] }, steps: [type('Pages to delete', '9-2')] },
    { state: 'everything', props: { pageCount: 12, pages: [2] }, steps: [type('Pages to delete', '1-12')] },
  ],
  'dialog.stamp': [
    { state: 'opened', props: { pictures: [] } },
    {
      state: 'pictures',
      props: {
        pictures: [
          { id: '00000000-0000-4000-8000-0000000000c1', name: 'Received', src: STAMP_PICTURE },
          { id: '00000000-0000-4000-8000-0000000000c2', name: 'Company seal', src: SEAL_PICTURE },
        ],
      },
    },
  ],
  'dialog.signature-break': [{ state: 'opened', props: { signatures: 2 } }],
  'dialog.flatten-form': [{ state: 'opened', props: {} }],
  'dialog.signed-edit': [{ state: 'opened', props: {} }],
  'dialog.pending-redactions': [{ state: 'opened', props: { count: 3, occasion: 'save' } }],
  'dialog.kept-backups': [
    { state: 'opened', props: { kept: ['Quarterly report.bak.pdf'] } },
    {
      state: 'long',
      props: {
        kept: [
          LONG_NAME.replace(/\.pdf$/u, '.backup.pdf'),
          ...Array.from({ length: 14 }, (_unused, at) => `Quarterly report (backup ${String(at + 1)}).pdf`),
        ],
      },
    },
  ],
  'dialog.held-copies': [
    { state: 'opened', props: { held: ['Quarterly report.pdf.bak'], still: false } },
    { state: 'still', props: { held: ['Quarterly report.pdf.bak', 'Quarterly report.pdf.bak2'], still: true } },
    { state: 'long', props: { held: [LONG_NAME.replace(/\.pdf$/u, '.pdf.bak')], still: false } },
  ],
  'dialog.document-password': [
    { state: 'opened', props: { name: NAME, retry: false } },
    { state: 'filled', props: { name: NAME, retry: false }, steps: [type('Password', 'example-password')] },
    { state: 'long', props: { name: LONG_NAME, retry: true } },
  ],
  'dialog.protect-document': [
    { state: 'opened', props: {} },
    {
      state: 'filled',
      props: {},
      steps: [type('Password to open (optional)', 'example-open'), type('Password to change permissions (optional)', 'example-owner')],
    },
  ],
  'dialog.apply-redactions': [{ state: 'opened', props: { page: 2 } }],
  'dialog.redact-matches': [
    { state: 'opened', props: { page: 2 } },
    { state: 'filled', props: { page: 2 }, steps: [type('Find', 'account number')] },
  ],
  'dialog.sanitize-document': [
    { state: 'opened', props: {} },
    // Every part unticked, so the dialog says something must be chosen.
    {
      state: 'refused',
      props: {},
      steps: [
        tick('Embedded JavaScript and automatic actions'),
        tick('Attached files'),
        tick('Actions that submit or fetch data'),
        tick('Form fields and comments, flattened into the page'),
      ],
    },
  ],
  'dialog.sign-document': [
    { state: 'opened', props: { placed: false, kept: [] } },
    {
      state: 'filled',
      props: { placed: false, kept: [] },
      steps: [
        type('Certificate password (leave empty if it has none)', 'example-passphrase'),
        type('Signed by (optional)', 'Alex Example'),
        type('Reason (optional)', 'I approve this report'),
        type('Location (optional)', 'Head office'),
      ],
    },
    // A visible signature was drawn on the page, so the dialog also asks how it looks.
    { state: 'placed', props: { placed: true, kept: [] } },
    { state: 'kept', props: { placed: true, kept: [KEPT_TYPED, KEPT_DRAWN] } },
    {
      state: 'refused',
      props: { placed: false, kept: [] },
      steps: [type('Reason (optional)', prose(MAX_SIGNATURE_FIELD))],
    },
  ],
  'dialog.signature': [
    { state: 'opened', props: { kept: [] } },
    { state: 'type', props: { kept: [] }, steps: [press('Type')] },
    { state: 'typed', props: { kept: [] }, steps: [press('Type'), type('Your name', 'Alex Example')] },
    // A NAME ITS STYLE CANNOT WRITE: the status line names the letters, and the style list says it of each face.
    { state: 'cannot-write', props: { kept: [] }, steps: [press('Type'), type('Your name', 'Алекс')] },
    { state: 'upload', props: { kept: [] }, steps: [press('Upload')] },
    {
      state: 'picked',
      props: {
        kept: [],
        picked: { handle: asFileHandle('held-1'), name: 'My signature.png', src: SIGNATURE_PICTURE },
        keep: true,
      },
    },
    { state: 'kept', props: { kept: [KEPT_TYPED, KEPT_DRAWN] } },
  ],
  'dialog.signature-problem': [
    { state: 'opened', props: { reason: 'unreadable' } },
    { state: 'cannot-write', props: { reason: 'cannot-write', characters: 'А л е к с' } },
    // THE LONGEST SENTENCE this dialog says, a scanned PDF with a password (G3d).
    { state: 'scan-locked', props: { reason: 'scan-locked' } },
  ],
  'dialog.sign-problem': [{ state: 'opened', props: { reason: 'wrong-passphrase' } }],
  'dialog.signatures': [
    { state: 'opened', props: { signatures: SIGNATURES, unreadable: false } },
    { state: 'empty', props: { signatures: [], unreadable: false } },
    {
      state: 'long',
      props: {
        signatures: Array.from({ length: 12 }, (_unused, at) => ({
          signer: `Approver ${String(at + 1)}`,
          organisation: 'Example Holdings International Limited, Finance and Audit Division',
          reason: prose(200).slice(0, 200),
          location: 'Head office, second floor meeting room',
          notBefore: '2026-01-15T00:00:00Z',
          notAfter: '2027-01-15T00:00:00Z',
          coversDocument: at !== 3,
          coversWholeFile: at === 0,
        })),
        unreadable: false,
      },
    },
  ],
  'dialog.docusign-send': [
    { state: 'opened', props: {} },
    {
      state: 'filled',
      props: {},
      steps: [
        type('Email subject', 'Please sign: Quarterly report'),
        type('Signer name', 'Alex Example'),
        type('Signer email', 'alex@example.com'),
      ],
    },
    { state: 'signers', props: {}, steps: [press('Add signer'), press('Add signer')] },
  ],
  'dialog.docusign-notice': [{ state: 'opened', props: { reason: 'sent' } }],
  'dialog.crop-pages': [
    { state: 'opened', props: { pages: [0] } },
    {
      state: 'filled',
      props: { pages: [0, 1, 2] },
      steps: [type('Top (points)', '36'), type('Bottom (points)', '36'), type('Left (points)', '18'), type('Right (points)', '18')],
    },
    { state: 'refused', props: { pages: [0] }, steps: [type('Top (points)', '-10')] },
  ],
  'dialog.page-background': [{ state: 'opened', props: { pages: [2] } }],
  'dialog.watermark-pages': [
    { state: 'opened', props: { pages: [0] } },
    { state: 'filled', props: { pages: [0] }, steps: [type('Text', 'CONFIDENTIAL')] },
    { state: 'refused', props: { pages: [0] }, steps: [type('Text', 'DRAFT'), type('Opacity (%)', '150')] },
  ],
  'dialog.header-footer': [
    { state: 'opened', props: { pages: [0] } },
    {
      state: 'filled',
      props: { pages: [0] },
      steps: [type('Left', 'Quarterly report'), type('Centre', 'Confidential'), type('Right', 'Page {n} of {N}')],
    },
  ],
  'dialog.bates-number': [
    { state: 'opened', props: { pages: [0] } },
    { state: 'filled', props: { pages: [0] }, steps: [type('Prefix', 'CASE-'), type('Start at', '1001'), type('Digits', '6')] },
    { state: 'refused', props: { pages: [0] }, steps: [type('Digits', '20')] },
  ],
  'dialog.page-transition': [
    { state: 'opened', props: { pages: [0] } },
    { state: 'refused', props: { pages: [0] }, steps: [type('Duration (seconds)', '90')] },
  ],
  'dialog.resize-pages': [
    { state: 'opened', props: { pages: [0] } },
    { state: 'refused', props: { pages: [0] }, steps: [type('Width (points)', 'wide')] },
  ],
  'dialog.flat-fields': [
    {
      state: 'opened',
      props: {
        candidates: [
          { name: 'full_name', label: 'Full name' },
          { name: 'date_of_birth', label: 'Date of birth' },
          { name: 'address', label: 'Address' },
          { name: 'signature', label: 'Signature' },
        ],
        truncated: false,
      },
    },
    { state: 'empty', props: { candidates: [], truncated: false } },
    {
      state: 'long',
      props: {
        candidates: Array.from({ length: 40 }, (_unused, at) => ({
          name: `line_item_${String(at + 1)}_description_and_amount`,
          label: `Line item ${String(at + 1)}: description of the goods or services supplied, and the amount`,
        })),
        truncated: true,
      },
    },
  ],
  'dialog.import-form-data-problem': [{ state: 'opened', props: { reason: 'unreadable' } }],
  'dialog.import-annotations-problem': [{ state: 'opened', props: { reason: 'unreadable' } }],
  'dialog.insert-image-problem': [{ state: 'opened', props: { reason: 'too-large', limitBytes: 50 * 1024 * 1024 } }],
  'dialog.markdown-import-problem': [
    { state: 'opened', props: { reason: 'malformed-csv', line: 14 } },
    { state: 'long', props: { reason: 'image-unreadable', file: LONG_NAME.replace(/\.pdf$/u, '.png') } },
  ],
  'dialog.workbook-incomplete': [
    {
      state: 'opened',
      props: {
        missing: [
          { sheet: 'Summary', from: 120, to: 164 },
          { sheet: 'Q3 detail', from: 1_001, to: 1_250 },
        ],
        more: 0,
      },
    },
    {
      state: 'long',
      props: {
        missing: Array.from({ length: 64 }, (_unused, at) => ({
          sheet: at === 0 ? 'Regional operations review, third quarter, supporting schedules and reconciliations' : `Region ${String(at)}`,
          from: 100 + at * 500,
          to: 350 + at * 500,
        })),
        more: 12,
      },
    },
  ],
  'dialog.boxed-characters': [
    {
      state: 'opened',
      props: {
        from: 'import',
        boxed: [
          { character: '中', line: 3, column: 8 },
          { character: '文', line: 3, column: 9 },
          { character: 'ก', line: 12, column: null },
        ],
        more: 0,
      },
    },
    {
      state: 'long',
      props: {
        from: 'import',
        boxed: Array.from({ length: 64 }, (_unused, at) => ({
          character: String.fromCodePoint(0x4e00 + at),
          line: 1_000 + at * 37,
          column: at % 5 === 0 ? null : 10_000 + at,
        })),
        more: 1_250,
      },
    },
    // AN EDIT'S BOXES, named by page (ADR-0174).
    {
      state: 'edited',
      props: {
        from: 'edit',
        boxed: [
          { character: '中', page: 0 },
          { character: String.fromCodePoint(0x1f600), page: 0 },
          { character: 'ก', page: 11 },
        ],
        more: 0,
      },
    },
  ],
  // THE OLDER COPIES A PROTECT COULD NOT ENCRYPT, by name (ADR-0178).
  'dialog.unsealed-copies': [
    { state: 'opened', props: { copies: ['quarterly report.pdf.bak'] } },
    {
      state: 'several',
      props: { copies: ['quarterly report.pdf.bak', 'quarterly report.pdf.previous', 'quarterly report (1).pdf.bak'] },
    },
  ],
  'dialog.open-from-url': [
    ...textForm('Address', 'https://example.com/reports/quarterly-report.pdf'),
    { state: 'refused', props: {}, steps: [type('Address', 'http://example.com/reports/quarterly-report.pdf')] },
  ],
  'dialog.url-open-problem': [{ state: 'opened', props: { reason: 'not-a-pdf' } }],
  'dialog.open-problem': [{ state: 'opened', props: { reason: 'busy' } }],
  'dialog.read-only-file': [
    { state: 'opened', props: { access: 'read-only' } },
    { state: 'held', props: { access: 'held' } },
  ],
  'dialog.camera-capture': [{ state: 'opened', props: {} }],
  'dialog.generate-toc-problem': [{ state: 'opened', props: { reason: 'no-outline' } }],
  'dialog.merge-document': [
    { state: 'opened', props: { choices: SOURCES, pageCount: 12 } },
    { state: 'after-page', props: { choices: SOURCES, pageCount: 12, draft: { placement: 'after', page: '4', documents: [] } } },
    // SEVERAL DOCUMENTS, one of them twice, in the order they go in (ADR-0152).
    {
      state: 'several',
      props: {
        choices: SOURCES,
        pageCount: 12,
        draft: {
          placement: 'end',
          page: '1',
          documents: [...SOURCES, ...SOURCES.slice(0, 1)].map((source) => source.docId),
        },
      },
    },
    { state: 'none-open', props: { choices: [], pageCount: 12 } },
    { state: 'long', props: { choices: LONG_SOURCES, pageCount: 12 } },
  ],
  'dialog.insert-from-pdf': [
    // AFTER PAGE 3 OF 12, the page on show.
    { state: 'opened', props: { choices: SOURCES, pageCount: 12, page: 2 } },
    { state: 'chosen-pages', props: { choices: SOURCES, pageCount: 12, page: 2, draft: { sourcePages: { every: false, text: '2-5' }, placement: 'before', page: '1' } } },
    { state: 'none-open', props: { choices: [], pageCount: 12, page: 2 } },
    { state: 'long', props: { choices: LONG_SOURCES, pageCount: 12, page: 2 } },
  ],
  'dialog.replace-page': [
    // ONE PAGE FROM A TWELVE-PAGE FILE: the dialog opens on its first page, so the length is kept.
    { state: 'opened', props: { choices: SOURCES, pages: [2] } },
    // PAGES APART, which pair one for one.
    { state: 'ticked', props: { choices: SOURCES, pages: [1, 4] } },
    // NOTHING ELSE OPEN: Choose file is the way to a source.
    { state: 'none-open', props: { choices: [], pages: [2] } },
    { state: 'long', props: { choices: LONG_SOURCES, pages: [2] } },
  ],
  'dialog.import-page-as-layer': [
    { state: 'opened', props: { choices: SOURCES, page: 2 } },
    { state: 'none-open', props: { choices: [], page: 2 } },
    { state: 'long', props: { choices: LONG_SOURCES, page: 2 } },
  ],
  'dialog.reimport-external-edit': [{ state: 'opened', props: { page: 2 } }],
  'dialog.external-edit-problem': [{ state: 'opened', props: { reason: 'launch-failed' } }],
  'dialog.extract-pages': [
    { state: 'opened', props: { pageCount: 12, pages: [2, 3, 4] } },
    { state: 'refused', props: { pageCount: 12, pages: [2, 3, 4] }, steps: [type('Pages to extract', '3-15')] },
  ],
  'dialog.split-document': [
    { state: 'opened', props: { pageCount: 12 } },
    {
      state: 'ranges',
      props: { pageCount: 12 },
      steps: [choose('One file for each range Each range you type becomes one PDF, for example 1-3, 4-6.'), type('Ranges', '1-4, 5-8, 9-12')],
    },
    // ONE FILE, in the singular (item 13i): "1 files will be written" until the line went through the plural rule.
    {
      state: 'one-range',
      props: { pageCount: 12 },
      steps: [choose('One file for each range Each range you type becomes one PDF, for example 1-3, 4-6.'), type('Ranges', '1-12')],
    },
    {
      state: 'refused',
      props: { pageCount: 12 },
      steps: [choose('One file for each range Each range you type becomes one PDF, for example 1-3, 4-6.'), type('Ranges', '8-3')],
    },
  ],
  'dialog.export-page-images': [
    { state: 'opened', props: { pageCount: 12 } },
    { state: 'select', props: { pageCount: 12 }, steps: [press('Select pages'), type('Page numbers', '1-3, 7')] },
    { state: 'jpeg', props: { pageCount: 12 }, steps: [press('JPEG')] },
    {
      state: 'refused',
      props: { pageCount: 12 },
      steps: [press('Select pages'), type('Page numbers', '20'), press('Choose a folder…')],
    },
  ],
  'dialog.export-word': [
    { state: 'opened', props: { pageCount: 12 } },
    { state: 'select', props: { pageCount: 12 }, steps: [press('Select pages'), type('Page numbers', '1-3, 7')] },
    {
      state: 'refused',
      props: { pageCount: 12 },
      steps: [press('Select pages'), type('Page numbers', '20'), press('Choose where to save…')],
    },
  ],
  'dialog.export-powerpoint': [
    { state: 'opened', props: { pageCount: 12, becomes: 'slides' } },
    { state: 'select', props: { pageCount: 12, becomes: 'slides' }, steps: [press('Select pages'), type('Page numbers', '1-3, 7')] },
  ],
  'dialog.export-text': [
    { state: 'opened', props: { pageCount: 12, becomes: 'text' } },
    {
      state: 'refused',
      props: { pageCount: 12, becomes: 'text' },
      steps: [press('Select pages'), press('Choose where to save…')],
    },
  ],
  'dialog.export-layout-text': [{ state: 'opened', props: { pageCount: 12, becomes: 'text' } }],
  'dialog.export-excel': [
    { state: 'opened', props: EXCEL },
    { state: 'select', props: { ...EXCEL, range: { every: false, text: '1, 3-4' } } },
    // With a service key stored, the dialog offers the engines; a network engine replaces the preview.
    { state: 'engines', props: { ...EXCEL, engines: ['automatic', 'azure', 'claude'] } },
    { state: 'service', props: { ...EXCEL, engines: ['automatic', 'azure', 'claude'], engine: 'claude' } },
    { state: 'empty', props: { ...EXCEL, index: 1, page: 2, tables: [] } },
    { state: 'long', props: { ...EXCEL, tables: [TABLE, TABLE, TABLE], truncated: true } },
  ],
  'dialog.service-refused': [
    { state: 'opened', props: { page: 3, reason: 'refused', detail: 'The service did not read this page.' } },
    { state: 'long', props: { page: 3, reason: 'rejected', detail: prose(500).slice(0, 600) } },
  ],
  'dialog.print': [
    { state: 'opened', props: { dpi: 300, pageCount: 12 } },
    { state: 'select', props: { dpi: 300, pageCount: 12 }, steps: [press('Select pages'), type('Page numbers', '2-5')] },
  ],
  'dialog.pdfa-removals': [
    {
      state: 'opened',
      props: {
        removed: [
          'Annotation set to non-printing, not permitted in PDF/A, annotation will not be present in output file.',
          'Transparency group found, not permitted in PDF/A-1, reverting to normal PDF output.',
        ],
        tagsDropped: false,
      },
    },
    { state: 'tags', props: { removed: [], tagsDropped: true } },
    {
      state: 'long',
      props: {
        removed: Array.from(
          { length: 24 },
          (_unused, at) => `Annotation ${String(at + 1)} set to non-printing, not permitted in PDF/A, annotation will not be present in output file.`,
        ),
        tagsDropped: true,
      },
    },
  ],
  'dialog.optimize': [
    { state: 'opened', props: { setting: 'medium', measured: null } },
    { state: 'measured', props: { setting: 'medium', measured: { before: 8_400_000, after: 3_150_000 } } },
    { state: 'not-smaller', props: { setting: 'high', measured: { before: 420_000, after: 431_000 } } },
  ],
  'dialog.page-barcodes': [
    {
      state: 'opened',
      props: {
        kind: 'read',
        page: 1,
        barcodes: [
          { format: 'QRCode', text: 'https://example.com/invoices/2026-0412' },
          { format: 'Code128', text: 'INV-2026-0412' },
        ],
        truncated: false,
      },
    },
    { state: 'empty', props: { kind: 'read', page: 1, barcodes: [], truncated: false } },
    {
      state: 'long',
      props: {
        kind: 'read',
        page: 1,
        barcodes: Array.from({ length: 64 }, (_unused, at) => ({
          format: at % 2 === 0 ? 'QRCode' : 'DataMatrix',
          text: at === 0 ? prose(400).slice(0, 400) : `https://example.com/parcels/2026/${String(100_000 + at)}`,
        })),
        truncated: true,
      },
    },
    { state: 'refused', props: { kind: 'refused', page: 1 } },
  ],
  'dialog.accessibility-check': [
    { state: 'opened', props: { kind: 'checked', rules: RULES, humanChecks: [...ACCESSIBILITY_HUMAN_CHECKS] } },
    { state: 'long', props: { kind: 'checked', rules: EVERY_RULE, humanChecks: [...ACCESSIBILITY_HUMAN_CHECKS] } },
    { state: 'refused', props: { kind: 'refused' } },
  ],
  'dialog.place-barcode': [
    { state: 'opened', props: {} },
    { state: 'filled', props: {}, steps: [type('Text or link', 'https://example.com/invoices/2026-0412')] },
    // The previous answer could not be drawn in that format, so the dialog reopens with it and says so.
    { state: 'refused', props: { refused: { text: 'INV-2026-0412', format: 'EAN13' } } },
  ],
  'dialog.duplicate-pages': [
    { state: 'opened', props: { groups: [{ pages: [2, 7] }, { pages: [4, 9, 11] }], truncated: false } },
    { state: 'empty', props: { groups: [], truncated: false } },
    {
      state: 'long',
      props: {
        groups: Array.from({ length: 40 }, (_unused, at) => ({ pages: [at * 3, at * 3 + 1, at * 3 + 2] })),
        truncated: true,
      },
    },
  ],
  'dialog.settings-problem': [
    { state: 'opened', props: { setting: THEME_TITLE } },
    { state: 'secret', props: { setting: EDITING_AZURE_KEY_TITLE, secret: true } },
  ],
  'dialog.settings': [
    { state: 'opened', props: SETTINGS },
    ...[
      'Viewing',
      'Rendering',
      'Editing defaults',
      'Saving',
      'OCR',
      'AI',
      'Integrations',
      'Keyboard',
      'Privacy',
      'Updates',
      'Advanced',
    ].map((page) => ({ state: page.toLowerCase().replace(/ /gu, '-'), props: SETTINGS, steps: [press(page)] })),
    { state: 'search', props: SETTINGS, steps: [type('Search settings', 'page')] },
    { state: 'no-match', props: SETTINGS, steps: [type('Search settings', 'xylophone')] },
  ],
  'dialog.form-field-radio': [
    { state: 'opened', props: {} },
    {
      state: 'filled',
      props: {},
      steps: [
        type('Group name', 'delivery'),
        type('This option’s value', 'Standard'),
      ],
    },
  ],
  'dialog.form-field-dropdown': choiceField('delivery_method'),
  'dialog.form-field-listbox': choiceField('preferred_days'),
  'dialog.follow-link': [
    { state: 'opened', props: { address: 'https://example.org/annual-report', followable: true, scheme: 'https:' } },
    // ONE UNBROKEN WORD, as a tracking address is: the dialog shows it whole and breaks it anywhere.
    {
      state: 'long',
      props: {
        address: `https://example.org/track?id=${'a1b2c3d4e5'.repeat(60)}`,
        followable: true,
        scheme: 'https:',
      },
    },
    { state: 'refused', props: { address: 'file:///C:/Windows/System32/calc.exe', followable: false, scheme: 'file:' } },
    { state: 'no-scheme', props: { address: 'example.org/annual-report', followable: false, scheme: null } },
  ],
};
