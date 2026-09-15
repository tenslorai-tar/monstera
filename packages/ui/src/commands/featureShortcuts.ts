import type { MessageKey } from '@monstera/shared';

import {
  FEATURE_ANNOTATE_TITLE,
  FEATURE_ENCRYPT_SIGN_TITLE,
  FEATURE_EXPORT_TITLE,
  FEATURE_FORMS_TITLE,
  FEATURE_OCR_TITLE,
  FEATURE_SPLIT_MERGE_TITLE,
} from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import type { SectionId } from '../registries/placement.js';
import { RIBBON_SECTION_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import type { OpenOutcome } from './openDocument.js';

/** One of §10.3's start-screen shortcuts: what it is called, its glyph, and the section its feature lives in. */
export interface FeatureShortcut {
  readonly name: string;
  readonly title: MessageKey;
  readonly icon: IconName;
  readonly section: SectionId;
}

/**
 * §10.3's six, in its order: *"Annotate & mark up · Fill & create forms · OCR scanned pages · Split & merge · Encrypt &
 * sign · Export anywhere"*.
 *
 * Each section is `BUILD-PROMPT.md`'s canonical mapping (:420-423), not a choice made here: D3 → Comment, D5 → Forms,
 * D6 → Tools (OCR group), D2 → Organize, D7 → Protect, D10 → Home (Export group).
 */
export const FEATURE_SHORTCUTS: readonly FeatureShortcut[] = [
  { name: 'annotate', title: FEATURE_ANNOTATE_TITLE, icon: 'Highlighter', section: 'comment' },
  { name: 'forms', title: FEATURE_FORMS_TITLE, icon: 'TextCursorInput', section: 'forms' },
  { name: 'ocr', title: FEATURE_OCR_TITLE, icon: 'ScanText', section: 'tools' },
  { name: 'split-merge', title: FEATURE_SPLIT_MERGE_TITLE, icon: 'Merge', section: 'organize' },
  { name: 'encrypt-sign', title: FEATURE_ENCRYPT_SIGN_TITLE, icon: 'ShieldCheck', section: 'protect' },
  { name: 'export', title: FEATURE_EXPORT_TITLE, icon: 'FileOutput', section: 'home' },
];

/**
 * The start screen's feature shortcuts — §10.3's grid, *"each a real entry point"*: *"opens a file then routes to that
 * feature"* (`BUILD-PROMPT.md`:1106).
 *
 * ## Open, then route — and route only when a document is showing
 *
 * Each command runs the one open (`openDocument`, which `document.open` runs too) and, only when it answers `shown`,
 * sets the rail's active section to its feature's. A dismissed picker or a file that could not open changes nothing, so
 * the next document does not open onto a section the reader never reached.
 *
 * ## Only while no document is open
 *
 * `when` hides them once one is: they are the start screen's way in, and in the palette beside an open document
 * *Annotate & mark up* would open a SECOND document, which is not what its name says.
 */
export function featureShortcutCommands(deps: {
  readonly open: () => Promise<OpenOutcome>;
  readonly settings: SettingsStore;
}): readonly UiCommand[] {
  return FEATURE_SHORTCUTS.map(
    (feature, index): UiCommand => ({
      id: `start.${feature.name}`,
      icon: feature.icon,
      title: feature.title,
      placements: [{ surface: 'start-screen', slot: 'shortcut', order: (index + 1) * 10 }],
      when: (context: CommandContext) => context.docId === undefined,
      run: async (): Promise<void> => {
        if ((await deps.open()) !== 'shown') return;
        deps.settings.set(RIBBON_SECTION_SETTING.id, feature.section);
      },
    }),
  );
}
