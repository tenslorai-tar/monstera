import type { MessageKey } from '@monstera/shared';

import type { Article } from './help/article.js';
import type { UiCommand } from './registries/commands.js';
import { SECTION_IDS, type SectionId } from './registries/placement.js';

/**
 * The owner's manual test checklist, generated from the command registry (the 28 September list, item 14:
 * *"docs/manual-test-checklist.md generated from registry"*).
 *
 * ## From the registry, never a hand-kept list
 *
 * A hand-kept list of the application's tools is exactly the second wiring place the registry exists to forbid: it
 * would name a tool that was renamed, and miss the one added after it was written. So every command the shell
 * registers is one line here, placed where the registry places it, and `App.test.tsx` holds the document equal to
 * this output — a command added without regenerating it is a red test, not a stale checklist.
 *
 * ## What the renderer cannot check is written here, once
 *
 * The shell window's own checks — focus leaving for another application, a physical 150% or 200% display, Windows'
 * contrast themes, the file association — are the ones the live checks on the built renderer could not reach
 * (JOURNAL, 2026-09-29), so they are the part of this list that is not derived.
 */

/** The checks only the installed application's own window can answer, with the criterion each one tests. */
export const SHELL_WINDOW_CHECKS: readonly string[] = [
  'Install the package, then open a PDF by double-clicking it in File Explorer: it opens in Monstera as a tab (the .pdf association).',
  'With Monstera already open, double-click a second PDF: it opens as a tab in the same window, and no second window appears.',
  'Choose **Monstera PDF Editor** in **Open with** for a PDF: it opens.',
  'Start menu, taskbar and Alt+Tab show the Monstera mark, never a blank or plated icon, in light and dark Windows themes.',
  'WCAG 2.4.3 — with a document open and focus in the ribbon, Alt+Tab to another application and back: focus returns where it was, and no overlay (Studio, a menu) stays open over the panels.',
  'WCAG 1.4.4 — on a display set to 150% and then 200% in Windows Settings › Display › Scale: the window opens at no more than the work area, nothing scrolls sideways, and every tool is reachable (the ribbon folds groups into its More).',
  'WCAG 1.4.11, 1.4.3 — with a Windows contrast theme on (Settings › Accessibility › Contrast themes): every control has a visible edge and every text is readable.',
  'WCAG 2.1.1, 2.1.2 — the window’s own title bar: minimise, maximise and close are reachable and work from the keyboard (Alt+Space), and nothing traps focus.',
  'WCAG 4.1.2 — with Narrator on (Ctrl+Win+Enter): the window’s title, the ribbon’s sections, a dialog’s title and a toast are announced.',
  'Help › Components: every component shows **Installed**; **Verify files** turns each to **Verified**.',
  'Uninstall from Settings › Apps › Installed apps: Monstera leaves no Start menu entry, and PDFs no longer offer it.',
];

/** How each surface is named in the checklist's headings, for a command that has no ribbon placement. */
const SURFACE_HEADINGS: Readonly<Record<string, string>> = {
  'menu-bar': 'Menu bar',
  'menu-bar-commands': 'Menu bar (centre)',
  'start-screen': 'Start screen',
  'quick-toolbar': 'Quick toolbar',
  'context-menu': 'Context menus',
  'status-bar': 'Status bar',
  rail: 'Rail',
  properties: 'Properties tab',
};

/**
 * The checklist's markdown.
 *
 * @param commands every registered command
 * @param articles the Help articles, so each line names the article that teaches it
 * @param label how a catalogue key is shown — the screen's own words
 * @param sectionTitles each ribbon section's caption key
 */
export function manualChecklist(
  commands: readonly UiCommand[],
  articles: readonly Article[],
  label: (key: MessageKey) => string,
  sectionTitles: Readonly<Record<SectionId, MessageKey>>,
): string {
  const taughtBy = new Map<string, string>();
  for (const article of articles) {
    for (const id of article.commands) if (!taughtBy.has(id)) taughtBy.set(id, article.title);
  }
  const line = (command: UiCommand, where: string): string => {
    const article = taughtBy.get(command.id);
    return `- [ ] **${label(command.title)}**${where === '' ? '' : ` — ${where}`} · \`${command.id}\`${article === undefined ? '' : ` · Help: *${article}*`}`;
  };

  const bySection = new Map<SectionId, { group: string; order: number; text: string }[]>();
  const bySurface = new Map<string, { order: number; text: string }[]>();
  const unplaced: string[] = [];
  for (const command of [...commands].sort((a, b) => a.id.localeCompare(b.id))) {
    const ribbon = command.placements.find((placement) => placement.surface === 'ribbon');
    if (ribbon !== undefined) {
      const group = label(ribbon.group);
      const rows = bySection.get(ribbon.section) ?? [];
      rows.push({ group, order: ribbon.order, text: line(command, group) });
      bySection.set(ribbon.section, rows);
      continue;
    }
    const first = command.placements[0];
    if (first === undefined) {
      unplaced.push(line(command, ''));
      continue;
    }
    const heading = SURFACE_HEADINGS[first.surface] ?? first.surface;
    const rows = bySurface.get(heading) ?? [];
    rows.push({ order: 'order' in first ? first.order : 0, text: line(command, '') });
    bySurface.set(heading, rows);
  }

  const out: string[] = [
    '# Manual test checklist',
    '',
    '<!-- GENERATED from the command registry by `packages/ui/src/manualChecklist.ts`; `App.test.tsx` holds this file',
    '     equal to it. Regenerate with `npx vitest run packages/ui/src/App.test.tsx -t "manual test checklist" -u`.',
    '     Do not edit by hand. -->',
    '',
    `Every command the application registers — ${String(commands.length)} — and the checks only the installed window can answer.`,
    'For each command: use it on a real document, see the correct effect, then save, close and reopen and see it kept',
    '(the wired-tools rule, CLAUDE.md). A command that needs a selection, a second document or a key says so when it',
    'is not available.',
    '',
    '## The installed window',
    '',
    ...SHELL_WINDOW_CHECKS.map((check) => `- [ ] ${check}`),
    '',
  ];
  for (const section of SECTION_IDS) {
    const rows = bySection.get(section);
    if (rows === undefined) continue;
    out.push(`## Ribbon › ${label(sectionTitles[section])}`, '');
    rows.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.text.localeCompare(b.text));
    out.push(...rows.map((row) => row.text), '');
  }
  for (const heading of [...bySurface.keys()].sort()) {
    const rows = bySurface.get(heading) ?? [];
    rows.sort((a, b) => a.order - b.order || a.text.localeCompare(b.text));
    out.push(`## ${heading}`, '', ...rows.map((row) => row.text), '');
  }
  if (unplaced.length > 0) out.push('## Command palette and keyboard only', '', ...unplaced, '');
  return out.join('\n');
}
