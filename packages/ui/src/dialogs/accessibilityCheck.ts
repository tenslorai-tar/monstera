import { ACCESSIBILITY_HUMAN_CHECKS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { ACCESSIBILITY_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const ACCESSIBILITY_DIALOG_ID = 'dialog.accessibility-check';

/**
 * The accessibility check's findings (ADR-0078): each automatic rule with its verdict, and the
 * checks only a person can make. `pageStructure.ts`' split — the command reads, this displays — and
 * a refusal opens it too. Pages are the numbers a person reads.
 */
export const ACCESSIBILITY_DIALOG = declareDialog({
  id: ACCESSIBILITY_DIALOG_ID,
  title: ACCESSIBILITY_TITLE,
  props: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('checked'),
      rules: z
        .array(
          z.object({
            clause: z.string().max(16).regex(/^\d+(?:\.\d+){0,3}$/u),
            test: z.number().int().positive().max(99),
            verdict: z.enum(['passed', 'failed', 'not-applicable', 'not-determined']),
            count: z.number().int().nonnegative(),
            pages: z.array(z.number().int().positive()).max(16).readonly(),
          }),
        )
        .max(32)
        .readonly(),
      humanChecks: z.array(z.enum(ACCESSIBILITY_HUMAN_CHECKS)).max(ACCESSIBILITY_HUMAN_CHECKS.length).readonly(),
    }),
    z.object({ kind: z.literal('refused') }),
  ]),
  component: lazy(() => import('./AccessibilityCheckBody.js')),
});
