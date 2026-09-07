import { PDFDocument } from '@cantoo/pdf-lib';

import type { ByteImage } from './engineSeam.js';

/**
 * The one way a byte-image command opens a document with `@cantoo/pdf-lib`.
 *
 * ## `updateMetadata: false`, and it is what makes `reproducible: true` TRUE
 *
 * pdf-lib defaults to `updateMetadata: true`, which rewrites `/ModDate` and
 * `/Producer` on every save. A command that declares `reproducible: true` and
 * loads with the default is **mis-declared**: re-running it against the same
 * document produces different bytes, and §3a's replay reads that declaration.
 *
 * Measured 2026-09-07 with two applies separated by 1.1 seconds:
 *
 * | command | same bytes | `/ModDate` |
 * |---|---|---|
 * | `generateToc` (unpinned) | **no** | `172400Z` → `172401Z` |
 * | `insertImagePage` (unpinned) | **no** | `172401Z` → `172402Z` |
 * | `watermarkPages` (pinned) | yes | `172402Z` → `172402Z` |
 *
 * ## Why a function rather than a rule, and a rule as well
 *
 * The knowledge was already in this repository and had already been paid for:
 * `docs/FEATURES.md`'s watermark row records that `updateMetadata: false` is
 * what makes its `reproducible: true` true, and that **the byte-equality case
 * cannot see the stamp**, because two saves normally land inside one clock
 * tick. Four call sites had the flag and two did not — the class was left while
 * the instance was fixed, which is Rule 0's *fix the class, not the instance*.
 *
 * So the choice is a name rather than a paragraph somebody has to read and
 * reject (QQQ-3), and `monstera/no-unpinned-pdf-load` makes the bare form
 * unavailable rather than discouraged — because a helper sitting beside a legal
 * inline call is the same trap one step on.
 *
 * ## What it deliberately does not do
 *
 * It does not save. The save options a command needs differ — an incremental
 * save is ADR-0008's decision per purpose — and folding them in here would make
 * one function answer two questions, only one of which has a single answer.
 */
export function openForWriting(image: ByteImage): Promise<PDFDocument> {
  // NO EXEMPTION AND NO DISABLE. This call pins the flag, so it passes the rule
  // on its own merits — unlike `geometry.ts` under `no-bare-y-flip`, where the
  // legal spelling is textually identical to the banned one and a file
  // exemption is the only thing that separates them.
  return PDFDocument.load(image, { updateMetadata: false });
}
