import { useLingui } from '@lingui/react';
import type { CertificationLevel } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { SURFACE_PLACEMENTS, useLiveContext } from '../commandAnswers.js';
import type { CertificationLine as Line } from '../documentStores.js';
import {
  CERTIFICATION_LINE_COPY,
  CERTIFICATION_LINE_FORM_FILL,
  CERTIFICATION_LINE_FORM_FILL_AND_ANNOTATE,
  CERTIFICATION_LINE_NO_CHANGES,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { useRunCommand } from '../registries/useRunCommand.js';
import { certificationLineModel } from './projections.js';

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
 * ITS BUTTONS ARE A PROJECTION ([ADR-0295](../../../../docs/DECISIONS/0295-the-certification-line-projects-the-commands-placed-on-it.md)):
 * the commands placed on `certification-line`, run against the document on show. The line names none.
 *
 * `role="status"` so it is read once when it appears, never again as the person works.
 */
export function CertificationLine({ line, commands }: { readonly line: Line; readonly commands: LineCommands | undefined }): ReactElement {
  const { _ } = useLingui();
  const message = line.kind === 'certified' ? LEVEL_LINE[line.level] : CERTIFICATION_LINE_COPY;
  return (
    <div className="m-certification-line" data-certification-line={line.kind} role="status">
      <p className="m-certification-line__text">{_(message, { named: line.signer === '' ? 'no' : 'yes', signer: line.signer })}</p>
      {commands === undefined ? null : <LineButtons commands={commands} />}
    </div>
  );
}

/**
 * Where the line's commands come from: the registry, and the context of the document on show, which they run against.
 * `undefined` for a layer behind the one on show, which is hidden and offers nothing.
 */
export interface LineCommands {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

function LineButtons({ commands: { registry, context: asked } }: { readonly commands: LineCommands }): ReactElement {
  const context = useLiveContext(registry, asked, SURFACE_PLACEMENTS.certificationLine);
  const run = useRunCommand(context);
  return (
    <>
      {certificationLineModel(registry, context).map((entry) => (
        <Button
          key={entry.command.id}
          label={entry.command.title}
          onClick={() => {
            run(entry.command);
          }}
          variant="quiet"
        />
      ))}
    </>
  );
}
