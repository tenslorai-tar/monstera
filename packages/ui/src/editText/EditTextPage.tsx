import type { DocVersion } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import type { OverlayPage } from '../annotations/annotationSpace.js';
import type { PageBlocks, TextEditing } from './editing.js';
import { EditTextLayer } from './EditTextLayer.js';

/** A read of a page's blocks, and the version it was read at; `blocks` undefined for a refused read. */
interface BlocksAnswer {
  readonly version: DocVersion;
  readonly blocks: PageBlocks | undefined;
}

/**
 * One page's editing surface: reads the page's blocks at the version on screen and draws {@link EditTextLayer} over them.
 *
 * ## The answer carries the question it answers
 *
 * A read resolving after the version moved is discarded, because blocks read at version 4 outlined over the page at
 * version 5 would put an editor over words that are not there. While the page's drawing is older than the document AND
 * an editor on it holds words it wrote and the page has not drawn yet, the page keeps THAT editor's read
 * ([ADR-0261](../../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md)
 * Decision 7), so no frame shows the old words with no editor over them.
 */
export function EditTextPage({
  page,
  geometry,
  editing,
  paperAt,
  pictureNoted,
  drawn,
}: {
  readonly page: number;
  /** The version the page on screen is drawn from, `undefined` before it is drawn. */
  readonly drawn: DocVersion | undefined;
  readonly geometry: OverlayPage;
  readonly editing: TextEditing;
  /** Whether the page's own note says it is a picture and offers recognition. */
  readonly pictureNoted: boolean;
  /** The paper's colour at a point, in CSS pixels from the page's corner; `undefined` where nothing is drawn yet. */
  readonly paperAt: (x: number, y: number) => string | undefined;
}): ReactElement {
  const [answers, setAnswers] = useState<{ readonly current?: BlocksAnswer; readonly previous?: BlocksAnswer }>({});
  const [holding, setHolding] = useState<DocVersion | undefined>();
  const { read, version } = editing;
  const behind = drawn !== undefined && drawn < version && holding !== undefined;
  const kept = behind ? [answers.current, answers.previous].find((each) => each?.version === holding) : undefined;
  const answer = kept ?? (answers.current?.version === version ? answers.current : undefined);
  // ONE FUNCTION PER PAGE AND EDITING, so the layer's read of the page's objects runs once per write.
  const pageObjects = useCallback(() => editing.objects(page), [editing, page]);
  useEffect(() => {
    let current = true;
    void read(page).then((blocks) => {
      if (!current) return;
      setAnswers((had) => {
        const previous = had.current !== undefined && had.current.version !== version ? had.current : had.previous;
        return previous === undefined ? { current: { version, blocks } } : { previous, current: { version, blocks } };
      });
    });
    return () => {
      current = false;
    };
  }, [page, read, version]);

  return (
    <EditTextLayer
      adding={editing.adding}
      blocks={answer?.blocks}
      fallbackFace={editing.fallbackFace ?? 'sans'}
      {...(editing.familiesOf === undefined ? {} : { familiesOf: editing.familiesOf })}
      geometry={geometry}
      native={editing.native}
      objects={pageObjects}
      onAdded={editing.onAdded}
      onCommit={(block, text, read, formatting) => editing.onCommit(page, block, text, read, formatting)}
      onHolding={setHolding}
      onInsert={(insert, read) => editing.onInsert(page, insert, read)}
      onLeave={editing.onLeave}
      onRecognise={() => {
        editing.onRecognise(page);
      }}
      onRestructure={(edits, read, form, keptFamily) => editing.onRestructure(page, edits, read, form, keptFamily)}
      page={page}
      paperAt={paperAt}
      pictureNoted={pictureNoted}
      runFonts={(block, read) => editing.runFonts(page, block, read)}
      spell={editing.spell}
      // AN ANSWER WITH NO BLOCKS is a refused read, as against no answer yet.
      unreadable={answer !== undefined && answer.blocks === undefined}
    />
  );
}
