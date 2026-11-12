import { useLingui } from '@lingui/react';
import type { CertificationLevel } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import type { CertificationLine as Line } from '../documentStores.js';
import {
  CERTIFICATION_LINE_COPY,
  CERTIFICATION_LINE_FORM_FILL,
  CERTIFICATION_LINE_FORM_FILL_AND_ANNOTATE,
  CERTIFICATION_LINE_NO_CHANGES,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';

/** A registered command as the line runs it: its own title, and its `run` with the context of the document on show. */
export interface LineCommand {
  readonly title: MessageKey;
  readonly run: () => void;
}

/** What each level allows, said at the top of the document. KEYED BY THE LEVELS, so a new one has no line until it says. */
const LEVEL_LINE: Readonly<Record<CertificationLevel, MessageKey>> = {
  'no-changes': CERTIFICATION_LINE_NO_CHANGES,
  'form-fill': CERTIFICATION_LINE_FORM_FILL,
  'form-fill-and-annotate': CERTIFICATION_LINE_FORM_FILL_AND_ANNOTATE,
};

/**
 * The line at the top of a certified document, and of the copy made from one
 * ([ADR-0291](../../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)'s
 * amendment of 2026-11-12, the owner's choice of surface): who certified it and what may change, or that the copy is not
 * certified, with *Check signatures*. It stays while the document is open and is not dismissed.
 *
 * `role="status"` so it is read once when it appears, never again as the person works.
 */
export function CertificationLine({ line, check }: { readonly line: Line; readonly check: LineCommand | undefined }): ReactElement {
  const { _ } = useLingui();
  const message = line.kind === 'certified' ? LEVEL_LINE[line.level] : CERTIFICATION_LINE_COPY;
  return (
    <div className="m-certification-line" data-certification-line={line.kind} role="status">
      <p className="m-certification-line__text">{_(message, { named: line.signer === '' ? 'no' : 'yes', signer: line.signer })}</p>
      {check === undefined ? null : <Button label={check.title} onClick={check.run} variant="quiet" />}
    </div>
  );
}
