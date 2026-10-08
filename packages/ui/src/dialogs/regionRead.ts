import { lazy } from 'react';
import { z } from 'zod';

import { REGION_READ_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { COMMAND_PROBLEM_DIALOG } from './commandProblem.js';

/** The id the box-reading tools open to show what was read. */
export const REGION_READ_DIALOG_ID = 'dialog.region-read';

/**
 * The most characters of one box's words the panel shows: a dragged box is a few lines, and the text layer's own bounds
 * (`MAX_TEXT_LAYER_LINES` lines of `MAX_TEXT_LAYER_LINE`) would let a prop be megabytes. What is read past it is still in
 * the page; the panel says only what it can show.
 */
export const MAX_REGION_TEXT = 100_000;

/** Who read the box: this computer's recogniser, or a service the person chose by choosing the tool. */
export const REGION_READ_ENGINES = ['tesseract', 'claude', 'azure'] as const;

/**
 * What a box a person dragged was read as — the panel the owner asked for (Step 7c, 2026-10-08): before this the words were
 * written into the page unseen, so a read that worked looked like a drag that did nothing.
 *
 * ## FOUR STATES, one of them the wait
 *
 * `reading` is the panel as it opens, while a service answers (seconds); the others are what the read came to. They are
 * one props union rather than a flag beside a text so `{ state: 'reading', text: '…' }` is not a thing to rule out.
 *
 * ## The words are DATA, never a message key, and bounded
 *
 * They are what the page said, so they are shown as read and never translated, and held to the text layer's own bounds.
 */
export const REGION_READ_PROPS = z.discriminatedUnion('state', [
  z.object({ state: z.literal('reading'), engine: z.enum(REGION_READ_ENGINES) }).strict(),
  z
    .object({
      state: z.literal('read'),
      engine: z.enum(REGION_READ_ENGINES),
      text: z.string().min(1).max(MAX_REGION_TEXT),
      /** Whether the rows are a table, which offers Word and Excel and says the cells are tab-separated. */
      table: z.boolean(),
    })
    .strict(),
  z.object({ state: z.literal('nothing'), engine: z.enum(REGION_READ_ENGINES) }).strict(),
  z.object({ state: z.literal('failed'), engine: z.enum(REGION_READ_ENGINES), problem: COMMAND_PROBLEM_DIALOG.props }).strict(),
]);

/**
 * What the panel reports: that it is up (so the command has a way to answer it), and the two things a person can do with
 * the words. REPORTS, as the barcode list's are — the panel stays open, and the command acts.
 */
export const REGION_READ_REPORT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }).strict(),
  z.object({ kind: z.literal('copy') }).strict(),
  z.object({ kind: z.literal('insert') }).strict(),
  // A TABLE'S TWO WAYS ON: the page's own Word and Excel exports, which the command starts and the panel closes for.
  z.object({ kind: z.literal('word') }).strict(),
  z.object({ kind: z.literal('excel') }).strict(),
]);

export type RegionReadReport = z.infer<typeof REGION_READ_REPORT>;
export type RegionReadProps = z.infer<typeof REGION_READ_PROPS>;

export const REGION_READ_DIALOG = declareDialog({
  id: REGION_READ_DIALOG_ID,
  title: REGION_READ_TITLE,
  props: REGION_READ_PROPS,
  result: REGION_READ_REPORT,
  component: lazy(() => import('./RegionReadBody.js')),
});
