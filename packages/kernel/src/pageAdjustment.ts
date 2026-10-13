import type { PageAdjustment, PageAdjustmentOutcome } from '@monstera/contract';

import type { MupdfSession } from './engineSeam.js';
import { pageIsLevel } from './pageDeskew.js';
import { sheetOnPage } from './pageScan.js';

/**
 * What a page tool would do to one page, read before it writes (the owner's N3): each tool's own decision — the one its
 * apply takes (`levellingTurn` in `pageDeskew.ts`, `withSheet` in `pageScan.ts`) — answered without writing, so the
 * person is told what happened to each page and the two cannot disagree.
 */
export async function readPageAdjustment(
  session: MupdfSession,
  page: number,
  adjustment: PageAdjustment,
): Promise<PageAdjustmentOutcome> {
  if (adjustment === 'level') return (await pageIsLevel(session, page)) ? 'already-level' : 'changes';
  const sheet = await sheetOnPage(session, page);
  return sheet === 'sheet' ? 'changes' : sheet;
}
